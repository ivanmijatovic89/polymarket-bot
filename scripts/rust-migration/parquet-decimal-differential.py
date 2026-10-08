"""Bounded DECIMAL PLAIN/scalar helper evidence, independent installed codec.

This does not certify actual reader/page integration, other logical conversions,
Buffer SDK aliases, complete replay modes, strategy behavior, or live trading.
"""
import argparse
import copy
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = "07245602d6ff9bca0dcdf772134cba3dd227526c"
CODEC_SHA = "cdcedb1b1e641a2041161fac300129c1c8fcf399449d749735ad7e7b810f22cd"
POWER_CAPTURE_FILES = [ROOT/"scripts/rust-migration/fixtures"/f"decimal-pow10-{target}.json"
                       for target in ["darwin-arm64", "linux-x64"]]


def power_identity(node):
    script = """const bits = value => { const b = Buffer.alloc(8); b.writeDoubleBE(value); return b.toString('hex'); };
const powers = () => Array.from({length:310}, (_,scale) => bits(Math.pow(10,scale)));
const cold = powers(); for(let i=0;i<1000;i++) powers(); const hot = powers();
console.log(JSON.stringify({platform:process.platform,architecture:process.arch,versions:process.versions,cold,hot}));"""
    return json.loads(subprocess.check_output([node,"--eval",script],cwd=ROOT,text=True))


def validate_power_reference(identity, native_target):
    profile = f"{identity['platform']}-{identity['architecture']}"
    if profile not in ["darwin-arm64", "linux-x64"]:
        raise RuntimeError("Unverified development Node20 DECIMAL target profile; deployment coverage remains pending")
    expected = json.loads((ROOT/"scripts/rust-migration/fixtures"/f"decimal-pow10-{profile}.json").read_text())
    if expected["platform"] != identity["platform"] or expected["architecture"] != identity["architecture"]:
        raise RuntimeError("Reference capture target identity differs")
    if not expected["coldEqualsHot"] or len(expected["cold"]) != 310 or expected["cold"] != expected["hot"]:
        raise RuntimeError("Invalid reviewed reference power capture")
    if identity["cold"] != expected["cold"] or identity["hot"] != expected["cold"]:
        raise RuntimeError("Actual Node20 powers differ from the reviewed target capture; new runtime evidence required")
    expected_native = {"darwin-arm64":dict(os="macos",arch="aarch64",powerProfile=profile),
                       "linux-x64":dict(os="linux",arch="x86_64",powerProfile=profile)}[profile]
    if native_target != expected_native:
        raise RuntimeError("Native and Node reference target profiles differ")
    return dict(profile=profile,capturedRuntime=expected["versions"],
                capturedExecutableSha256=expected["nodeExecutableSha256"],
                captureProvenance=expected["captureProvenance"],currentRuntime=identity["versions"],
                all310ColdHotPowerBitsMatch=True)


def power_guard_mutation_checks(identity, native_target):
    validate_power_reference(identity,native_target)
    wrong_bits=copy.deepcopy(identity)
    wrong_bits["cold"][218]=wrong_bits["hot"][218]="0000000000000000"
    wrong_hot=copy.deepcopy(identity);wrong_hot["hot"][218]="0000000000000000"
    short=copy.deepcopy(identity);short["cold"]=short["cold"][:-1];short["hot"]=short["hot"][:-1]
    unknown=copy.deepcopy(identity);unknown["architecture"]="unverified"
    wrong_native=dict(native_target,powerProfile="unverified")
    mutants=[(wrong_bits,native_target),(wrong_hot,native_target),(short,native_target),
             (unknown,native_target),(identity,wrong_native)]
    for current,target in mutants:
        try:
            validate_power_reference(current,target)
        except RuntimeError:
            pass
        else:
            raise AssertionError("DECIMAL power-profile guard accepted deliberate mismatch")
    return len(mutants)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fixtures():
    cases = []

    def add(name, physical, precision, scale, data, count, offset=0, size="length", length=-1):
        cases.append(dict(name=name, physical=physical, precision=precision, scale=scale,
                          bytes=data.hex(), count=count, offset=offset,
                          size=len(data) if size == "length" else size, length=length))

    def integer_data(values, width):
        return b"".join(value.to_bytes(width, "little", signed=True) for value in values)

    for scale in range(19):
        for value in [0, 1, -1, 2**53-1, 2**53, 2**53+1, -(2**53+1), 2**63-1, -(2**63)]:
            add(f"int64-{scale}-{value}", "INT64", 18, scale, integer_data([value], 8), 1)
    for scale in range(10):
        for value in [0, 1, -1, 2**31-1, -(2**31)]:
            add(f"int32-{scale}-{value}", "INT32", 9, scale, integer_data([value], 4), 1)
    for precision in [1, 4, 9, 10, 12, 18]:
        for count in [0, 1, 2, 3, 6, 7]:
            add(f"width-{precision}-{count}", "INT64", precision, 0,
                integer_data([1200, -1200, 12300], 8), count)
    for size in [None, 0, 1, 7, 8, 9, 16, 20]:
        for offset in [0, 1, 8, 9]:
            add(f"guard-{size}-{offset}", "INT64", 12, 2, integer_data([1200], 8), 3, offset, size)
    for physical in ["INT32", "INT64"]:
        for length in [0, 1, 3, 4, 7, 8]:
            add(f"short-{physical}-{length}", physical, 9 if physical == "INT32" else 12, 2,
                bytes(length), 2, size=None)
    for hex_data in ["", "00000000", "02000000aabb", "05000000aabb", "ffffffffaabb", "02000000aabb00000000"]:
        for count in [0, 1, 2, 3]:
            add(f"byte-{hex_data}-{count}", "BYTE_ARRAY", 20, 2, bytes.fromhex(hex_data), count)
    for length in [1, 2, 9]:
        for hex_data in ["", "ab", "aabbcc", "aabbccddeeff"]:
            for count in [0, 1, 2, 3]:
                add(f"fixed-{length}-{hex_data}-{count}", "FIXED_LEN_BYTE_ARRAY",
                    {1:2, 2:4, 9:20}[length], 0, bytes.fromhex(hex_data), count, size=None, length=length)
    for physical in ["INT64", "BYTE_ARRAY", "FIXED_LEN_BYTE_ARRAY"]:
        payload = integer_data([2**63-1], 8) if physical == "INT64" else bytes.fromhex("02000000aabb")
        add(f"offset-{physical}", physical, 18 if physical == "INT64" else 20, 0,
            bytes.fromhex("1234")+payload, 1, 2, None, 9)
    add("real-repro-int64-precision4-scale2", "INT64", 4, 2, integer_data([1200,-1200,12300],8), 3)
    for precision in [4, 12, 18, 20]:
        payload = bytes.fromhex("04000000b00400000400000050fbffff")
        add(f"byte-precision-{precision}", "BYTE_ARRAY", precision, 2, payload, 2)
    # The actual reader dispatches dictionaries/statistics using inferred schema
    # primitive type, not the physical column primitive.
    for physical, precision, payload, length in [
        ("INT32", 9, integer_data([1200,-1200,12300],4), -1),
        ("INT64", 4, integer_data([1200,-1200,12300],8), -1),
        ("INT64", 18, integer_data([1200,-1200,12300],8), -1),
        ("BYTE_ARRAY", 4, bytes.fromhex("04000000b00400000400000050fbffff"), -1),
        ("BYTE_ARRAY", 12, bytes.fromhex("04000000b00400000400000050fbffff"), -1),
        ("BYTE_ARRAY", 20, bytes.fromhex("04000000b00400000400000050fbffff"), -1),
        ("FIXED_LEN_BYTE_ARRAY", 4, bytes.fromhex("b00450fb"), 2),
    ]:
        for count in [1,2,3,4]:
            add(f"dictionary-{physical}-{precision}-{count}", physical, precision, 2, payload, count, length=length)
            cases[-1]["dictionary"] = True
    for data in [b"", b"\x01", bytes.fromhex("b0040000"), integer_data([1200],8)]:
        add(f"dictionary-without-size-byte-precision4-{data.hex()}", "BYTE_ARRAY", 4, 2, data, 1, size=None)
        cases[-1]["dictionary"] = True
    manual = [case for case in cases if case.get("dictionary") and case["length"] < 0]
    for case in manual:
        authored = dict(case);authored["name"] = "manual-schema-undefined-"+case["name"]
        authored["schema_undefined"] = True;cases.append(authored)
    # Actual raw-footer annotations are independent of arrow physical validation.
    # The installed codec selects width by precision and Math.pow by scale.
    for scale in [*range(19,310), 1000000, 2147483647]:
        add(f"raw-scale-{scale}", "INT64", max(20,scale), scale,
            integer_data([-1,0,1,2**63-1],8),4)
        cases[-1]["raw_descriptor"] = True
    for physical in ["INT32", "INT64"]:
        for precision in [20, 309, 2147483647]:
            add(f"raw-physical-precision-{physical}-{precision}", physical, precision, 2,
                integer_data([1200,-1200],8),2)
            cases[-1]["raw_descriptor"] = True
            add(f"raw-dictionary-null-{physical}-{precision}",physical,precision,2,b"",0)
            cases[-1].update(raw_descriptor=True,dictionary=True)
    add("raw-fixed-overprecision", "FIXED_LEN_BYTE_ARRAY", 1000, 1000, b"\xaa\xbb",2,length=1)
    cases[-1]["raw_descriptor"] = True
    return cases


def exact(left, right):
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(exact(left[key], right[key]) for key in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(exact(a, b) for a, b in zip(left, right))
    return left == right


def compare(expected, actual, cases):
    count = len(cases)
    if type(expected) is not list or type(actual) is not list or len(expected) != count or len(actual) != count:
        raise AssertionError("Both response counts must equal the source fixture count")
    for index, (left, right) in enumerate(zip(expected, actual)):
        name = cases[index]["name"]
        if type(name) is not str or type(left) is not dict or type(right) is not dict or type(left.get("name")) is not str or type(right.get("name")) is not str or left["name"] != name or right["name"] != name:
            raise AssertionError(f"DECIMAL output identity differs from source fixture {index}: {name}")
        if not exact(left, right):
            raise AssertionError(f"DECIMAL case {index}: TS={left} native={right}")


def mutation_checks():
    expected = [dict(name="number", offset=8, values=[dict(kind="Number", bits="0000000000000000")]),
                dict(name="buffer", offset=6, values=[dict(kind="Buffer", hex="aabb")]),
                dict(name="error", offset=8, error="RangeError")]
    mutations = [expected[:-1], expected+expected]
    for index, field, value in [(0,"offset",8.0), (0,"offset",True), (2,"error","Error")]:
        value_copy=copy.deepcopy(expected);value_copy[index][field]=value;mutations.append(value_copy)
    for index, field, value in [(0,"bits","8000000000000000"), (0,"kind","Buffer"), (1,"hex","")]:
        value_copy=copy.deepcopy(expected);value_copy[index]["values"][0][field]=value;mutations.append(value_copy)
    cases = [{"name":row["name"]} for row in expected]
    compare(expected, expected, cases)
    for mutation in mutations:
        try:
            compare(expected, mutation, cases)
        except AssertionError:
            pass
        else:
            raise AssertionError("DECIMAL comparator accepted deliberate mutation")
    symmetric = [copy.deepcopy(expected), expected[:-1], expected[::-1], [expected[0],expected[0],expected[2]]]
    symmetric[0][0]["name"] = "renamed"
    for pair in symmetric:
        try:
            compare(pair,pair,cases)
        except AssertionError:
            pass
        else:
            raise AssertionError("DECIMAL comparator trusted matching outputs over source fixture identities")
    return len(mutations)+len(symmetric)


def native_files():
    native = ROOT/"native/trading-runtime"
    return sorted(native.glob("src/**/*.rs"))+sorted(native.glob("tests/**/*.rs"))+sorted(native.glob("examples/**/*.rs"))+[native/"Cargo.toml", native/"Cargo.lock"]


def dependencies():
    paths = [ROOT/"package.json", ROOT/"package-lock.json"]
    for package in ["@dsnp/parquetjs", "int53", "bson", "tsx", "esbuild"]:
        directory = ROOT/"node_modules"/package
        paths += sorted(path for path in directory.rglob("*") if path.is_file() and
                        (path.suffix in [".js", ".mjs", ".cjs", ".json"] or path.parent.name == "bin"))
    directory = ROOT/"node_modules/@esbuild"
    if directory.is_dir():
        paths += sorted(path for path in directory.rglob("*") if path.is_file() and
                        (path.name == "esbuild" or path.name == "package.json"))
    return sorted(set(paths))


def hash_files(paths):
    return {str(path.relative_to(ROOT)):sha(path.read_bytes()) for path in paths}


def tooling(node, cargo):
    rustc = os.environ.get("RUSTC") or str(Path(cargo).with_name("rustc"))
    if not Path(rustc).exists():
        rustc = shutil.which("rustc")
    if rustc is None:
        raise RuntimeError("Cannot bind Rust compiler identity")
    result = {}
    for name, command, args in [("node",node,["--version"]), ("cargo",cargo,["--version","--verbose"]), ("rustc",rustc,["--version","--verbose"])]:
        path = Path(shutil.which(command) or command).resolve()
        result[name] = dict(command=command,path=str(path),binarySha256=sha(path.read_bytes()),
                            version=subprocess.check_output([command,*args],cwd=ROOT,text=True).strip())
    sysroot = Path(subprocess.check_output([rustc,"--print","sysroot"],cwd=ROOT,text=True).strip())
    for name in ["cargo", "rustc"]:
        path = sysroot/"bin"/name
        if path.exists() and Path(result[name]["path"]).name in ["rustup", "rustup-init"]:
            result[name]["selectedExecutable"] = dict(path=str(path),sha256=sha(path.read_bytes()))
    if os.environ.get("ESBUILD_BINARY_PATH"):
        path = Path(os.environ["ESBUILD_BINARY_PATH"]).resolve()
        result["esbuildOverride"] = dict(path=str(path),sha256=sha(path.read_bytes()))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--node", default="node")
    parser.add_argument("--cargo", default=str(Path.home()/".cargo/bin/cargo"))
    parser.add_argument("--report")
    parser.add_argument("--release", action="store_true")
    args = parser.parse_args()
    node_version = subprocess.check_output([args.node,"--version"],text=True).strip()
    if not node_version.startswith("v20."):
        raise RuntimeError("Pinned production DECIMAL oracle requires Node20")
    tooling_before = tooling(args.node,args.cargo)
    cargo_version = tooling_before["cargo"]["version"]
    rustc_version = tooling_before["rustc"]["version"]
    codec = ROOT/"node_modules/@dsnp/parquetjs/dist/lib/codec/plain.js"
    if sha(codec.read_bytes()) != CODEC_SHA:
        raise RuntimeError("Installed reviewed @dsnp/parquetjs 1.8.7 PLAIN codec changed")
    package_version = json.loads((ROOT/"node_modules/@dsnp/parquetjs/package.json").read_text())["version"]
    if package_version != "1.8.7":
        raise RuntimeError("Installed reference package version changed")
    power_before = power_identity(args.node)
    native_before = hash_files(native_files())
    dependency_before = hash_files(dependencies())
    wrappers = hash_files([Path(__file__).resolve(), ROOT/"scripts/rust-migration/parquet-decimal-oracle.mts",*POWER_CAPTURE_FILES])
    command = [args.cargo,"build","--locked","--offline","--manifest-path","native/trading-runtime/Cargo.toml",
               "--example","parquet_decimal_fixtures","--message-format=json"]
    if args.release:
        command.append("--release")
    build = subprocess.run(command,cwd=ROOT,capture_output=True,text=True,check=True)
    events = [json.loads(line) for line in build.stdout.splitlines() if line.startswith("{")]
    binaries = [event["executable"] for event in events if event.get("reason")=="compiler-artifact" and
                event.get("target",{}).get("name")=="parquet_decimal_fixtures" and event.get("executable")]
    if len(binaries)!=1:
        raise RuntimeError("Build did not identify exactly one native driver executable")
    original=Path(binaries[0]);binary_sha=sha(original.read_bytes())
    rows=fixtures();payload=json.dumps(rows,separators=(",",":"))
    with tempfile.TemporaryDirectory(prefix="parquet-decimal-parity-") as directory:
        directory=Path(directory);binary=directory/"parquet_decimal_fixtures";shutil.copy2(original,binary)
        if sha(binary.read_bytes())!=binary_sha or sha(original.read_bytes())!=binary_sha:
            raise RuntimeError("Native binary changed while freezing")
        native_target=json.loads(subprocess.check_output([str(binary),"--reference-target"],cwd=ROOT,text=True))
        power_reference=validate_power_reference(power_before,native_target)
        power_guard_mutations=power_guard_mutation_checks(power_before,native_target)
        fixture=directory/"fixtures.json";fixture.write_text(payload)
        expected=json.loads(subprocess.check_output([args.node,"--import","tsx",str(ROOT/"scripts/rust-migration/parquet-decimal-oracle.mts"),str(fixture)],cwd=ROOT,text=True))
        actual=json.loads(subprocess.check_output([str(binary)],input=payload,cwd=ROOT,text=True))
        if sha(binary.read_bytes())!=binary_sha:
            raise RuntimeError("Frozen executable changed")
    if hash_files(native_files())!=native_before or hash_files(dependencies())!=dependency_before or hash_files([ROOT/file for file in wrappers])!=wrappers:
        raise RuntimeError("Native/reference/dependency/wrapper source set changed during DECIMAL evidence")
    if tooling(args.node,args.cargo) != tooling_before:
        raise RuntimeError("Compiler/runtime binary or version changed during evidence")
    if power_identity(args.node) != power_before:
        raise RuntimeError("Actual Node power identity changed during DECIMAL evidence")
    compare(expected,actual,rows);mutations=mutation_checks()
    report=dict(referenceRevision=REFERENCE,installedReferencePackage="@dsnp/parquetjs@1.8.7",
                installedReferenceCodecSha256=CODEC_SHA,nativeInputsSha256=native_before,
                referenceDependenciesSha256=dependency_before,wrapperSha256=wrappers,
                nativeBinarySha256=binary_sha,fixtureSha256=sha(payload.encode()),
                buildProfile="release" if args.release else "debug",nodeVersion=node_version,
                cargoVersion=cargo_version,rustcVersion=rustc_version,tooling=tooling_before,cases=len(rows),
                comparatorMutationChecks=mutations,plainDecimalHelperParity=True,actualFooterDictionaryContextParity=True,
                manualUndefinedSchemaCases=sum(bool(row.get("schema_undefined")) for row in rows),
                actualFooterDictionaryCases=sum(bool(row.get("dictionary")) and not row.get("schema_undefined") for row in rows),
                statisticsCodecParityClaimed=False,
                rawAnnotationHelperCases=sum(bool(row.get("raw_descriptor")) for row in rows),
                rawScaleMathPowNode20BitsParity=True,numericPowerReference=power_reference,
                developmentTargetProfilesOnly=True,referencePowerGuardMutationChecks=power_guard_mutations,
                actualParquetReaderDecimalParity=False,wholeReplayParity=False,
                pending=["Reader integration with original physical data/dictionary cursor bytes",
                         "Definition/repetition/dictionary index materialization and Buffer shared identity",
                         "Actual DECIMAL Parquet file corpus including exception timing",
                         "Negative raw schema typeLength cursor domain and SDK Buffer mutation/prototype semantics",
                         "Complete deployment/fleet target inventory and reference power profiles beyond reviewed macOS ARM64/Linux x64",
                         "Other logical conversions and complete historical/live runtime"])
    if args.report:
        Path(args.report).write_text(json.dumps(report,indent=2)+"\n")
    print(f"PASS {len(rows)} DECIMAL PLAIN scenarios / {mutations} comparator mutations; reader integration pending")


if __name__ == "__main__":
    main()
