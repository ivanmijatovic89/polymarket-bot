#!/usr/bin/env python3
"""
gate_search.py (strict anti-overfit + 96-chunk stability + shadow forward report)

Protocol:
1) SEARCH uses TRAIN+VAL only (first 80%) to select candidates.
2) TEST (last 20%) is NOT used during selection.
3) After selection, we re-evaluate LOCKED candidates on TEST and rank by TEST.

Fixes vs older version:
- Singles are LOCKED & TEST-evaluated separately from combo candidates.
  => top_singles.txt will include many rows, not just the few that survived
     combo crowding in locked-all.

Outputs:
- top_gates.csv / top_gates.txt           (best overall gates, ranked by TEST)
- top_singles.csv / top_singles.txt       (best SINGLE gates, ranked by TEST)
- shadow_report_top.txt                   (per-96-chunk forward report on TEST)

Usage (Mac recommended):
  python3 -m venv .venv
  source .venv/bin/activate
  pip install pandas numpy
  python3 gate_search.py trades_with_features.csv
"""

from __future__ import annotations

import argparse
import math
import os
import random
from dataclasses import dataclass
from itertools import combinations
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd


# -----------------------------
# Defaults
# -----------------------------
DEFAULT_MAX_SKIP_PCT = 0.50
DEFAULT_MAX_GATES_IN_COMBO = 3
DEFAULT_LOGIC = "single,or"  # allowed: single,or

DEFAULT_QUANTILES = [
    0.02, 0.05, 0.08, 0.10, 0.12, 0.15, 0.20, 0.25,
    0.30, 0.35, 0.40, 0.45, 0.50,
    0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85,
    0.88, 0.90, 0.92, 0.95, 0.98
]
DEFAULT_OUTSIDE_PAIRS = [(0.05, 0.95), (0.10, 0.90), (0.15, 0.85), (0.20, 0.80)]

DEFAULT_TOP_SINGLES_FOR_COMBOS = 40
DEFAULT_TOP_N_OUTPUT = 50

DEFAULT_LAMBDA_INSTABILITY_TV = 1.0
DEFAULT_PENALTY_LOW_KEPT = 2.0
DEFAULT_MIN_KEPT_PCT_SPLIT = 0.25

DEFAULT_CHUNK_SIZE = 96
DEFAULT_MIN_CHUNKS = 6
DEFAULT_MIN_CHUNK_KEPT_PCT = 0.25
DEFAULT_LAMBDA_CHUNK_STD = 0.8
DEFAULT_CHUNK_BEAT_BASELINE_FRAC = 0.60
DEFAULT_PENALTY_CHUNK_FAIL = 3.0

DEFAULT_PLACEBO_RUNS = 200
DEFAULT_PLACEBO_TOP_K = 20
DEFAULT_SHADOW_TOP_K = 15

DEFAULT_LOCK_TOP_K_ALL = 300
DEFAULT_LOCK_TOP_K_SINGLES = 300   # NEW: evaluate many singles on TEST
DEFAULT_COMBO_LIMIT = 6000

RANDOM_SEED = 1337


# -----------------------------
# Data structures
# -----------------------------
@dataclass(frozen=True)
class Gate:
    kind: str  # "le", "ge", "outside"
    col: str
    t: Optional[float] = None
    lo: Optional[float] = None
    hi: Optional[float] = None

    def to_expr(self) -> str:
        if self.kind == "le":
            return f"({self.col} <= {self.t:.10g})"
        if self.kind == "ge":
            return f"({self.col} >= {self.t:.10g})"
        if self.kind == "outside":
            return f"({self.col} <= {self.lo:.10g} OR {self.col} >= {self.hi:.10g})"
        return "<unknown>"

    def eval_skip_mask(self, df: pd.DataFrame) -> np.ndarray:
        x = df[self.col].to_numpy(dtype=float)
        # NaN => do not skip (conservative)
        if self.kind == "le":
            return np.where(np.isfinite(x), x <= float(self.t), False)
        if self.kind == "ge":
            return np.where(np.isfinite(x), x >= float(self.t), False)
        if self.kind == "outside":
            return np.where(np.isfinite(x), (x <= float(self.lo)) | (x >= float(self.hi)), False)
        raise ValueError(f"Unknown gate kind: {self.kind}")


@dataclass
class SearchMetrics:
    score_search: float
    skip_pct_tv: float
    ev_train: float
    ev_val: float
    instability_tv: float
    kept_n_train: int
    kept_n_val: int
    pnl_total_tv: float
    winrate_tv: float
    chunk_valid_n: int
    chunk_ev_std: float
    chunk_beat_baseline_frac: float


@dataclass
class FinalMetrics:
    score_test: float
    ev_test: float
    kept_n_test: int
    pnl_total_test: float
    winrate_test: float
    placebo_percentile: Optional[float]


@dataclass
class Candidate:
    rule: str
    gates: Tuple[Gate, ...]
    is_single: bool
    search: SearchMetrics
    final: Optional[FinalMetrics] = None


# -----------------------------
# Utilities
# -----------------------------
def detect_time_column(df: pd.DataFrame) -> Optional[str]:
    candidates = ["asOfTimeMs", "startedAt", "timestamp", "time", "date", "ts"]
    for c in candidates:
        if c in df.columns:
            return c
    for c in df.columns:
        if df[c].dtype.kind in ("i", "u", "f"):
            x = df[c].dropna()
            if len(x) < 200:
                continue
            med = float(np.median(x.to_numpy(dtype=float)))
            if med > 1e9:
                return c
    return None


def sort_by_time_or_index(df: pd.DataFrame, time_col: Optional[str]) -> pd.DataFrame:
    if time_col is None:
        return df.reset_index(drop=True)
    s = df[time_col]
    if s.dtype == object:
        parsed = pd.to_datetime(s, errors="coerce", utc=True)
        if parsed.notna().sum() > max(50, 0.2 * len(df)):
            df2 = df.copy()
            df2["_time_parsed"] = parsed
            df2 = df2.sort_values("_time_parsed").drop(columns=["_time_parsed"])
            return df2.reset_index(drop=True)
    return df.sort_values(time_col).reset_index(drop=True)


def time_splits(n: int, frac_train=0.60, frac_val=0.20):
    n_train = int(n * frac_train)
    n_val = int(n * frac_val)
    idx = np.arange(n)
    train = idx[:n_train]
    val = idx[n_train:n_train + n_val]
    test = idx[n_train + n_val:]
    return train, val, test


def compute_ev_win_pnl(pnl: np.ndarray, is_win: Optional[np.ndarray], kept_mask: np.ndarray) -> Dict[str, float]:
    kept_n = int(kept_mask.sum())
    if kept_n == 0:
        return {"kept_n": 0, "ev": float("-inf"), "pnl_total": float("-inf"), "winrate": float("nan")}
    pnl_k = pnl[kept_mask]
    ev = float(np.mean(pnl_k))
    pnl_total = float(np.sum(pnl_k))
    if is_win is None:
        winrate = float("nan")
    else:
        winrate = float(np.mean(is_win[kept_mask])) * 100.0
    return {"kept_n": kept_n, "ev": ev, "pnl_total": pnl_total, "winrate": winrate}


def chunk_indices(n: int, chunk_size: int) -> List[np.ndarray]:
    return [np.arange(i, min(n, i + chunk_size)) for i in range(0, n, chunk_size) if min(n, i + chunk_size) - i > 0]


def compute_chunk_stability_on_slice(pnl_slice: np.ndarray, kept_mask_slice: np.ndarray, chunk_size: int, min_chunk_kept_pct: float):
    chunks = chunk_indices(len(pnl_slice), chunk_size)
    evs = []
    beat = 0
    valid = 0
    for idx in chunks:
        kept = kept_mask_slice[idx]
        if kept.sum() < min_chunk_kept_pct * len(idx):
            continue
        valid += 1
        ev_base = float(np.mean(pnl_slice[idx]))
        ev_kept = float(np.mean(pnl_slice[idx][kept]))
        evs.append(ev_kept)
        if ev_kept > ev_base:
            beat += 1
    if valid == 0:
        return 0, float("nan"), float("nan")
    evs = np.array(evs, dtype=float)
    return valid, float(np.std(evs, ddof=0)), float(beat / valid)


def build_candidate_gates(df: pd.DataFrame, col: str) -> List[Gate]:
    x = df[col].to_numpy(dtype=float)
    x = x[np.isfinite(x)]
    if len(x) < 80:
        return []
    if float(np.nanstd(x)) < 1e-12:
        return []
    qs = np.unique(np.quantile(x, DEFAULT_QUANTILES))
    gates: List[Gate] = []
    for t in qs:
        gates.append(Gate(kind="le", col=col, t=float(t)))
        gates.append(Gate(kind="ge", col=col, t=float(t)))
    for qlo, qhi in DEFAULT_OUTSIDE_PAIRS:
        lo = float(np.quantile(x, qlo))
        hi = float(np.quantile(x, qhi))
        if lo < hi:
            gates.append(Gate(kind="outside", col=col, lo=lo, hi=hi))
    return gates


def placebo_percentile(pnl_test: np.ndarray, kept_mask_test: np.ndarray, runs: int, seed: int) -> float:
    rng = np.random.default_rng(seed)
    n = len(pnl_test)
    kept_n = int(kept_mask_test.sum())
    if kept_n <= 0 or kept_n >= n:
        return float("nan")
    ev_rule = float(np.mean(pnl_test[kept_mask_test]))
    ev_rand = []
    for _ in range(runs):
        idx = rng.choice(n, size=kept_n, replace=False)
        ev_rand.append(float(np.mean(pnl_test[idx])))
    ev_rand = np.array(ev_rand, dtype=float)
    return float((ev_rand < ev_rule).mean() * 100.0)


# -----------------------------
# SEARCH evaluation (train+val only)
# -----------------------------
def evaluate_candidate_search(
    df: pd.DataFrame,
    pnl: np.ndarray,
    is_win: Optional[np.ndarray],
    idx_train: np.ndarray,
    idx_val: np.ndarray,
    idx_test: np.ndarray,
    skip_mask_all: np.ndarray,
    max_skip_pct: float,
    min_kept_pct_split: float,
    chunk_size: int,
    min_chunks: int,
    min_chunk_kept_pct: float,
    lambda_chunk_std: float,
    beat_frac_req: float,
    penalty_chunk_fail: float,
    lambda_instability_tv: float,
    penalty_low_kept: float,
) -> Optional[SearchMetrics]:

    n = len(df)

    skip_pct_all = float(skip_mask_all.mean())
    if skip_pct_all > max_skip_pct:
        return None

    kept_all = ~skip_mask_all

    m_train = np.zeros(n, dtype=bool); m_train[idx_train] = True
    m_val = np.zeros(n, dtype=bool);   m_val[idx_val] = True
    m_test = np.zeros(n, dtype=bool);  m_test[idx_test] = True

    kept_train = kept_all & m_train
    kept_val = kept_all & m_val
    kept_test = kept_all & m_test

    if kept_train.sum() < min_kept_pct_split * m_train.sum(): return None
    if kept_val.sum()   < min_kept_pct_split * m_val.sum():   return None
    if kept_test.sum()  < min_kept_pct_split * m_test.sum():  return None

    mt_train = compute_ev_win_pnl(pnl, is_win, kept_train)
    mt_val = compute_ev_win_pnl(pnl, is_win, kept_val)

    ev_train = mt_train["ev"]
    ev_val = mt_val["ev"]
    instability_tv = float(np.std([ev_train, ev_val], ddof=0))

    idx_tv = np.concatenate([idx_train, idx_val])
    pnl_tv = pnl[idx_tv]
    kept_tv = kept_all[idx_tv]
    mt_tv = compute_ev_win_pnl(pnl_tv, is_win[idx_tv] if is_win is not None else None, kept_tv)

    skip_pct_tv = 1.0 - float(kept_tv.mean())
    kept_pct_tv = 1.0 - skip_pct_tv

    chunk_valid_n, chunk_ev_std, beat_frac = compute_chunk_stability_on_slice(
        pnl_slice=pnl_tv,
        kept_mask_slice=kept_tv,
        chunk_size=chunk_size,
        min_chunk_kept_pct=min_chunk_kept_pct,
    )
    if chunk_valid_n < min_chunks:
        return None

    beat_short = max(0.0, beat_frac_req - beat_frac)
    pen_chunk_fail = penalty_chunk_fail * beat_short
    pen_low_kept = penalty_low_kept * max(0.0, (min_kept_pct_split - kept_pct_tv))

    score_search = (
        float(mt_tv["ev"])
        - (lambda_instability_tv * instability_tv)
        - (lambda_chunk_std * chunk_ev_std)
        - pen_chunk_fail
        - pen_low_kept
    )

    return SearchMetrics(
        score_search=score_search,
        skip_pct_tv=skip_pct_tv,
        ev_train=ev_train,
        ev_val=ev_val,
        instability_tv=instability_tv,
        kept_n_train=int(mt_train["kept_n"]),
        kept_n_val=int(mt_val["kept_n"]),
        pnl_total_tv=float(mt_tv["pnl_total"]),
        winrate_tv=float(mt_tv["winrate"]),
        chunk_valid_n=chunk_valid_n,
        chunk_ev_std=chunk_ev_std,
        chunk_beat_baseline_frac=beat_frac,
    )


# -----------------------------
# FINAL evaluation on TEST only
# -----------------------------
def evaluate_candidate_test(pnl: np.ndarray, is_win: Optional[np.ndarray], idx_test: np.ndarray, skip_mask_all: np.ndarray, placebo_runs: int, placebo_seed: int) -> FinalMetrics:
    kept_test = ~(skip_mask_all[idx_test])
    pnl_test = pnl[idx_test]
    mt_test = compute_ev_win_pnl(pnl_test, is_win[idx_test] if is_win is not None else None, kept_test)

    ev_test = float(mt_test["ev"])
    kept_n_test = int(mt_test["kept_n"])
    pnl_total_test = float(mt_test["pnl_total"])
    winrate_test = float(mt_test["winrate"])

    pp = None
    if placebo_runs > 0:
        pp = placebo_percentile(pnl_test, kept_test, runs=placebo_runs, seed=placebo_seed)

    score_test = ev_test
    return FinalMetrics(score_test, ev_test, kept_n_test, pnl_total_test, winrate_test, pp)


# -----------------------------
# Shadow forward report (TEST chunks)
# -----------------------------
def write_shadow_report(path: str, df_test: pd.DataFrame, pnl_test: np.ndarray, candidates: List[Candidate], chunk_size: int, top_k: int):
    chunks = chunk_indices(len(pnl_test), chunk_size)

    with open(path, "w", encoding="utf-8") as f:
        f.write("SHADOW FORWARD TEST REPORT (TEST period only)\n")
        f.write(f"Chunks: size={chunk_size}, chunks={len(chunks)}, rows={len(pnl_test)}\n\n")

        for rank, c in enumerate(candidates[:top_k], start=1):
            skip_mask_test = np.zeros(len(df_test), dtype=bool)
            for g in c.gates:
                skip_mask_test |= g.eval_skip_mask(df_test)
            kept_test = ~skip_mask_test

            f.write("=" * 90 + "\n")
            f.write(f"RANK #{rank}\nRULE: {c.rule}\n")
            f.write(f"SEARCH score={c.search.score_search:.6f}, tv_skip={c.search.skip_pct_tv*100:.2f}%\n")
            if c.final is not None:
                f.write(f"TEST ev={c.final.ev_test:.6f}, kept_n={c.final.kept_n_test}, placebo={c.final.placebo_percentile}\n\n")

            cum_base = 0.0
            cum_gate = 0.0
            f.write("chunk\tbaseEV\tgateEV\tkeptN\tbasePNL\tgatePNL\tcumBase\tcumGate\tΔcum\n")

            for i, idx in enumerate(chunks, start=1):
                pnl_c = pnl_test[idx]
                kept_c = kept_test[idx]

                base_ev = float(np.mean(pnl_c))
                base_pnl = float(np.sum(pnl_c))

                if kept_c.sum() == 0:
                    gate_ev = float("nan")
                    gate_pnl = 0.0
                    kept_n = 0
                else:
                    gate_ev = float(np.mean(pnl_c[kept_c]))
                    gate_pnl = float(np.sum(pnl_c[kept_c]))
                    kept_n = int(kept_c.sum())

                cum_base += base_pnl
                cum_gate += gate_pnl

                f.write(
                    f"{i}\t{base_ev:.6f}\t{gate_ev:.6f}\t{kept_n}\t"
                    f"{base_pnl:.2f}\t{gate_pnl:.2f}\t{cum_base:.2f}\t{cum_gate:.2f}\t{(cum_gate-cum_base):.2f}\n"
                )
            f.write("\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path", nargs="?", default="trades_with_features.csv")
    parser.add_argument("--pnl_col", default="pnl")
    parser.add_argument("--iswin_col", default="isWin")

    parser.add_argument("--max_skip_pct", type=float, default=DEFAULT_MAX_SKIP_PCT)
    parser.add_argument("--max_gates_in_combo", type=int, default=DEFAULT_MAX_GATES_IN_COMBO)
    parser.add_argument("--logic", default=DEFAULT_LOGIC)
    parser.add_argument("--top_singles_for_combos", type=int, default=DEFAULT_TOP_SINGLES_FOR_COMBOS)
    parser.add_argument("--top_n_output", type=int, default=DEFAULT_TOP_N_OUTPUT)

    parser.add_argument("--lock_top_k_all", type=int, default=DEFAULT_LOCK_TOP_K_ALL)
    parser.add_argument("--lock_top_k_singles", type=int, default=DEFAULT_LOCK_TOP_K_SINGLES)
    parser.add_argument("--combo_limit", type=int, default=DEFAULT_COMBO_LIMIT)

    parser.add_argument("--min_kept_pct_split", type=float, default=DEFAULT_MIN_KEPT_PCT_SPLIT)
    parser.add_argument("--lambda_instability_tv", type=float, default=DEFAULT_LAMBDA_INSTABILITY_TV)
    parser.add_argument("--penalty_low_kept", type=float, default=DEFAULT_PENALTY_LOW_KEPT)

    parser.add_argument("--chunk_size", type=int, default=DEFAULT_CHUNK_SIZE)
    parser.add_argument("--min_chunks", type=int, default=DEFAULT_MIN_CHUNKS)
    parser.add_argument("--min_chunk_kept_pct", type=float, default=DEFAULT_MIN_CHUNK_KEPT_PCT)
    parser.add_argument("--lambda_chunk_std", type=float, default=DEFAULT_LAMBDA_CHUNK_STD)
    parser.add_argument("--chunk_beat_baseline_frac", type=float, default=DEFAULT_CHUNK_BEAT_BASELINE_FRAC)
    parser.add_argument("--penalty_chunk_fail", type=float, default=DEFAULT_PENALTY_CHUNK_FAIL)

    parser.add_argument("--placebo_runs", type=int, default=DEFAULT_PLACEBO_RUNS)
    parser.add_argument("--placebo_top_k", type=int, default=DEFAULT_PLACEBO_TOP_K)
    parser.add_argument("--shadow_top_k", type=int, default=DEFAULT_SHADOW_TOP_K)

    args = parser.parse_args()

    random.seed(RANDOM_SEED)
    np.random.seed(RANDOM_SEED)

    if not os.path.exists(args.csv_path):
        raise FileNotFoundError(f"CSV not found: {args.csv_path}")

    df = pd.read_csv(args.csv_path)
    if args.pnl_col not in df.columns:
        raise ValueError(f"Missing pnl column: {args.pnl_col}")

    time_col = detect_time_column(df)
    df = sort_by_time_or_index(df, time_col)

    pnl = df[args.pnl_col].to_numpy(dtype=float)

    is_win = None
    if args.iswin_col in df.columns:
        w = df[args.iswin_col]
        if w.dtype == bool:
            is_win = w.to_numpy(dtype=bool)
        else:
            is_win = w.fillna(0).astype(int).to_numpy(dtype=int) != 0

    n = len(df)
    idx_train, idx_val, idx_test = time_splits(n, 0.60, 0.20)

    exclude = {args.pnl_col, args.iswin_col}
    for c in ["slug","marketId","tradeId","symbol","session","error","window","hourOfDayUTC","dayOfWeekUTC","startedAt","asOfTimeMs"]:
        if c in df.columns:
            exclude.add(c)
    if time_col is not None:
        exclude.add(time_col)

    numeric_cols = []
    for c in df.columns:
        if c in exclude:
            continue
        if pd.api.types.is_numeric_dtype(df[c]) and df[c].notna().mean() >= 0.80:
            numeric_cols.append(c)

    if not numeric_cols:
        raise ValueError("No numeric indicator columns found after filtering.")

    logic = {s.strip().lower() for s in args.logic.split(",") if s.strip()}
    allow_single = "single" in logic
    allow_or = "or" in logic

    print(f"[info] N={n} file={args.csv_path}")
    print(f"[info] time_col={time_col if time_col else '(none)'}")
    print(f"[info] indicators={len(numeric_cols)}")
    print(f"[info] protocol: SEARCH on train+val (80%), FINAL on test (20%)")

    # Build all single gate candidates
    all_single_gates: List[Gate] = []
    for col in numeric_cols:
        all_single_gates.extend(build_candidate_gates(df, col))
    print(f"[info] single gate candidates: {len(all_single_gates)}")

    single_candidates: List[Candidate] = []
    combo_candidates: List[Candidate] = []

    # Evaluate singles (SEARCH)
    if allow_single:
        for g in all_single_gates:
            skip_mask = g.eval_skip_mask(df)
            sm = evaluate_candidate_search(
                df, pnl, is_win,
                idx_train, idx_val, idx_test,
                skip_mask,
                args.max_skip_pct,
                args.min_kept_pct_split,
                args.chunk_size, args.min_chunks, args.min_chunk_kept_pct,
                args.lambda_chunk_std, args.chunk_beat_baseline_frac, args.penalty_chunk_fail,
                args.lambda_instability_tv, args.penalty_low_kept
            )
            if sm is None:
                continue
            single_candidates.append(Candidate(rule=f"SKIP = {g.to_expr()}", gates=(g,), is_single=True, search=sm))

        single_candidates.sort(key=lambda x: x.search.score_search, reverse=True)
        print(f"[info] valid single candidates (SEARCH): {len(single_candidates)}")

    # OR combos from top singles pool (SEARCH)
    if allow_or and args.max_gates_in_combo >= 2 and single_candidates:
        pool = single_candidates[: args.top_singles_for_combos]
        pool_gates = [c.gates[0] for c in pool]
        print(f"[info] building OR combos from top singles pool K={len(pool_gates)}")

        attempted = 0
        valid = 0
        for k in range(2, min(args.max_gates_in_combo, 3) + 1):
            for gs in combinations(pool_gates, k):
                attempted += 1
                if attempted > args.combo_limit:
                    break
                skip_mask = np.zeros(n, dtype=bool)
                for g in gs:
                    skip_mask |= g.eval_skip_mask(df)

                sm = evaluate_candidate_search(
                    df, pnl, is_win,
                    idx_train, idx_val, idx_test,
                    skip_mask,
                    args.max_skip_pct,
                    args.min_kept_pct_split,
                    args.chunk_size, args.min_chunks, args.min_chunk_kept_pct,
                    args.lambda_chunk_std, args.chunk_beat_baseline_frac, args.penalty_chunk_fail,
                    args.lambda_instability_tv, args.penalty_low_kept
                )
                if sm is None:
                    continue

                expr = " OR ".join([g.to_expr() for g in gs])
                combo_candidates.append(Candidate(rule=f"SKIP = {expr}", gates=tuple(gs), is_single=False, search=sm))
                valid += 1
            if attempted > args.combo_limit:
                break

        combo_candidates.sort(key=lambda x: x.search.score_search, reverse=True)
        print(f"[info] OR combos attempted={attempted}, valid={valid}")

    # ---- LOCK sets (FIX) ----
    locked_all = (single_candidates + combo_candidates)
    locked_all.sort(key=lambda x: x.search.score_search, reverse=True)
    locked_all = locked_all[: min(args.lock_top_k_all, len(locked_all))]

    locked_singles = single_candidates[: min(args.lock_top_k_singles, len(single_candidates))]

    # Merge (dedupe by rule)
    seen = set()
    locked = []
    for c in locked_all + locked_singles:
        if c.rule in seen:
            continue
        seen.add(c.rule)
        locked.append(c)

    print(f"[info] locked candidates for FINAL TEST eval: {len(locked)} (all+singles merge)")

    # FINAL evaluate on TEST only
    for i, c in enumerate(locked):
        skip_mask = np.zeros(n, dtype=bool)
        for g in c.gates:
            skip_mask |= g.eval_skip_mask(df)

        c.final = evaluate_candidate_test(
            pnl, is_win, idx_test, skip_mask,
            placebo_runs=(args.placebo_runs if i < args.placebo_top_k else 0),
            placebo_seed=RANDOM_SEED + 2000 + i,
        )

    # FINAL ranking by TEST
    locked.sort(
        key=lambda x: (
            x.final.score_test if x.final else float("-inf"),
            (x.final.placebo_percentile if (x.final and x.final.placebo_percentile is not None and not math.isnan(x.final.placebo_percentile)) else -1.0)
        ),
        reverse=True
    )

    top_all = locked[: args.top_n_output]

    # IMPORTANT FIX: top_singles comes from ALL TEST-evaluated singles, not just "whatever survived" in locked_all
    all_tested_singles = [c for c in locked if c.is_single]
    all_tested_singles.sort(key=lambda x: x.final.score_test if x.final else float("-inf"), reverse=True)
    top_singles = all_tested_singles[: max(args.top_n_output, 200)]

    def cand_to_row(c: Candidate) -> Dict[str, object]:
        return {
            "score_test": c.final.score_test if c.final else None,
            "ev_test": c.final.ev_test if c.final else None,
            "kept_n_test": c.final.kept_n_test if c.final else None,
            "pnl_total_test": c.final.pnl_total_test if c.final else None,
            "winrate_test": c.final.winrate_test if c.final else None,
            "placebo_percentile": c.final.placebo_percentile if c.final else None,

            "score_search": c.search.score_search,
            "skip_pct_tv": c.search.skip_pct_tv,
            "ev_train": c.search.ev_train,
            "ev_val": c.search.ev_val,
            "instability_tv": c.search.instability_tv,
            "kept_n_train": c.search.kept_n_train,
            "kept_n_val": c.search.kept_n_val,
            "pnl_total_tv": c.search.pnl_total_tv,
            "winrate_tv": c.search.winrate_tv,
            "chunk_valid_n": c.search.chunk_valid_n,
            "chunk_ev_std": c.search.chunk_ev_std,
            "chunk_beat_baseline_frac": c.search.chunk_beat_baseline_frac,

            "is_single": c.is_single,
            "rule": c.rule,
        }

    pd.DataFrame([cand_to_row(c) for c in top_all]).to_csv("top_gates.csv", index=False)
    pd.DataFrame([cand_to_row(c) for c in top_singles]).to_csv("top_singles.csv", index=False)

    with open("top_gates.txt", "w", encoding="utf-8") as f:
        f.write("TOP GATES (FINAL ranking by TEST only)\n")
        f.write("Protocol: SEARCH on train+val, FINAL on test\n")
        f.write(f"N={n}, time_col={time_col}\n\n")
        for i, c in enumerate(top_all, start=1):
            f.write(f"#{i}\nRULE: {c.rule}\n")
            f.write(f"FINAL: ev_test={c.final.ev_test:.6f} kept_n_test={c.final.kept_n_test} placebo={c.final.placebo_percentile}\n")
            f.write(f"SEARCH: score={c.search.score_search:.6f} tv_skip={c.search.skip_pct_tv*100:.2f}% ev_train={c.search.ev_train:.6f} ev_val={c.search.ev_val:.6f}\n")
            f.write(f"SEARCH chunk: valid={c.search.chunk_valid_n} chunk_ev_std={c.search.chunk_ev_std:.6f} beat_frac={c.search.chunk_beat_baseline_frac:.3f}\n\n")

    with open("top_singles.txt", "w", encoding="utf-8") as f:
        f.write("TOP SINGLE GATES (FINAL ranking by TEST only)\n")
        f.write("Protocol: SEARCH on train+val, FINAL on test\n\n")
        for i, c in enumerate(top_singles, start=1):
            f.write(f"#{i}\nRULE: {c.rule}\n")
            f.write(f"FINAL: ev_test={c.final.ev_test:.6f} kept_n_test={c.final.kept_n_test} placebo={c.final.placebo_percentile}\n")
            f.write(f"SEARCH: score={c.search.score_search:.6f} tv_skip={c.search.skip_pct_tv*100:.2f}% ev_train={c.search.ev_train:.6f} ev_val={c.search.ev_val:.6f}\n")
            f.write(f"SEARCH chunk: valid={c.search.chunk_valid_n} chunk_ev_std={c.search.chunk_ev_std:.6f} beat_frac={c.search.chunk_beat_baseline_frac:.3f}\n\n")

    print("[done] wrote top_gates.csv/.txt and top_singles.csv/.txt")

    # Shadow forward report on TEST
    df_test = df.iloc[idx_test].reset_index(drop=True)
    pnl_test = pnl[idx_test]

    write_shadow_report(
        path="shadow_report_top.txt",
        df_test=df_test,
        pnl_test=pnl_test,
        candidates=top_all,
        chunk_size=args.chunk_size,
        top_k=args.shadow_top_k,
    )
    print("[done] wrote shadow_report_top.txt")


if __name__ == "__main__":
    main()
