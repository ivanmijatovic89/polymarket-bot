"""Independent full-output market parity against pinned production TypeScript.

The native module runs through an isolated integration-test executable, not an
activated production protocol capability. All binaries and sources are frozen
or checked across execution. No private data, exchange calls or services.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import random
import shutil
import subprocess
import tempfile
import sys
sys.setrecursionlimit(50_000)
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
REFERENCE="07245602d6ff9bca0dcdf772134cba3dd227526c"
SOURCES=["src/market/MarketEngine.ts","src/market/marketChannelDecoder.ts","src/market/priceChangeHashes.ts",
    "src/market/orderbook/index.ts","src/market/orderbook/types.ts","src/market/orderbook/utils.ts",
    "src/market/orderbook/MarketOrderBookEngine.ts","src/market/orderbook/OrderBookEngine.ts"]


def book(timestamp=1,asset="up",market="m",**extra):
    return {"event_type":"book","asset_id":asset,"market":market,"timestamp":str(timestamp),"hash":"bookhash",
        "bids":[{"price":"0.4","size":"3"}],"asks":[{"price":"0.6","size":"2"}],**extra}


def change(asset="up",price="0.5",size="4",side="BUY",**extra):
    return {"asset_id":asset,"price":price,"size":size,"side":side,"hash":"","best_bid":"","best_ask":"",**extra}


def delta(timestamp=2,changes=None,**extra):
    return {"event_type":"price_change","market":"m","timestamp":str(timestamp),"price_changes":[change()] if changes is None else changes,**extra}


def raw(message,**extra):
    return {"kind":"raw","rawJson":json.dumps(message,separators=(",",":"),ensure_ascii=False),**extra}


def fixtures():
    cases=[]
    def add(name,operations,**extra):
        cases.append({"name":name,"input":{"operations":operations,**extra}})
    add("empty-and-ignored-frames",[{"kind":"raw","rawJson":"{broken"},raw(None),raw(7),raw([]),raw([None,3,[],{"event_type":"disconnect"},{"event_type":"window_end"},{"event_type":"writer_lag_disconnect"},{"event_type":"new_market"}])])
    add("bootstrap-without-history-reset-and-warm",[raw([book(1),book(2,"down")],bootstrap=True),raw(delta(3)),{"kind":"reset"},raw(book(4,"down")),raw(book(5))],expectedAssetIds=["up","down"])
    add("metadata-before-books-does-not-warm",[raw({"event_type":"tick_size_change","market":"m","asset_id":"up","timestamp":"1","new_tick_size":"0.01"}),raw({"event_type":"last_trade_price","market":"m","asset_id":"down","timestamp":"2","price":"0.9","size":"10","side":"BUY"}),raw(book(3)),raw(book(4,"down"))],expectedAssetIds=["up","down"])
    levels=[{"price":str(i/100),"size":str(i+1)} for i in range(30,-1,-1)]
    for depth in [-5,0,0.5,1,3.5,10,35,1e100]:
        add(f"depth-{depth}",[raw(book(bids=levels,asks=list(reversed(levels))))],depthLevels=depth)
    duplicate=[{"price":"0.4","size":"1"},{"price":"0.40","size":"7"},{"price":"0.5","size":"2"},{"price":"0.4","size":"0"},{"price":"0.6","size":"-1"}]
    add("duplicate-levels-and-nonpositive-sizes",[raw(book(bids=duplicate,asks=list(reversed(duplicate)))),raw(book(2,bids=[],asks=[]))])
    add("delta-grouping-atomic-multi-asset-and-unknown-token",[raw([book(),book(1,"down")]),raw(delta(2,[change("down","0.55","1","SELL"),change("up","0.45","8"),change("down","0.6","0","SELL"),change("other","0.7","3")]))],expectedAssetIds=["up","down"])
    add("delta-before-book-and-full-replacement",[raw(delta(1,[change(),change("down","0.3","2")])),raw(book(2)),raw(book(3,"down"))],expectedAssetIds=["up","down"])
    add("empty-and-one-sided-deltas-still-tick",[raw(book()),raw(delta(2,[])),raw(delta(3,[change("up","0.4","3")])),raw(delta(4,[change("up","0.9","0")]))])
    add("delta-removal-reinsert-and-last-write",[raw(book()),raw(delta(2,[change("up","0.4","0"),change("up","0.4","9"),change("up","0.45","2"),change("up","0.45","7")]))])
    source={"kind":"parquet","filePath":"fixture.parquet","ingestSeq":"900719925474099312345678901234567890","tsLocalMs":55}
    add("raw-wire-filtered-child-indices-and-source-bigint",[raw([None,{"event_type":"disconnect"},book(2),{"event_type":"last_trade_price","market":"m","asset_id":"up","timestamp":"3","price":"0.7","size":"5","side":"SELL"},book(4,"down")],source=source),raw(book(-3),source={**source,"ingestSeq":"-000123","tsLocalMs":20})])
    add("live-with-and-without-receipt-sequence",[raw([book(),book(2,"down")],source={"kind":"live","attempt":2,"frameIndex":99}),raw([book(3),book(4,"down")],source={"kind":"live","attempt":3,"ingestSeq":"+0009007199254740993","tsLocalMs":77,"extra":{"a":"exact"}})])
    compact=delta(2,[change(hash="a"*40),change("down",hash="b"*40)])
    add("closed-shape-hash-normalization-return-is-original",[raw(compact),{"kind":"decoded","messages":[compact]}])
    for name,message in [("uppercase-hash",delta(2,[change(hash="A"*40)])),("short-hash",delta(2,[change(hash="abc")])),("extra-message-field",delta(2,[change(hash="a"*40)],extra=True)),("extra-change-field",delta(2,[change(hash="a"*40,extra=True)])),("all-empty-hashes",delta(2,[change(),change("down")]))]:
        add(name,[raw(message)])
    for value in ["bad","NaN","Infinity","-Infinity","1abc","0x","\u0085"]:
        add(f"invalid-numeric-{value}",[raw(book()),raw(delta(2,[change("up","0.5","8"),change("up",value,"7")])),raw(book(3))])
    for value in [None,True,False,""," \t ","\ufeff0.4\ufeff","0x1","0b1","0o1",["0.4"],[]]:
        add(f"number-coercion-{json.dumps(value)}",[raw(book(bids=[{"price":value,"size":"3"}],asks=[])),raw(delta(2,[change("up",value,None)]))])
    for side in ["SELL","buy","UNKNOWN","",None,0,False]:
        add(f"side-{json.dumps(side)}",[raw(book()),raw(delta(2,[change("up","0.45","8",side)]))])
    for value in [None,"100.9","-100.9",0,True,"",["100.5"],"0x10"]:
        msg=book();msg["timestamp"]=value
        add(f"timestamp-coercion-{json.dumps(value)}",[raw(msg),raw(delta(99,[]))])
    for key,value in [("bids",None),("asks",{}),("bids","x"),("bids",[None]),("bids",[{"size":"2"}]),("timestamp","bad")]:
        add(f"malformed-book-{key}-{json.dumps(value)}",[raw(book()),raw({**book(2),key:value}),raw(book(3,"down"))])
    for value in [None,{},[None],[{"asset_id":"up","price":"0.4"}],"x"]:
        add(f"malformed-changes-{json.dumps(value)}",[raw(book()),raw(delta(2,[],price_changes=value)),raw(book(3,"down"))])
    for key,value in [("asset_id",None),("asset_id",0),("asset_id",False),("market",None),("market",0),("market",False),("market","")]:
        add(f"primitive-identity-{key}-{json.dumps(value)}",[raw(book(1,**{key:value})),raw(book(2)),raw(delta(3))])
    missing=book();missing.pop("asset_id")
    missing_market=book();missing_market.pop("market")
    add("missing-asset-identity",[raw(missing),raw(book(2))])
    add("missing-market-identity",[raw(missing_market),raw(book(2))])
    add("market-mismatch-does-not-advance-timestamp",[raw(book()),raw(book(100,market="other")),raw(book(2,"down"))])
    add("full-state-tick-size-trade-and-out-of-order-time",[raw(book(100)),raw({"event_type":"tick_size_change","market":"m","asset_id":"up","timestamp":"80","new_tick_size":"0.01"}),raw({"event_type":"tick_size_change","market":"m","asset_id":"up","timestamp":"81","new_tick_size":"0.001","side":"BUY"}),raw({"event_type":"last_trade_price","market":"m","asset_id":"up","timestamp":"70","price":"0.8","size":"5","side":"SELL"}),raw(book(60,"down"))])
    add("recent-trade-ring-200",[raw(book())]+[raw({"event_type":"last_trade_price","market":"m","asset_id":"up","timestamp":str(i+2),"price":"0.7","size":str(i),"side":"BUY"}) for i in range(205)])
    add("preserve-unrecognized-message-fields",[raw(book(extra={"exact":"123.000000000000000000001","values":[True,None]},hash="exact-book-hash")),raw(delta(2,[change(hash="unknown",extra={"diagnostic":True})],other="exact"))])
    add("derived-overflow-with-finite-input-levels",[raw(book(bids=[{"price":1e308,"size":1e308},{"price":9e307,"size":1e308}],asks=[{"price":1e308,"size":1e308}]))])
    add("signed-zero-key-best-and-level-view",[{"kind":"raw","rawJson":'{"event_type":"book","market":"m","asset_id":"up","timestamp":-0,"bids":[{"price":-0,"size":1}],"asks":[{"price":0,"size":1}],"extra":-0}'}])
    for shape in ["array","object"]:
        raw_json=json.dumps(book(),separators=(",",":"))[:-1]+',"extra":'+ ('['*8192 if shape=="array" else '{"child":'*8192)+'1'
        add("deep-malformed-"+shape,[{"kind":"raw","rawJson":raw_json},raw(book(2))])
    for depth in [127,128,129,512,1024,4096,8192]:
        message=json.dumps(book(),separators=(",",":"))[:-1]+',"extra":'+'['*depth+'1'+']'*depth+'}'
        add(f"deep-array-metadata-{depth}",[{"kind":"raw","rawJson":message}])
        message=json.dumps(book(),separators=(",",":"))[:-1]+',"extra":'+('{"child":'*depth)+'1'+('}'*depth)+'}'
        add(f"deep-object-metadata-{depth}",[{"kind":"raw","rawJson":message}])
    for value in [{"toString":0},{"toString":None},[{"toString":0}],{"valueOf":0},{"valueOf":0,"toString":0}]:
        for field in ["price","size","timestamp"]:
            message=book()
            if field=="timestamp":message[field]=value
            else:message["bids"]=[{"price":"0.4","size":"1",field:value}]
            add("shadowed-primitive-"+field+json.dumps(value),[raw(message)])
    for value in [{},[],[1],{"x":1},{"toString":0}]:
        for field in ["market","asset_id"]:
            add("composite-identity-"+field+json.dumps(value),[raw(book(1,**{field:value})),raw(book(2,**{field:value}))])
    for value in [{"a":1,"b":0.0,"c":1e-6,"d":1e21},[1,2],{"2":2,"1":1,"01":3}]:
        add("json-stringify-numeric-diagnostic-"+json.dumps(value),[raw(book(bids=[{"price":value,"size":"1"}],asks=[]))])
    for field in ["price","size"]:
        message=json.dumps(book(),separators=(",",":"))
        message=message.replace('"'+field+'":"'+("0.4" if field=="price" else "3")+'"','"'+field+'":"'+r"a\ud800b\ud83d\ude00c\udfff"+'"')
        add("mixed-surrogate-invalid-"+field,[{"kind":"raw","rawJson":message}])
    for integer in [0x20000000000001f,0x200000000000010,0x200000000000030,2**53-1,2**53,2**53+1,2**53+3,2**1024-2**970,2**1024-2**969,2**1100+1]:
        for prefix,literal in [("hex",hex(integer)),("binary",bin(integer)),("octal",oct(integer))]:
            add(f"radix-single-round-{prefix}-{integer}",[raw(book(literal)),raw(book(2,bids=[{"price":literal,"size":"1"}],asks=[]))])
    add("integer-index-keys-have-js-enumeration-order",[raw(book(1,"2",extra={"2":"two","1":"one","4294967295":"not-index","0":"zero","01":"leading-zero"})),raw(book(2,"1")),raw(book(3,"0")),raw(book(4,"4294967294")),raw(book(5,"01"))])
    for value in [None,False,True,7,"text",[],{}, {"event_type":7},{"event_type":None}]:
        add("invalid-decoded-message-"+json.dumps(value),[{"kind":"decoded","messages":[book(),value,book(2,"down")]}])
    add("source-metadata-uses-js-number-domain",[raw(book(),source={"kind":"live","attempt":9007199254740993,"tsLocalMs":9007199254740993123,"extra":{"number":9007199254740993,"$serde_json::private::Number":"ordinary"}})])
    # Literal strings intentionally bypass Python's binary64 JSON formatting.
    for name,literal in [("rounded-integer","9007199254740993"),("wide-integer","9007199254740993123"),("positive-overflow","1e400"),("negative-overflow","-1e400"),("negative-underflow","-1e-9999")]:
        template=json.dumps(book(),separators=(",",":"))
        for field in ["timestamp","asset_id","hash"]:
            message=template.replace('"'+field+'":"'+str(book()[field])+'"','"'+field+'":'+literal)
            add(f"raw-number-{name}-{field}",[{"kind":"raw","rawJson":message}])
        for field in ["price","size"]:
            message=template.replace('"'+field+'":"'+("0.4" if field=="price" else "3")+'"','"'+field+'":'+literal)
            add(f"raw-number-{name}-{field}",[{"kind":"raw","rawJson":message}])
        message=template[:-1]+',"extra":{"value":'+literal+',"values":['+literal+']}}'
        add(f"raw-number-{name}-nested-metadata",[{"kind":"raw","rawJson":message}])
    for spelling in ["$serde_json::private::Number",r"\u0024serde_json::private::Number"]:
        template=json.dumps(book(),separators=(",",":"))
        message='{"'+spelling+'":"1e400",'+template[1:-1]+',"extra":{"'+spelling+'":"1e400","ordinary":1}}'
        add("reserved-key-"+spelling,[{"kind":"raw","rawJson":message}])
    for literal in ["01","1e","+1","1.","-.1","0x1","1e+","--1",".1","NaN","Infinity"]:
        message=json.dumps(book(),separators=(",",":"))[:-1]+',"extra":'+literal+'}'
        add("invalid-json-number-"+literal,[{"kind":"raw","rawJson":message},raw(book(2))])
    add("raw-duplicate-object-keys",[{"kind":"raw","rawJson":'{"event_type":"invalid","event_type":"book","market":"m","asset_id":"up","timestamp":1,"bids":[],"asks":[],"extra":{"same":1,"same":2}}'}])
    add("retained-frame-ticks-after-updates-reset-and-bootstrap",[raw([book(1),book(2,"down")],source=source),raw(delta(3,[change("up","0.5","9")])),{"kind":"reset"},raw([book(4,"down"),book(5)],bootstrap=True),raw(delta(6,[change("down","0.7","2","SELL")]))],retainTicks=True)
    add("retained-metadata-noops-and-global-only-time",[raw(book()),raw(delta(1,[change("up","0.4","3")])),raw({"event_type":"tick_size_change","market":"m","asset_id":"up","timestamp":"2","new_tick_size":"0.01"}),raw(delta(3,[])),raw({"event_type":"last_trade_price","market":"m","asset_id":"up","timestamp":"4","price":"0.8","size":"7"})],retainTicks=True)
    add("retained-partial-delta-and-full-book-failures",[raw(book()),raw(delta(2,[change("up","0.5","6"),change("up","bad","2")])),raw(book("bad",bids=[{"price":"0.9","size":"7"}])),raw(book(3,"down")),{"kind":"reset"}],retainTicks=True)
    add("retained-prior-ticks-and-partial-multiasset-frame-error",[raw([book(),book(2,"down"),delta(3,[change("down","0.7","8","SELL"),change("up","bad","1")]),book(4)])],retainTicks=True)
    zero='{"event_type":"book","market":"m","asset_id":"up","timestamp":-0,"bids":[{"price":-0,"size":1}],"asks":[{"price":0,"size":1}]}'
    add("retained-internal-zero-and-overflow-bits",[{"kind":"raw","rawJson":zero},raw(book(2,bids=[{"price":1e308,"size":1e308},{"price":9e307,"size":1e308}],asks=[{"price":1e308,"size":1}])),raw(book(3,bids=[{"price":-1e308,"size":1}],asks=[{"price":1e308,"size":1}])),{"kind":"reset"}],retainTicks=True)
    add("retained-property-key-collisions-and-js-order",[raw(book(1,asset_id=2)),raw(book(2,asset_id={"tag":1})),raw(book(3,"2")),raw(book(4,"1")),raw(book(5,"01")),raw(book(6,"[object Object]")),{"kind":"reset"}],retainTicks=True)
    utf16='{"event_type":"book","market":"m\\ud800","asset_id":"a\\udfff","timestamp":-0,"bids":[{"price":-0,"size":1}],"asks":[]}'
    add("retained-utf16-keys-and-identity-metadata",[{"kind":"raw","rawJson":utf16},{"kind":"raw","rawJson":utf16.replace('"timestamp":-0','"timestamp":2')},{"kind":"reset"}],retainTicks=True)
    rng=random.Random(614002)
    for case in range(40):
        operations=[]
        for index in range(35):
            timestamp=rng.choice([index,index+100,-index])
            asset=rng.choice(["up","down","other"])
            if index%7==0:
                bids=[{"price":str(rng.randrange(10,50)/100),"size":str(rng.randrange(-1,10))} for _ in range(8)]
                asks=[{"price":str(rng.randrange(50,90)/100),"size":str(rng.randrange(-1,10))} for _ in range(8)]
                operations.append(raw(book(timestamp,asset,bids=bids,asks=asks)))
            else:
                changes=[change(rng.choice([asset,"up","down"]),str(rng.randrange(20,80)/100),str(rng.randrange(-2,10)),rng.choice(["BUY","SELL","unknown"])) for _ in range(rng.randrange(0,6))]
                operations.append(raw(delta(timestamp,changes)))
        add(f"seeded-books-and-deltas-{case}",operations,expectedAssetIds=["up","down"],depthLevels=rng.choice([1,2,10,20]))
    return cases


def known_gap_fixtures():
    # JSON.parse accepts UTF-16 code units that cannot be represented by Rust
    # String or serde Value. Keep these acceptance failures visible until the
    # native message and inspection representations are lossless.
    cases=[]
    for name,escaped in [("lone-high-surrogate",r"\ud800"),("lone-low-surrogate",r"\udfff"),("mixed-unpaired-surrogates",r"a\ud800b\udfffc")]:
        message=json.dumps(book(),separators=(",",":"))[:-1]+',"extra":"'+escaped+'"}'
        cases.append({"name":name,"input":{"operations":[{"kind":"raw","rawJson":message}]}})
    base=json.dumps(book(),separators=(",",":"))
    for field in ["asset_id","market","hash","timestamp"]:
        message=base.replace('"'+field+'":"'+str(book()[field])+'"','"'+field+'":"'+r"\ud800"+'"')
        operations=[{"kind":"raw","rawJson":message}]
        if field in ["asset_id","market"]:operations+=[{"kind":"raw","rawJson":message},raw(book(2))]
        cases.append({"name":"surrogate-"+field,"input":{"operations":operations}})
    message=base[:-1]+',"extra":{"'+r"\ud800"+'":"'+r"\udfff"+'","normal":"ok"}}'
    cases.append({"name":"surrogate-object-key","input":{"operations":[{"kind":"raw","rawJson":message}]}})
    return cases


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def require_complete_results(expected,actual,count):
    if not isinstance(expected,list) or not isinstance(actual,list) or len(expected)!=count or len(actual)!=count:
        raise AssertionError("Market oracle/native result count differs from complete acceptance corpus")


def assert_length_mutations_rejected():
    for expected,actual,count in [([1,2],[1],2),([1],[1,2],1),([1],[1],2),([1,2],[1,2],1)]:
        try:require_complete_results(expected,actual,count)
        except AssertionError:continue
        raise AssertionError("Market acceptance comparator allowed omitted/extra results")
    require_complete_results([1],[1],1)
    return 4


def main():
    parser=argparse.ArgumentParser();parser.add_argument("--node",required=True);parser.add_argument("--report",type=Path);args=parser.parse_args()
    version=subprocess.check_output([args.node,"--version"],text=True).strip()
    if not version.startswith("v20."):raise RuntimeError("Pinned market oracle requires Node20")
    oracle_hashes={}
    for path in SOURCES:
        pinned=subprocess.check_output(["git","show",f"{REFERENCE}:{path}"],cwd=ROOT)
        if (ROOT/path).read_bytes()!=pinned:raise RuntimeError(f"Changed pinned oracle source: {path}")
        oracle_hashes[path]=digest(ROOT/path)
    native=ROOT/"native/trading-runtime"
    paths=["scripts/rust-migration/market-oracle.mts","scripts/rust-migration/market-differential.py","scripts/rust-migration/stats-differential.py","native/trading-runtime/tests/market.rs","native/trading-runtime/Cargo.toml","native/trading-runtime/Cargo.lock"]
    paths+=sorted(str(path.relative_to(ROOT)) for path in (native/"src").rglob("*.rs"))
    fingerprints={path:digest(ROOT/path) for path in paths}
    spec=importlib.util.spec_from_file_location("stats_compare",ROOT/"scripts/rust-migration/stats-differential.py")
    compare=importlib.util.module_from_spec(spec);spec.loader.exec_module(compare)
    mutations=compare.assert_comparator_rejects_boolean_numbers()
    length_mutations=assert_length_mutations_rejected()
    cases=fixtures();gaps=known_gap_fixtures();payload=json.dumps({"cases":cases+gaps},separators=(",",":"),ensure_ascii=False)
    build=subprocess.run(["cargo","test","--offline","--locked","--manifest-path","native/trading-runtime/Cargo.toml","--test","market","--no-run","--message-format","json"],cwd=ROOT,capture_output=True,text=True)
    if build.returncode:raise RuntimeError(build.stderr+build.stdout)
    artifacts=[json.loads(line) for line in build.stdout.splitlines() if line.startswith("{")]
    binary=next(Path(item["executable"]) for item in artifacts if item.get("reason")=="compiler-artifact" and item.get("target",{}).get("name")=="market" and item.get("executable"))
    with tempfile.TemporaryDirectory(prefix="rust-market-parity-") as directory:
        directory=Path(directory);source=directory/"input.json";source.write_text(payload);output=directory/"native-output.json"
        expected=json.loads(subprocess.check_output([args.node,"--import","tsx",str(ROOT/"scripts/rust-migration/market-oracle.mts"),str(source)],cwd=ROOT,text=True),parse_int=float)
        binary_before=digest(binary);frozen=directory/"native-market-test";shutil.copy2(binary,frozen);frozen_hash=digest(frozen)
        if binary_before!=frozen_hash or digest(binary)!=binary_before:raise RuntimeError("Native market test executable changed during snapshot")
        env={**os.environ,"RUST_MARKET_FIXTURE_INPUT":str(source),"RUST_MARKET_FIXTURE_OUTPUT":str(output)}
        subprocess.run([str(frozen),"--ignored","--exact","differential_driver"],cwd=ROOT,env=env,capture_output=True,text=True,check=True)
        actual=json.loads(output.read_text(),parse_int=float)
        if digest(frozen)!=frozen_hash:raise RuntimeError("Frozen executable changed during execution")
    for path,sha in {**oracle_hashes,**fingerprints}.items():
        if digest(ROOT/path)!=sha:raise RuntimeError(f"Source changed during parity: {path}")
    require_complete_results(expected,actual,len(cases)+len(gaps))
    compare.assert_equal(expected[:len(cases)],actual[:len(cases)],"market")
    unclosed=[]
    for case,left,right in zip(gaps,expected[len(cases):],actual[len(cases):]):
        try:
            compare.assert_equal(left,right,"market."+case["name"])
        except AssertionError as error:
            unclosed.append({"name":case["name"],"difference":str(error),
                "typescriptTicks":sum(len(step["ticks"]) for step in left["result"]["steps"]),
                "nativeTicks":sum(len(step["ticks"]) for step in right["result"]["steps"])})
    report={"referenceCommit":REFERENCE,"oracleSourceSha256":oracle_hashes,"driverAndNativeSourceSha256":fingerprints,
        "nativeTestExecutableSha256":frozen_hash,"nativeBinaryFrozenForExecution":True,"node":version,
        "fixturesSha256":hashlib.sha256(payload.encode()).hexdigest(),"booleanNumberMutationChecks":mutations,"responseLengthMutationChecks":length_mutations,
        "cases":len(cases),"totalCaseCount":len(cases)+len(gaps),"operations":sum(len(case["input"]["operations"]) for case in cases+gaps),
        "testedFixturesFullOutputParity":True,"fullOutputParity":not unclosed,
        "unclosedAcceptanceFixtures":unclosed,"knownGapFixtureCount":len(gaps),
        "numericComparisonDomain":"JavaScript binary64, including integer JSON tokens; booleans remain distinct","retainedSnapshotCaseCount":sum(bool(case["input"].get("retainTicks")) for case in cases+gaps),"scope":"Standalone shared market frame/book and retained typed snapshot semantics; no production activation, Parquet, feeds, strategy, live queue or event scheduler"}
    if args.report:args.report.write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2))
    if unclosed:raise SystemExit("Market acceptance is incomplete: UTF-16 string representation gaps remain")


if __name__=="__main__":main()
