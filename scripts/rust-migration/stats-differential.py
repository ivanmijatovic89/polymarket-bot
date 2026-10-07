"""Full-output Rust/TypeScript parity with hash-pinned independent source provenance.

Run after building the native executable. No private data or services required.
Fixtures cover actual ordering/streak semantics, ISO year boundaries, negative
rounding, busy intervals, numerical quality guards and every last-N threshold.
"""
import argparse
import hashlib
import json
import random
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = "07245602d6ff9bca0dcdf772134cba3dd227526c"
SOURCES = ["src/backtest/stats/batchStats.ts", "src/backtest/stats/backtestSegments.ts", "src/backtest/stats/wallClock.ts"]
DAY = 86_400_000
START = 1_609_286_400_000  # 2020-12-30 UTC, spanning the ISO year boundary.


def market(pnl=0, time=START, **extra):
    return {"marketId": "market", "slug": "btc-updown-15m-1609286400", "finalOutcome": "UP",
            "pnl": pnl, "tradeCount": 0 if pnl == 0 else 1, "tradeAsMaker": 0,
            "tradeAsTaker": 0 if pnl == 0 else 1, "feesPaid": 0.013,
            "avgEntryPriceUp": None, "avgEntryPriceDown": None, "upShares": 0,
            "downShares": 0, "mergableShares": 0, "cost": 0, "splitCost": 0,
            "intentMeta": [], "marketStartMs": time, **extra}


def fixtures():
    cases = []

    def add(name, markets, initial=1000):
        cases.append({"name": name, "input": {"markets": markets, "initialCapital": initial}})

    add("empty", [])
    add("no-activity-flat-and-zero-bridging-streaks", [market(p, START+i*DAY,
        **({"skipReason": "no_in_window_activity"} if i == 1 else {"tradeCount": 2} if i == 4 else {}))
        for i, p in enumerate([1, 0, 2, -1, 0, -2, 0, 3, 4, -9])])
    add("input-order-differs-from-calendar", [market(2, START+2*DAY), market(-3, START), market(5, START+DAY)])
    add("stable-timestamp-ties", [market(p, START) for p in [1, -2, 3, 0, 4, -5]])
    add("iso-year-boundaries", [market(i-3, t) for i,t in enumerate([
        1_451_520_000_000, 1_451_865_600_000, 1_609_372_800_000, 1_609_459_200_000,
        1_609_718_400_000, 1_704_067_200_000, 1_735_516_800_000])])
    add("pre-epoch-and-fractional-date", [market(p,t) for p,t in [(1,-DAY-0.1),(-2,-0.1),(3,0),(4,0.9),(5,DAY)]])
    add("javascript-utc-small-and-expanded-years", [market(i+1,t) for i,t in enumerate([
        -62_198_755_200_000, -62_167_219_200_000, -59_011_459_200_000,
        253_402_300_800_000, 253_402_387_200_000])])
    add("year-zero-leap-day-utc-normalization", [market(1, -62_162_121_600_000)])
    # Chrono MIN=-262143-01-01 and MAX=262142-12-31; our native calendar
    # must also accept the entire surrounding JavaScript TimeClip domain.
    def civil_days(year, month, day):
        year -= month <= 2
        era = year // 400
        yoe = year - era*400
        mp = month + (-3 if month > 2 else 9)
        doy = (153*mp+2)//5 + day-1
        return era*146097 + yoe*365 + yoe//4 - yoe//100 + doy - 719468

    chrono_min = civil_days(-262143,1,1)*DAY
    chrono_max = civil_days(262143,1,1)*DAY-1
    extremes = [-8_640_000_000_000_000, -8_640_000_000_000_000+1,
        -8_300_000_000_000_000, chrono_min-1, chrono_min, chrono_min+1,
        chrono_max-1, chrono_max, chrono_max+1, 8_300_000_000_000_000,
        8_640_000_000_000_000-1, 8_640_000_000_000_000]
    for index,timestamp in enumerate(extremes):
        add(f"javascript-date-domain-{index}",[market(index-5,timestamp)])
    add("combined-extreme-calendar-buckets",[market(i-5,t) for i,t in enumerate(reversed(extremes))])
    date_rng=random.Random(831400)
    for index in range(10):
        add(f"seeded-full-date-domain-{index}",[market((i%5)-2,date_rng.randrange(-8_640_000_000_000_000,8_640_000_000_000_001)) for i in range(25)])
    for p in [0.005, -0.005, 0.004999999999999999, -0.015, 1.005, -1.005, 0.125, -0.125]:
        add(f"rounding-{p}", [market(p, feesPaid=p)], initial=0)
    add("quality-constant", [market(3) for _ in range(20)])
    add("quality-near-constant-guard", [market(10+i*1e-10) for i in range(20)])
    add("quality-underflow-and-overflow-guard", [market(p) for p in [1e-200, -1e-200, 1e200, -1e200]])
    intervals = [(0,10),(5,15),(15,20),(30,40),(80,70),(50,50),(-10,-5)]
    add("busy-union-overlap-adjacency-disjoint-and-reversed", [market(i+1,execution={
        "durationMs": abs(b-a)+0.25, "startedAtMs": a, "finishedAtMs": b}) for i,(a,b) in enumerate(intervals)])
    add("duration-optional-null-and-no-interval", [market(1), market(2,execution=None),
        market(3,execution={"durationMs":None,"startedAtMs":0,"finishedAtMs":999}),
        market(4,execution={"durationMs":-5,"startedAtMs":20,"finishedAtMs":10})])
    add("preserve-extra-metadata", [market(1,arbitrary={"exact":"123.000000000000001","nested":[True,None]})])
    for count in [499,500,999,1000,2999,3000,5999,6000,6001]:
        # Reverse input forces calendar/tail sorting; tied timestamps exercise stability.
        add(f"tail-threshold-{count}", [market((i%7)-3, START+(i//2)*900_000) for i in reversed(range(count))])
    rng = random.Random(721409)
    for index in range(40):
        rows = []
        for i in range(rng.randint(1,70)):
            pnl = rng.choice([0,0,0,-7.125,-0.005,0.005,2.125,13.01])
            rows.append(market(pnl, START+rng.randrange(-20,40)*DAY,
                execution={"durationMs":rng.random()*200,"startedAtMs":i*10,"finishedAtMs":i*10+30}))
        rng.shuffle(rows)
        add(f"seeded-mixed-{index}",rows,initial=rng.choice([0,100,1000.125]))
    return cases


def assert_equal(expected,actual,path="$"):
    if isinstance(expected,dict):
        if not isinstance(actual,dict) or expected.keys()!=actual.keys():
            raise AssertionError(f"{path}: object keys differ")
        for key in expected:
            assert_equal(expected[key],actual[key],f"{path}.{key}")
    elif isinstance(expected,list):
        if not isinstance(actual,list) or len(expected)!=len(actual):
            raise AssertionError(f"{path}: array length differs")
        for index,(left,right) in enumerate(zip(expected,actual)):
            assert_equal(left,right,f"{path}[{index}]")
    elif (isinstance(expected,bool) != isinstance(actual,bool)) or expected!=actual:
        raise AssertionError(f"{path}: TS={expected!r} Rust={actual!r}")



def assert_comparator_rejects_boolean_numbers():
    mutations=[(0,False),(1,True),(False,0),(True,1),(0.0,False),(1.0,True),
        (False,0.0),(True,1.0),({"a":0},{"a":False}),([1],[True])]
    for expected,actual in mutations:
        try:
            assert_equal(expected,actual)
        except AssertionError:
            continue
        raise AssertionError("JSON comparator accepted a boolean/number mutation")
    assert_equal(False,False)
    assert_equal(True,True)
    assert_equal(0,0.0)
    assert_equal(1,1.0)
    return len(mutations)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--node",required=True)
    parser.add_argument("--binary",type=Path,default=ROOT/"native/trading-runtime/target/debug/polymarket-runtime")
    parser.add_argument("--report",type=Path)
    args=parser.parse_args()
    version=subprocess.check_output([args.node,"--version"],text=True).strip()
    if not version.startswith("v20."):
        raise RuntimeError("Pinned production oracle requires Node 20")
    fingerprints={}
    for path in SOURCES:
        pinned=subprocess.check_output(["git","show",f"{REFERENCE}:{path}"],cwd=ROOT)
        current=(ROOT/path).read_bytes()
        if current!=pinned:
            raise RuntimeError(f"Oracle source differs from reference commit: {path}")
        fingerprints[path]=hashlib.sha256(current).hexdigest()
    mutation_count=assert_comparator_rejects_boolean_numbers()
    wrappers=[Path(__file__).resolve(), ROOT/"scripts/rust-migration/stats-oracle.mts"]
    wrapper_hashes={str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in wrappers}
    cases=fixtures()
    payload=json.dumps({"cases":cases},separators=(",",":"))
    with tempfile.TemporaryDirectory(prefix="rust-stats-parity-") as directory:
        original_binary=args.binary.resolve()
        binary_before=hashlib.sha256(original_binary.read_bytes()).hexdigest()
        frozen_binary=Path(directory)/"polymarket-runtime"
        shutil.copy2(original_binary,frozen_binary)
        frozen_hash=hashlib.sha256(frozen_binary.read_bytes()).hexdigest()
        if frozen_hash!=binary_before or hashlib.sha256(original_binary.read_bytes()).hexdigest()!=binary_before:
            raise RuntimeError("Native executable changed while freezing the differential snapshot")
        source=Path(directory)/"input.json"
        source.write_text(payload)
        expected=json.loads(subprocess.check_output([args.node,"--import","tsx",str(ROOT/"scripts/rust-migration/stats-oracle.mts"),str(source)],cwd=ROOT,text=True))
        requests="".join(json.dumps({"protocolVersion":1,"requestId":case["name"],"operation":"aggregate","input":case["input"]},separators=(",",":"))+"\n" for case in cases)
        execution=subprocess.run([str(frozen_binary)],input=requests,capture_output=True,text=True,check=True)
        actual=[json.loads(line) for line in execution.stdout.splitlines()]
        if hashlib.sha256(frozen_binary.read_bytes()).hexdigest()!=frozen_hash:
            raise RuntimeError("Frozen native executable changed during comparison")
    for path,digest in fingerprints.items():
        if hashlib.sha256((ROOT/path).read_bytes()).hexdigest()!=digest:
            raise RuntimeError(f"Pinned TypeScript oracle changed during comparison: {path}")
    for path,digest in wrapper_hashes.items():
        if hashlib.sha256((ROOT/path).read_bytes()).hexdigest()!=digest:
            raise RuntimeError(f"Differential wrapper changed during comparison: {path}")
    if len(expected)!=len(actual):
        raise AssertionError("Native response count differs")
    for left,right in zip(expected,actual):
        if right.get("requestId")!=left["name"] or right.get("status")!="success":
            raise AssertionError(f"{left['name']}: invalid native response {right}")
        assert_equal(left["result"],right["result"],left["name"])
    report={"referenceCommit":REFERENCE,"oracleSourceSha256":fingerprints,"node":version,
        "nativeBinarySha256":frozen_hash,"nativeBinaryFrozenForExecution":True,
        "oracleWrapperSha256":wrapper_hashes["scripts/rust-migration/stats-oracle.mts"],
        "differentialRunnerSha256":wrapper_hashes["scripts/rust-migration/stats-differential.py"],
        "booleanNumberMutationChecks":mutation_count,
        "fixturesSha256":hashlib.sha256(payload.encode()).hexdigest(),"cases":len(cases),
        "marketRows":sum(len(case["input"]["markets"]) for case in cases),"fullOutputParity":True}
    if args.report:
        args.report.write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2))


if __name__=="__main__":
    main()
