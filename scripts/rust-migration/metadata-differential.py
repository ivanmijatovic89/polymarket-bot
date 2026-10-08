"""Independent JS metadata semantics and actual pinned Observer operation traces.

This does not port/certify Observer arithmetic, arbitrary JS descriptors/toJSON,
record aliases, the whole SDK, or strategy/execution integration.
"""
import argparse
import copy
import hashlib
import json
import random
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = "07245602d6ff9bca0dcdf772134cba3dd227526c"
EXTERNAL_REFERENCE = "155fa585bea79ad77c1002a167e62f1060261aeb"
OBSERVER = "protocols/pair-game-astra/strategies/observer.ts"
OBSERVER_SHA = "9dc0a9806229f96c309ad53e3cf6105e86fcbf6859fb6de7757d94f6f7fee682"
SOURCES = ["src/trading/OrderManager.ts", "src/trading/Portfolio.ts", "src/backtest/runSingleMarket.ts", "src/backtest/stats/marketStats.ts"]

def sha(data):
    return hashlib.sha256(data).hexdigest()

def number(x):
    return dict(kind="number", bits=struct.pack(">d", x).hex())

def units(x):
    b=x.encode("utf-16-le", "surrogatepass")
    return [int.from_bytes(b[i:i+2], "little") for i in range(0,len(b),2)]

def ref(id_):
    return dict(kind="ref",id=id_)

def snapshot(id_):
    return dict(op="snapshot",value=ref(id_))

def fixtures():
    rng=random.Random(741028)
    rows=[]
    bits=[number(x) for x in [0.0,-0.0,float("nan"),float("inf"),-float("inf"),5e-324,-5e-324,1e308,-1e308,2**53,0.5]]
    bits += [dict(kind="number",bits=f"{rng.getrandbits(64):016x}") for _ in range(80)]
    keys=[units(x) for x in ["a","b","2","10","01","4294967294","4294967295","__proto__","constructor","a/b","a~b","😀","\ud800",""]]
    values=bits+[dict(kind="null"),dict(kind="missing"),dict(kind="bool",value=True),dict(kind="bool",value=False)]+[dict(kind="string",units=units(x)) for x in ["","😀","\ud800","a\ud800b","\udc00\ud800","\b\n\t"]]
    for case in range(300):
        actions=[dict(op="new",id=f"o{i}",array=False) for i in range(5)]+[dict(op="new",id=f"a{i}",array=True) for i in range(2)]
        ids=[f"o{i}" for i in range(5)]+[f"a{i}" for i in range(2)]
        for _ in range(100):
            id_=rng.choice(ids);value=rng.choice(values+[ref(rng.choice(ids))]);key=rng.choice(keys)
            if id_.startswith("o"):
                if rng.randrange(5)==0: actions.append(dict(op="delete",id=id_,key=key))
                else: actions.append(dict(op="set",id=id_,key=key,value=value))
                actions.append(dict(op="probe",id=id_,key=key,same=rng.choice(ids)))
                if rng.randrange(6)==0: actions.append(dict(op="keys",id=id_))
            else:
                kind=rng.randrange(4)
                if kind==0: actions.append(dict(op="length",id=id_,length=rng.randrange(8)))
                elif kind==1: actions.append(dict(op="deleteIndex",id=id_,index=rng.randrange(8)))
                else: actions.append(dict(op="index",id=id_,index=rng.randrange(8),value=value))
                actions.append(dict(op="probe",id=id_,index=rng.randrange(8),same=rng.choice(ids)))
            if rng.randrange(3)==0: actions.append(snapshot(id_))
            if rng.randrange(10)==0: actions.append(dict(op="collect"))
        actions.extend(snapshot(id_) for id_ in ids)
        rows.append(dict(name=f"random-{case}",actions=actions))
    rows.append(dict(name="retained-child-after-ledger-prune",actions=[dict(op="new",id="ledger"),dict(op="new",id="meta"),dict(op="set",id="ledger",key=units("order"),value=ref("meta")),dict(op="getAlias",id="retained",**{"from":"ledger"},key=units("order")),dict(op="drop",id="meta"),dict(op="delete",id="ledger",key=units("order")),dict(op="collect"),dict(op="set",id="retained",key=units("late"),value=number(-0.0)),dict(op="probe",id="retained",key=units("late")),snapshot("retained")]))
    rows.append(dict(name="tree-negative-zero-nested-binary64",actions=[dict(op="new",id="o"),dict(op="set",id="o",key=units("x"),value=dict(kind="tree",value=-0.0)),dict(op="probe",id="o",key=units("x")),dict(op="set",id="o",key=units("nested"),value=dict(kind="tree",value={"n":-0.0,"array":[-0.0,9007199254740993,18446744073709551615,10**100]})),dict(op="getAlias",id="nested",**{"from":"o"},key=units("nested")),dict(op="probe",id="nested",key=units("n")),dict(op="getAlias",id="array",**{"from":"nested"},key=units("array")),*[dict(op="probe",id="array",index=i) for i in range(4)],snapshot("o")]))
    for value in values:
        rows.append(dict(name=f"primitive-{len(rows)}",actions=[dict(op="snapshot",value=value),dict(op="new",id="o"),dict(op="set",id="o",key=units("value"),value=value),dict(op="probe",id="o",key=units("value")),snapshot("o")]))
    # Records use the same plain-data JS objects as the reference, while native
    # slots are accessed by schema-bound fields and arbitrary metadata edges.
    record_keys=[units(k) for k in ["id","qty","meta","2","label","x","10","01","\ud800","__proto__"]]
    record_values=values+[dict(kind="bigint",value=str(x)) for x in [0,-1,1,9007199254740993,10**100,-10**100]]
    for case in range(120):
        actions=[dict(op="new",id="meta"),dict(op="new",id="record",record=True,properties=[[units("label"),dict(kind="string",units=units("first"))],[units("10"),number(10)],[units("qty"),number(-0.0)],[units("2"),number(2)]])]
        for _ in range(80):
            field=rng.randrange(5);value=rng.choice(record_values+[ref("meta"),ref("record")]);key=rng.choice(record_keys)
            kind=rng.randrange(5)
            if kind==0:actions.append(dict(op="fieldDelete",id="record",field=field))
            elif kind==1:actions.append(dict(op="fieldSet",id="record",field=field,value=value))
            elif kind==2:actions.append(dict(op="delete",id="record",key=key))
            elif kind==3:actions.append(dict(op="set",id="meta",key=key,value=value))
            else:actions.append(dict(op="set",id="record",key=key,value=value))
            actions.extend([dict(op="fieldProbe",id="record",field=field,same=rng.choice(["record","meta"])),dict(op="fieldHas",id="record",field=field)])
            if rng.randrange(4)==0:actions.extend([dict(op="keys",id="record"),snapshot("record")])
            if rng.randrange(8)==0:actions.append(dict(op="collect"))
        rows.append(dict(name=f"record-direct-slot-{case}",actions=actions))
    rows.append(dict(name="record-alias-retained-across-ledger-prune",actions=[dict(op="new",id="meta"),dict(op="new",id="record",record=True,properties=[[units("meta"),ref("meta")],[units("qty"),number(1)]]),dict(op="new",id="ledger"),dict(op="set",id="ledger",key=units("order"),value=ref("record")),dict(op="getAlias",id="retained",**{"from":"ledger"},key=units("order")),dict(op="drop",id="record"),dict(op="delete",id="ledger",key=units("order")),dict(op="collect"),dict(op="set",id="meta",key=units("late"),value=number(-0.0)),dict(op="fieldSet",id="retained",field=1,value=number(2)),dict(op="fieldProbe",id="retained",field=1),snapshot("retained")]))
    for x in [0,-1,1,9007199254740993,10**100,-10**100]:
        v=dict(kind="bigint",value=str(x));rows.append(dict(name=f"bigint-{x}",actions=[dict(op="snapshot",value=v),dict(op="new",id="o"),dict(op="set",id="o",key=units("x"),value=v),dict(op="probe",id="o",key=units("x")),snapshot("o"),dict(op="new",id="a",array=True),dict(op="push",id="a",value=v),snapshot("a")]))
    return rows

def compare(expected,actual,count):
    if not isinstance(expected,list) or not isinstance(actual,list) or len(expected)!=count or len(actual)!=count:
        raise AssertionError("Both response counts must equal the source fixture count")
    for index,(left,right) in enumerate(zip(expected,actual)):
        # Stringified JSON and bit/type tags are exact. Python bool/number
        # equality is never used as the comparison oracle.
        if json.dumps(left,sort_keys=True,ensure_ascii=True)!=json.dumps(right,sort_keys=True,ensure_ascii=True):
            
            for item,(a,b) in enumerate(zip(left["output"],right["output"])):
                if json.dumps(a,sort_keys=True)!=json.dumps(b,sort_keys=True):raise AssertionError(f"case {index} output {item}: TS={str(a)[:1000]} Rust={str(b)[:1000]}")
            raise AssertionError(f"case {index}: output count/name mismatch")

def mutation_checks():
    expected=[dict(name="sentinel",output=[dict(kind="snapshot",json='{"x":1}'),dict(kind="probe",value=dict(kind="number",bits="8000000000000000"),truthy=False),dict(kind="keys",units=[[50],[49,48]])])]
    mutants=[[],expected+expected]
    changes=[(0,"json",'{"x":2}'),(0,"json",None),(1,"truthy",0),(1,"value",dict(kind="number",bits="0000000000000000")),(1,"value",dict(kind="null")),(2,"units",[[49,48],[50]])]
    for index,key,value in changes:
        x=copy.deepcopy(expected);x[0]["output"][index][key]=value;mutants.append(x)
    x=copy.deepcopy(expected);x[0]["output"].pop();mutants.append(x)
    compare(expected,expected,1)
    for mutant in mutants:
        try:compare(expected,mutant,1)
        except AssertionError:pass
        else:raise AssertionError("Metadata comparator accepted a mutation")
    # Record presence and arbitrary-width BigInt must remain type-sensitive.
    extra=[dict(name="record-sentinel",output=[dict(kind="has",value=True),dict(kind="probe",value=dict(kind="bigint",value="9007199254740993"),truthy=True)])]
    for index,key,value in [(0,"value",1),(0,"value",False),(1,"value",dict(kind="number",bits="4340000000000000")),(1,"value",dict(kind="bigint",value="9007199254740992")),(1,"value",dict(kind="string",units=units("9007199254740993")))]:
        mutant=copy.deepcopy(extra);mutant[0]["output"][index][key]=value
        try:compare(extra,mutant,1)
        except AssertionError:pass
        else:raise AssertionError("Record/BigInt comparator accepted a mutation")
    return len(mutants)+5

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--node",default="node")
    parser.add_argument("--cargo",default=str(Path.home()/".cargo/bin/cargo"))
    parser.add_argument("--external-root",help="Optional read-only audit of the pinned external Git source against the reviewed vendored fixture")
    parser.add_argument("--report")
    parser.add_argument("--release",action="store_true")
    args=parser.parse_args()
    version=subprocess.check_output([args.node,"--version"],text=True).strip()
    if not version.startswith("v20."):raise RuntimeError("Pinned production metadata oracle requires Node20")
    hashes={}
    for file in SOURCES:
        pinned=subprocess.check_output(["git","show",f"{REFERENCE}:{file}"],cwd=ROOT)
        hashes[file]=sha(pinned)
        if sha((ROOT/file).read_bytes())!=hashes[file]:raise RuntimeError(f"Reference source differs: {file}")
    fixture_relative="scripts/rust-migration/fixtures/pair-game-astra-observer.ts.txt"
    observer=(ROOT/fixture_relative).read_bytes()
    if sha(observer)!=OBSERVER_SHA:raise RuntimeError("Vendored reviewed Observer hash differs")
    if args.external_root is not None:
        external=subprocess.check_output(["git","show",f"{EXTERNAL_REFERENCE}:{OBSERVER}"],cwd=args.external_root)
        if external!=observer:raise RuntimeError("External pinned source differs from reviewed vendored Observer")
    native_files=sorted((ROOT/"native/trading-runtime").glob("src/**/*.rs"))+sorted((ROOT/"native/trading-runtime").glob("tests/**/*.rs"))+sorted((ROOT/"native/trading-runtime").glob("examples/**/*.rs"))
    native_files += [ROOT/"native/trading-runtime/Cargo.toml",ROOT/"native/trading-runtime/Cargo.lock"]
    native_hashes={str(p.relative_to(ROOT)):sha(p.read_bytes()) for p in native_files}
    wrappers={fixture_relative:OBSERVER_SHA,str(Path(__file__).resolve().relative_to(ROOT)):sha(Path(__file__).read_bytes()),"scripts/rust-migration/metadata-oracle.mts":sha((ROOT/"scripts/rust-migration/metadata-oracle.mts").read_bytes())}
    command=[args.cargo,"build","--locked","--offline","--manifest-path","native/trading-runtime/Cargo.toml","--example","metadata_fixtures","--message-format=json"]
    if args.release:command.append("--release")
    build=subprocess.run(command,cwd=ROOT,text=True,capture_output=True,check=True)
    events=[json.loads(line) for line in build.stdout.splitlines() if line.startswith("{")]
    binaries=[x["executable"] for x in events if x.get("reason")=="compiler-artifact" and x.get("target",{}).get("name")=="metadata_fixtures" and x.get("executable")]
    if len(binaries)!=1:raise RuntimeError("Build did not identify exactly one driver executable")
    native=Path(binaries[0]);binary_sha=sha(native.read_bytes())
    with tempfile.TemporaryDirectory(prefix="metadata-parity-") as directory:
        directory=Path(directory);frozen=directory/"metadata_fixtures";shutil.copy2(native,frozen)
        if sha(frozen.read_bytes())!=binary_sha or sha(native.read_bytes())!=binary_sha:raise RuntimeError("Native binary changed while freezing")
        observer_path=directory/"observer.ts";observer_path.write_bytes(observer)
        observer_row=json.loads(subprocess.check_output([args.node,"--import","tsx",str(ROOT/"scripts/rust-migration/metadata-oracle.mts"),"--observer-fixture",str(observer_path)],cwd=ROOT,text=True))
        rows=fixtures()+[observer_row];payload=json.dumps(rows,separators=(",",":"),ensure_ascii=True);fixture_path=directory/"fixtures.json";fixture_path.write_text(payload)
        expected=json.loads(subprocess.check_output([args.node,"--import","tsx",str(ROOT/"scripts/rust-migration/metadata-oracle.mts"),str(fixture_path)],cwd=ROOT,text=True))
        actual=json.loads(subprocess.check_output([str(frozen)],input=payload,cwd=ROOT,text=True))
        if sha(frozen.read_bytes())!=binary_sha:raise RuntimeError("Frozen native executable changed")
        if sha(observer_path.read_bytes())!=OBSERVER_SHA:raise RuntimeError("Reviewed Observer bytes changed")
    for file,hash_ in {**hashes,**native_hashes,**wrappers}.items():
        if sha((ROOT/file).read_bytes())!=hash_:raise RuntimeError(f"Source/wrapper changed during evidence run: {file}")
    final_files=sorted((ROOT/"native/trading-runtime").glob("src/**/*.rs"))+sorted((ROOT/"native/trading-runtime").glob("tests/**/*.rs"))+sorted((ROOT/"native/trading-runtime").glob("examples/**/*.rs"))
    if {str(p.relative_to(ROOT)) for p in final_files}!=set(native_hashes)-{"native/trading-runtime/Cargo.toml","native/trading-runtime/Cargo.lock"}:raise RuntimeError("Native source set changed during evidence run")
    compare(expected,actual,len(rows));mutations=mutation_checks()
    report=dict(referenceRevision=REFERENCE,externalReferenceRevision=EXTERNAL_REFERENCE,reviewedObserverSha256=OBSERVER_SHA,oracleSourceSha256=hashes,nativeInputsSha256=native_hashes,wrapperSha256=wrappers,nativeBinarySha256=binary_sha,fixtureSha256=sha(payload.encode()),buildProfile="release" if args.release else "debug",nodeVersion=version,observerFixturePath=fixture_relative,observerFixtureOrigin="Exact reviewed bytes from external Git reference; hash checked before/after",externalGitAuditPerformed=args.external_root is not None,cargoVersion=subprocess.check_output([args.cargo,"--version"],text=True).strip(),rustcVersion=subprocess.check_output([str(Path(args.cargo).parent/"rustc"),"--version","--verbose"],text=True).strip(),cases=len(rows),actions=sum(len(row["actions"]) for row in rows),comparatorMutationChecks=mutations,dataPropertyGraphParity=True,actualPinnedObserverMetadataOperationTraceParity=True,observerArithmeticPortParity=False,wholeSdkParity=False,recordAliasParity=False,genericRecordStorageParity=True,primitiveBigIntParity=True,collectionEvidence="Native unit tests separately cover roots, generations, cycles, partial budgets and barriers",pending=["Native strategy/Portfolio/intent/trade/stat integration", "Other mutable record/snapshot aliases", "Arbitrary property descriptors/prototypes/toJSON unsupported by this data-property metadata API", "External artifact completeness and full batch/fleet benchmark"])
    if args.report:Path(args.report).write_text(json.dumps(report,indent=2)+"\n")
    print(f"PASS {len(rows)} metadata cases / {report['actions']} actions / {mutations} comparator mutations; whole SDK parity pending")

if __name__=="__main__":main()
