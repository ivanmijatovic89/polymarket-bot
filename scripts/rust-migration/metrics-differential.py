"""Bit-exact strategy context metrics comparison against the pinned TS helpers."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import shutil
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = "07245602d6ff9bca0dcdf772134cba3dd227526c"
SOURCES = ["src/trading/positionMetrics.ts", "src/trading/orderbookMetrics.ts"]

def bits(value):
    return struct.pack(">d", value).hex()

def fixtures():
    rng = random.Random(791132)
    edges=[0.0,-0.0,5e-324,-5e-324,float("nan"),float("inf"),-float("inf"),1e308,-1e308,0.5,-0.5,2**53]
    values=edges+[struct.unpack(">d",rng.getrandbits(64).to_bytes(8,"big"))[0] for _ in range(300)]
    rows=[]
    for i in range(3000):
        def book():
            return dict(depth=bits(rng.choice(edges+[rng.uniform(-3,10)])),bids=[bits(rng.choice(values)) for _ in range(rng.randrange(9))],asks=[bits(rng.choice(values)) for _ in range(rng.randrange(9))])
        positions={key:dict(qty=bits(rng.choice(values)),costBasis=bits(rng.choice(values))) for key in ["up","down","2","10"] if rng.randrange(3)}
        rows.append(dict(upId=rng.choice([None,"","up","down","2","10"]),downId=rng.choice([None,"","up","down","2","10"]),positions=positions,upBook=book(),downBook=book()))
    for up in edges:
        for down in edges:
            rows.append(dict(upId="up",downId="down",positions={"up":dict(qty=bits(up),costBasis=bits(down)),"down":dict(qty=bits(down),costBasis=bits(up))},upBook=dict(depth=bits(2.0),bids=[bits(up),bits(down)],asks=[bits(down),bits(up)]),downBook=dict(depth=bits(2.0),bids=[bits(down),bits(up)],asks=[bits(up),bits(down)])))
    rows.append(dict(upId=None,downId=None,positions={},upBook=dict(depth=bits(4.0),bids=[bits(x) for x in [-0.0,1.0,-1.0,5e-324]],asks=[bits(x) for x in [1.0,-0.0,1.0,1e308]]),downBook=dict(depth=bits(4.0),bids=[bits(x) for x in [1.0,-0.0,1.0,1e308]],asks=[bits(x) for x in [-0.0,1.0,-1.0,5e-324]])))
    return rows

def compare_outputs(expected, actual, count):
    if not isinstance(expected,list) or not isinstance(actual,list) or len(expected)!=count or len(actual)!=count:
        raise AssertionError("Both output counts must equal the input fixture count")
    for index,(left,right) in enumerate(zip(expected,actual)):
        if json.dumps(left,sort_keys=True)!=json.dumps(right,sort_keys=True):
            raise AssertionError(f"case{index} TS={left} Rust={right}")

def comparator_mutation_checks():
    reference=[dict(number=dict(kind="number",bits="8000000000000000"), side="UP",optional=None,depthLevels=2)]
    mutations=[[], reference+reference]
    for key,value in [("number",dict(kind="number",bits="0000000000000000")),("side","DOWN"),("optional",False),("depthLevels",3),("depthLevels",True)]:
        changed=json.loads(json.dumps(reference));changed[0][key]=value;mutations.append(changed)
    changed=json.loads(json.dumps(reference));del changed[0]["optional"];mutations.append(changed)
    compare_outputs(reference,reference,1)
    for changed in mutations:
        try: compare_outputs(reference,changed,1)
        except AssertionError: pass
        else: raise AssertionError("Comparator failed to reject output mutation")
    return len(mutations)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--node",required=True)
    parser.add_argument("--cargo", default=str(Path.home()/".cargo/bin/cargo"))
    parser.add_argument("--release",action="store_true")
    parser.add_argument("--report",type=Path)
    args=parser.parse_args()
    version=subprocess.check_output([args.node,"--version"],text=True).strip()
    if not version.startswith("v20."):raise RuntimeError("Node 20 required")
    hashes={}
    for file in SOURCES:
        original=subprocess.check_output(["git","show",f"{REFERENCE}:{file}"],cwd=ROOT)
        current=(ROOT/file).read_bytes()
        if original!=current:raise RuntimeError(f"Unpinned oracle source: {file}")
        hashes[file]=hashlib.sha256(current).hexdigest()
    wrappers=[Path(__file__).resolve(), ROOT/"scripts/rust-migration/metrics-oracle.mts"]
    wrappers_before={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in wrappers}
    native_files = ["Cargo.toml", "Cargo.lock", "examples/metrics_fixtures.rs"] + sorted(str(file.relative_to(ROOT/"native/trading-runtime")) for file in (ROOT/"native/trading-runtime/src").rglob("*.rs"))
    native_before = {"native/trading-runtime/"+file: hashlib.sha256((ROOT/"native/trading-runtime"/file).read_bytes()).hexdigest() for file in native_files}
    build_command = [args.cargo, "build", "--locked", "--offline", "--manifest-path", "native/trading-runtime/Cargo.toml", "--example", "metrics_fixtures", "--message-format=json"]
    if args.release: build_command.append("--release")
    build = subprocess.run(build_command, cwd=ROOT, text=True, capture_output=True, check=True)
    artifacts = [json.loads(line) for line in build.stdout.splitlines() if line.startswith("{")]
    binaries = [item["executable"] for item in artifacts if item.get("reason")=="compiler-artifact" and item.get("target",{}).get("name")=="metrics_fixtures" and item.get("executable")]
    if len(binaries)!=1: raise RuntimeError("Build must identify exactly one metrics driver executable")
    native = Path(binaries[0]).resolve()
    toolchain = {"cargo": subprocess.check_output([args.cargo,"--version"],text=True).strip(), "rustc": subprocess.check_output([str(Path(args.cargo).parent/"rustc"),"--version","--verbose"],text=True).strip()}
    for file, hash_ in native_before.items():
        if hashlib.sha256((ROOT/file).read_bytes()).hexdigest()!=hash_: raise RuntimeError("Native source changed during build")
    rows=fixtures()
    payload=json.dumps(rows,separators=(",",":"))
    with tempfile.TemporaryDirectory(prefix="native-metrics-parity-") as directory:
        fingerprint=hashlib.sha256(native.read_bytes()).hexdigest()
        frozen=Path(directory)/"metrics_fixtures"
        shutil.copy2(native,frozen)
        if hashlib.sha256(frozen.read_bytes()).hexdigest()!=fingerprint or hashlib.sha256(native.read_bytes()).hexdigest()!=fingerprint:raise RuntimeError("Binary changed during snapshot")
        source=Path(directory)/"fixtures.json";source.write_text(payload)
        expected=json.loads(subprocess.check_output([args.node,"--import","tsx",str(ROOT/"scripts/rust-migration/metrics-oracle.mts"),str(source)],cwd=ROOT,text=True))
        actual=json.loads(subprocess.check_output([str(frozen)],input=payload,text=True,cwd=ROOT))
        if hashlib.sha256(frozen.read_bytes()).hexdigest()!=fingerprint:raise RuntimeError("Frozen executable changed")
    for file,hash_ in hashes.items():
        if hashlib.sha256((ROOT/file).read_bytes()).hexdigest()!=hash_:raise RuntimeError("Oracle changed during comparison")
    for file,hash_ in wrappers_before.items():
        if hashlib.sha256((ROOT/file).read_bytes()).hexdigest()!=hash_:raise RuntimeError("Wrapper changed during comparison")
    for file, hash_ in native_before.items():
        if hashlib.sha256((ROOT/file).read_bytes()).hexdigest()!=hash_: raise RuntimeError("Native source changed during comparison")
    mutation_checks=comparator_mutation_checks()
    compare_outputs(expected,actual,len(rows))
    report=dict(referenceCommit=REFERENCE,node=version,cases=len(rows),comparatorMutationChecks=mutation_checks,exactFiniteIeeeBits=True,signedZeroCompared=True,nonfiniteClassesCompared=True,sourceSha256=hashes,nativeSourceSha256=native_before,buildCommand=build_command,toolchain=toolchain,profile="release" if args.release else "debug",wrapperSha256=wrappers_before,nativeDriverSha256=fingerprint,fixturesSha256=hashlib.sha256(payload.encode()).hexdigest(),fullOutputParity=True)
    if args.report:args.report.write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2))

if __name__=="__main__":main()
