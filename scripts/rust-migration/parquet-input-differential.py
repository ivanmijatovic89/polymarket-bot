"""Real Parquet input admission comparison against pinned TS reader helpers."""
import argparse
import hashlib
import importlib.util
import os
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
NATIVE = ROOT / "native/trading-runtime"
REFERENCE = "07245602d6ff9bca0dcdf772134cba3dd227526c"
SOURCES = ["src/utils/minHeap.ts", "src/utils/toBigInt.ts", "src/parquet/io/eventSchema.ts"]
WRAPPERS = ["scripts/rust-migration/parquet-input-differential.py", "scripts/rust-migration/parquet-input-oracle.mts",
    "scripts/rust-migration/dispatch-differential.py", "scripts/rust-migration/dispatch-dependency-preload.cjs",
    "scripts/rust-migration/dispatch-dependency-loader.mjs", "package.json", "package-lock.json"]
# Shared evidence-only guards; no instrumentation enters trading execution.
_spec = importlib.util.spec_from_file_location("dispatch_provenance", ROOT / WRAPPERS[2])
provenance = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(provenance)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def native_hashes():
    files = [NATIVE / "Cargo.toml", NATIVE / "Cargo.lock", NATIVE / "examples/parquet_input_fixtures.rs"]
    files += sorted((NATIVE / "src").rglob("*.rs"))
    return {str(path.relative_to(ROOT)): digest(path) for path in files}

def compare(expected, actual, cases):
    names = [case["name"] for case in cases]
    for output in [expected, actual]:
        if not isinstance(output, dict) or set(output) != {"results"}:
            raise AssertionError("Unexpected result envelope")
        rows = output["results"]
        if not isinstance(rows, list) or len(rows) != len(cases) or [row.get("name") for row in rows] != names:
            raise AssertionError("Output count/identity does not match fixtures")
    if json.dumps(expected, sort_keys=True) != json.dumps(actual, sort_keys=True):
        for index, (left, right) in enumerate(zip(expected["results"], actual["results"])):
            if json.dumps(left, sort_keys=True) != json.dumps(right, sort_keys=True):
                raise AssertionError(f"case {index}: TS={left} Rust={right}")
        raise AssertionError("Output mismatch")

def mutation_checks():
    sample = {"results": [{"name": "probe", "error": False, "rows": [{"fileIndex": 0, "rowIndex": 0, "ingestSeq": "18446744073709551617", "keyTs": "1", "localTimeMsBits": "3ff0000000000000", "rawJsonUtf16": [91,93], "eventTypeUtf16": [98,111,111,107], "ingestNumberBits": "3fb999999999999a", "ingestBufferHex": "000000ff"}]}]}
    cases = [{"name": "probe"}]
    mutations = []
    for change in ["omit", "duplicate", "identity", "bool", "sequence", "clock", "raw", "row", "field", "number", "buffer"]:
        value = json.loads(json.dumps(sample)); result = value["results"][0]
        if change == "omit": value["results"] = []
        elif change == "duplicate": value["results"] *= 2
        elif change == "identity": result["name"] = "other"
        elif change == "bool": result["error"] = 0
        elif change == "sequence": result["rows"][0]["ingestSeq"] = "18446744073709551616"
        elif change == "clock": result["rows"][0]["localTimeMsBits"] = "0000000000000000"
        elif change == "raw": result["rows"][0]["rawJsonUtf16"] = [123,125]
        elif change == "row": result["rows"] = []
        elif change == "number": result["rows"][0]["ingestNumberBits"] = "3fb999999999999b"
        elif change == "buffer": result["rows"][0]["ingestBufferHex"] = "000000fe"
        else: del result["rows"][0]["eventTypeUtf16"]
        mutations.append(value)
    compare(sample, sample, cases)
    for value in mutations:
        try: compare(sample, value, cases)
        except AssertionError: pass
        else: raise AssertionError("Comparator accepted deliberate mutation")
    return len(mutations)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--node", required=True)
    parser.add_argument("--cargo", default=str(Path.home() / ".cargo/bin/cargo"))
    parser.add_argument("--release", action="store_true")
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
    command = [args.cargo, "build", "--locked", "--offline", "--manifest-path", "native/trading-runtime/Cargo.toml", "--example", "parquet_input_fixtures", "--message-format=json"]
    if args.release: command.append("--release")
    build = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=True)
    artifacts = [json.loads(line) for line in build.stdout.splitlines() if line.startswith("{")]
    binaries = [item["executable"] for item in artifacts if item.get("reason") == "compiler-artifact" and item.get("target", {}).get("name") == "parquet_input_fixtures" and item.get("executable")]
    if len(binaries) != 1: raise RuntimeError("Exactly one Cargo-reported executable required")
    if before != native_hashes(): raise RuntimeError("Native sources changed during build")
    binary = Path(binaries[0]); fingerprint = digest(binary)
    with tempfile.TemporaryDirectory(prefix="native-parquet-admission-") as directory:
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
        payload = (folder / "input.json").read_text(); cases = json.loads(payload)["cases"]
        expected = json.loads((folder / "oracle.json").read_text())
        files = {path.name: digest(path) for path in sorted(folder.glob("*.parquet"))}
        actual = json.loads(subprocess.check_output([str(frozen)], input=payload, text=True, cwd=ROOT))
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
        cases=len(cases), admittedRows=sum(len(value["rows"]) for value in expected["results"]),
        comparatorMutationChecks=mutation_checks(), fullFixtureOutputParity=True,
        scope="Local flat JSON and converted-DECIMAL INT32/INT64/BYTE_ARRAY/FIXED_LEN_BYTE_ARRAY Parquet IO, raw footer annotation provenance, dictionary/plain/page cursor and whole-column materialization, admission keys, direct numeric bits and Buffer bytes, raw strings and failure prefixes; no Buffer SDK alias claim, nested logical conversion, market decode, strategy callback, R2/EPERM adapter, feeds, live or complete replay-mode acceptance")
    if args.report: args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))

if __name__ == "__main__": main()
