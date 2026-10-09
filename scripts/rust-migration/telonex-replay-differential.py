"""Actual telonex replay body comparison against the pinned TS production function."""
import argparse
import hashlib
import importlib.util
import os
import json
import re
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
NATIVE = ROOT / "native/trading-runtime"
REFERENCE = "07245602d6ff9bca0dcdf772134cba3dd227526c"
SOURCES = ["src/parquet/replay/replayTelonexPairedParquetForMarket.ts", "src/parquet/replay/replayTelonexDeltaParquetForMarket.ts", "src/market/MarketEngine.ts", "src/market/marketChannelDecoder.ts", "src/utils/minHeap.ts", "src/utils/toBigInt.ts", "src/cli/helpers/openParquetReader.ts"]
WRAPPERS = ["scripts/rust-migration/telonex-replay-differential.py", "scripts/rust-migration/telonex-replay-oracle.mts",
    "scripts/rust-migration/dispatch-differential.py", "scripts/rust-migration/dispatch-dependency-preload.cjs",
    "scripts/rust-migration/dispatch-dependency-loader.mjs", "package.json", "package-lock.json"]
# Shared evidence-only guards; no instrumentation enters trading execution.
_spec = importlib.util.spec_from_file_location("dispatch_provenance", ROOT / WRAPPERS[2])
provenance = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(provenance)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def native_hashes():
    files = [NATIVE / "Cargo.toml", NATIVE / "Cargo.lock", NATIVE / "tests/telonex_replay.rs"]
    files += sorted((NATIVE / "src").rglob("*.rs"))
    return {str(path.relative_to(ROOT)): digest(path) for path in files}

def compare(expected, actual, cases):
    names = [case["name"] for case in cases]
    if not all(isinstance(name, str) for name in names) or len(set(names)) != len(names):
        raise AssertionError("Fixture identities must be unique strings")
    for output in [expected, actual]:
        if not isinstance(output, list) or len(output) != len(cases):
            raise AssertionError("Output count does not match fixtures")
        for index, row in enumerate(output):
            if not isinstance(row, dict) or set(row) != {"name", "ticks", "failed"} or row["name"] != names[index] or type(row["failed"]) is not bool or not isinstance(row["ticks"], list):
                raise AssertionError("Invalid output envelope/types/identity")
            for tick in row["ticks"]:
                if not isinstance(tick, dict) or set(tick) != {"snapshot", "msg", "source", "rawJson"} or any(not isinstance(tick[key], dict) for key in ["snapshot", "msg", "source"]) or tick["rawJson"] != "":
                    raise AssertionError("Invalid Telonex tick envelope/types")
                source = tick["source"]
                if source.get("kind") != "parquet" or not isinstance(source.get("filePath"), str) or not isinstance(source.get("ingestSeq"), str) or re.fullmatch(r"0|-?[1-9][0-9]*", source["ingestSeq"]) is None:
                    raise AssertionError("Invalid exact Parquet source identity")
    if json.dumps(expected, sort_keys=True) != json.dumps(actual, sort_keys=True):
        for index, (left, right) in enumerate(zip(expected, actual)):
            if json.dumps(left, sort_keys=True) != json.dumps(right, sort_keys=True):
                raise AssertionError(f"case {index}: TS={left} Rust={right}")
        raise AssertionError("Output mismatch")

def mutation_checks():
    sample = [{"name": "probe", "failed": False, "ticks": [{"source": {"kind":"parquet", "filePath":"fixture.parquet", "ingestSeq": "18446744073709551617"}, "snapshot": {"timestamp": 1}, "msg": {"market": "m"}, "rawJson": ""}]}]
    cases = [{"name": "probe"}]
    for change in ["omit", "duplicate", "identity", "bool", "sequence", "snapshot", "raw", "tick", "message"]:
        value = json.loads(json.dumps(sample)); result = value[0]
        if change == "omit": value.clear()
        elif change == "duplicate": value *= 2
        elif change == "identity": result["name"] = "other"
        elif change == "bool": result["failed"] = 0
        elif change == "sequence": result["ticks"][0]["source"]["ingestSeq"] = "18446744073709551616"
        elif change == "snapshot": result["ticks"][0]["snapshot"]["timestamp"] = 2
        elif change == "raw": result["ticks"][0]["rawJson"] = "changed"
        elif change == "tick": result["ticks"] = []
        else: result["ticks"][0]["msg"]["market"] = "other"
        try: compare(sample, value, cases)
        except AssertionError: pass
        else: raise AssertionError("Comparator accepted deliberate mutation")
    compare(sample, sample, cases)
    for change in ["bool", "ticks", "envelope", "source", "raw", "doubleSign", "leadingZero", "unicodeDigit"]:
        value = json.loads(json.dumps(sample))
        if change == "bool": value[0]["failed"] = 0
        elif change == "ticks": value[0]["ticks"] = None
        elif change == "envelope": value[0]["unexpected"] = True
        elif change == "source": value[0]["ticks"][0]["source"]["ingestSeq"] = 7
        elif change == "raw": value[0]["ticks"][0]["rawJson"] = None
        else: value[0]["ticks"][0]["source"]["ingestSeq"] = {"doubleSign":"--1", "leadingZero":"01", "unicodeDigit":"١"}[change]
        try: compare(value, value, cases)
        except AssertionError: pass
        else: raise AssertionError("Comparator accepted symmetric malformed outputs")
    return 17

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--node", required=True)
    parser.add_argument("--cargo", default=str(Path.home() / ".cargo/bin/cargo"))
    parser.add_argument("--release", action="store_true")
    parser.add_argument("--target-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    node_version = subprocess.check_output([args.node, "--version"], text=True).strip()
    if not node_version.startswith("v20."): raise RuntimeError("Node 20 required before any build")
    tools_before = provenance.tooling(args.node, args.cargo)
    dependency_mutations = provenance.dependency_mutation_checks()
    reference_hashes = {}
    for path in SOURCES:
        current = (ROOT / path).read_bytes()
        if current != subprocess.check_output(["git", "show", f"{REFERENCE}:{path}"], cwd=ROOT):
            raise RuntimeError(f"Unpinned oracle source: {path}")
        reference_hashes[path] = digest(ROOT / path)
    wrappers = {path: digest(ROOT / path) for path in WRAPPERS}
    dependency_paths = [ROOT / "package-lock.json", ROOT / "node_modules/@dsnp/parquetjs/package.json"]
    dependency_paths += sorted((ROOT / "node_modules/@dsnp/parquetjs/dist").rglob("*.js"))
    dependencies = {str(path.relative_to(ROOT)): digest(path) for path in dependency_paths}
    before = native_hashes()
    command = [args.cargo, "test", "--no-run", "--locked", "--offline", "--manifest-path", "native/trading-runtime/Cargo.toml", "--test", "telonex_replay", "--message-format=json", "--target-dir", str(args.target_dir.resolve())]
    if args.release: command.append("--release")
    build = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=True)
    artifacts = [json.loads(line) for line in build.stdout.splitlines() if line.startswith("{")]
    binaries = [item["executable"] for item in artifacts if item.get("reason") == "compiler-artifact" and item.get("target", {}).get("name") == "telonex_replay" and item.get("executable")]
    if len(binaries) != 1: raise RuntimeError("Exactly one Cargo-reported executable required")
    if before != native_hashes(): raise RuntimeError("Native sources changed during build")
    binary = Path(binaries[0]); fingerprint = digest(binary)
    with tempfile.TemporaryDirectory(prefix="native-telonex-replay-") as directory:
        folder = Path(directory); frozen = folder / "driver"; shutil.copy2(binary, frozen)
        if digest(frozen) != fingerprint or digest(binary) != fingerprint: raise RuntimeError("Binary snapshot changed")
        def oracle(trace):
            trace.write_text("")
            subprocess.run([args.node, "--require", str(ROOT / WRAPPERS[3]), "--import", "tsx",
                str(ROOT / WRAPPERS[1]), str(folder)], cwd=ROOT, check=True, capture_output=True, text=True,
                env={**os.environ, "PMB_DISPATCH_DEPENDENCY_TRACE": str(trace)})
            return {Path(json.loads(line)) for line in trace.read_text().splitlines()}
        loaded = oracle(folder / "discovery.jsonl")
        dependency_set = provenance.dependency_files(loaded)
        imported_hashes = {str(path):digest(path) for path in dependency_set}
        actual_loaded = oracle(folder / "authoritative.jsonl")
        if loaded != actual_loaded: raise RuntimeError("Actual oracle import set changed after discovery")
        provenance.dependency_guard(dependency_set, imported_hashes, provenance.dependency_files(actual_loaded))
        for path in loaded:
            if path.is_relative_to(ROOT / "src") and path.suffix in [".ts", ".js", ".mts"]:
                relative = str(path.relative_to(ROOT))
                if path.read_bytes() != subprocess.check_output(["git", "show", f"{REFERENCE}:{relative}"], cwd=ROOT):
                    raise RuntimeError(f"Unpinned imported production body: {relative}")
                reference_hashes[relative] = digest(path)
        payload = (folder / "telonex-cases.json").read_text(); cases = json.loads(payload)
        subprocess.run([str(frozen)], cwd=ROOT, check=True, capture_output=True, text=True)
        expected = json.loads((folder / "telonex-reference.json").read_text())
        files = {path.name: digest(path) for path in sorted(folder.glob("*.parquet"))}
        subprocess.run([str(frozen), "actual_telonex_replay_fixture_driver", "--ignored", "--exact"],
            cwd=ROOT, check=True, capture_output=True, text=True,
            env={**os.environ, "PMB_TELONEX_CASES": str(folder / "telonex-cases.json"), "PMB_TELONEX_OUTPUT": str(folder / "telonex-native.json")})
        actual = json.loads((folder / "telonex-native.json").read_text())
        if payload != (folder / "telonex-cases.json").read_text(): raise RuntimeError("Fixture manifest changed")
        if files != {path.name: digest(path) for path in sorted(folder.glob("*.parquet"))}: raise RuntimeError("Input bytes changed")
        if digest(frozen) != fingerprint: raise RuntimeError("Frozen binary changed")
        compare(expected, actual, cases)
    if before != native_hashes(): raise RuntimeError("Native sources changed during comparison")
    provenance.dependency_guard(dependency_set, imported_hashes, provenance.dependency_files(loaded))
    if tools_before != provenance.tooling(args.node,args.cargo): raise RuntimeError("Tool identity changed during comparison")
    for path, value in {**reference_hashes, **wrappers, **dependencies}.items():
        if digest(ROOT / path) != value: raise RuntimeError(f"Source/wrapper changed: {path}")
    report = dict(referenceCommit=REFERENCE, node=node_version, tooling=tools_before,
        importedOracleDependencySha256=imported_hashes, importedOracleDependencyCount=len(dependency_set),
        importedDependencySetAndBytesGuarded=True, dependencyMutationChecks=dependency_mutations,
        nativeInputsSha256=before,
        wrapperSha256=wrappers, oracleSourceSha256=reference_hashes, nativeBinarySha256=fingerprint,
        buildCommand=command, buildProfile="release" if args.release else "debug",
        dependencyInputsSha256=dependencies,
        fixtureInputSha256=hashlib.sha256(payload.encode()).hexdigest(), parquetFilesSha256=files,
        cases=len(cases), nativeRegressionTests=3, admittedTicks=sum(len(value["ticks"]) for value in expected),
        comparatorMutationChecks=mutation_checks(), fullFixtureOutputParity=True,
        productionReady=False, completeReplayModeAcceptance=False,
        scope="Actual pinned Telonex paired/delta replay production bodies using real GZIP Parquet rows: atomic paired application, typed event coercion, physical cursor order, wide ingest sequences, receipt clocks, skipped rows, awaited callbacks, stop and original callback failure. Shared mutable SDK graph ingress, exact Promise jobs, complete physical row conversion, remote R2/EPERM, feeds/strategy/OM/execution/live/fleet remain required")
    if args.report: args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))

if __name__ == "__main__": main()
