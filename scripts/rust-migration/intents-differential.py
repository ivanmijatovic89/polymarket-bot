"""Pinned full-output intent, risk and cancellation parity (bounded typed domain)."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import random
import shutil
import subprocess
import tempfile
ROOT=Path(__file__).resolve().parents[2]
REFERENCE='07245602d6ff9bca0dcdf772134cba3dd227526c'
SOURCES=['src/trading/riskLimits.ts','src/trading/cancellation.ts','src/strategy/Strategy.ts','src/trading/Portfolio.ts','src/trading/capital.ts','src/trading/fees.ts','src/trading/utils/rounding.ts']


def fixtures():
    cases=[]
    def add(name,operation='risk',**input):
        if operation == 'cancel_batch': input['intent'] = {'kind':'cancel_batch',**input['intent']}
        cases.append({'name':name,'input':{'operation':operation,**input}})
    def place(cid='a',size=10,**extra): return {'kind':'place_limit','clientOrderId':cid,'assetId':'up','side':'BUY','price':.5,'size':size,'orderType':'GTC',**extra}
    def batch(orders,**extra): return {'kind':'place_batch','orders':[{k:v for k,v in o.items() if k!='kind'} for o in orders],**extra}
    def sub(cid='a',oid='x',size=10,asset='up',side='BUY',**extra):
        return {'kind':'order_submitted','tsMs':100,'order':{'clientOrderId':cid,'orderId':oid,'assetId':asset,'side':side,'price':.5,'size':size,'remaining':size,'filled':0,'state':'requested','createdAtMs':100,'updatedAtMs':100,**extra}}
    market='0x'+'ab'*32
    limits={'maxOpenOrders':2,'maxOrderSize':20,'maxAbsPosition':25,'maxLossStop':500}
    intents=[place(),batch([place('b'),place('c')]),{'kind':'cancel_order','clientOrderId':'a'}, {'kind':'cancel_batch','orders':[{'clientOrderId':'a'}]}, {'kind':'cancel_market','market':market}, {'kind':'cancel_all'}, {'kind':'merge_positions','assetIdA':'up','assetIdB':'down','size':3}, {'kind':'split_positions','assetIdA':'up','assetIdB':'down','size':3,'costPerShare':.5}]
    add('all-eight-kinds',intents=intents)
    add('no-portfolio-all-eight',intents=intents,withoutPortfolio=True)
    add('sequential-mixed-capacity',intents=intents,limits=limits)
    add('cancel-keeps-capacity',events=[sub()],intents=[{'kind':'cancel_all'},place('new')],limits={**limits,'maxOpenOrders':1})
    for realized in [-500,-500.00001,-499.99,0,50]:
        add(f'loss-stop-{realized}',realizedPnlTotal=realized,intents=[place('buy'),place('sell',side='SELL'),batch([place('bb'),place('ss',side='SELL')]),{'kind':'cancel_all'}])
    for size in [None,0,-1,'10',False,21,.00000001,20,25]:
        add(f'size-{size!r}',intents=[place('a',size=size),batch([place('b',size=size),place('c')]),place('d')],limits=limits)
    missing=place();del missing['size']
    add('absent-size',intents=[missing,place('b')],limits=limits)
    add('partial-batch-has-no-blocked-per-order',intents=[batch([place('a',size=21),place('b'),place('c'),place('d')],reason='keep',opaqueBatch={'1':'first','0':'zero'}),place('e')],limits=limits)
    add('sell-exposure-keeps-side-independent',events=[sub('a','x',10,side='SELL')],intents=[place('sell',side='SELL'),place('buy')],limits=limits)
    add('position-quantity-affects-projection',events=[{'kind':'positions_split','split':{'id':'s','tsMs':0,'assetIdA':'up','assetIdB':'down','size':20,'splitCost':20}}],intents=[place('buy'),place('sell',side='SELL'),batch([place('b'),place('s',side='SELL')])],limits=limits)
    for value in [9007199254740993,18446744073709551615,-0.0]:
        add(f'opaque-number-{value}',intents=[place(meta={'2':value,'1':{'a/b':value,'a~b':value}},opaqueOrder={'2':value,'0':value})])
    for scope in [{},{'market':None},{'market':''},{'market':market},{'market':market.upper()},{'assetId':'101'},{'assetId':101},{'assetId':None},{'market':market,'assetId':'101'},{'market':market+'\n'},{'assetId':'101\n'}]:
        add(f'scope-{json.dumps(scope)}','scope',scope=scope,orders=[{'market':market,'assetId':'101'},{'market':market.upper(),'assetId':'101'},{'assetId':'101'},{'market':market,'assetId':'102'},{}])
    seed=[sub(),sub('b','y'),sub('pending',None),sub('10','dup'),sub('2','dup')]
    refs=[{},None,False,{'orderId':' '},{'clientOrderId':'unknown'},{'clientOrderId':'a','orderId':'wrong'},{'clientOrderId':'b','orderId':'x'},{'clientOrderId':'a'},{'orderId':'x'},{'orderId':'external'},{'clientOrderId':'pending'},{'orderId':'dup'}]
    for dry in [False,True]: add(f'cancel-mixed-dry-{dry}','cancel_batch',events=seed,intent={'orders':refs},dryRun=dry)
    for dry in [False,True]: add(f'cancel-empty-known-exchange-dry-{dry}','cancel_batch',events=[sub('a','')],intent={'orders':[{'clientOrderId':'a','orderId':'external'}]},dryRun=dry)
    for orders in [None,False,{},'x',[],[{'orderId':f'id-{i}'} for i in range(3000)],[{'orderId':f'id-{i}'} for i in range(3001)]]:
        add(f'cancel-size-{type(orders).__name__}-{len(orders) if isinstance(orders,(list,dict,str)) else orders}','cancel_batch',intent={'orders':orders})
    add('cancel-absent-orders','cancel_batch',intent={})
    add('cancel-array-references-are-not-positional-structs','cancel_batch',intent={'orders':[[],['a'],['a','x'],[None,'x'],['a','x',{}],{'orderId':'external'}]})
    for reason in ['filled','canceled','expired','killed']:
        add('cancel-terminal-'+reason,'cancel_batch',events=[sub(),{'kind':'order_done','tsMs':200,'clientOrderId':'a','orderId':'x','reason':reason,'filledSize':0}],intent={'orders':[{'clientOrderId':'a'},{'orderId':'x'}]})
    add('cancel-rejected-terminal','cancel_batch',events=[sub(),{'kind':'order_rejected','tsMs':200,'clientOrderId':'a','reason':'failure'}],intent={'orders':[{'clientOrderId':'a'},{'orderId':'x'}]})
    for char in ['\u0085','\u00a0','\ufeff','\u2028','\u200b','\n','\t']:
        add('cancel-trim-'+hex(ord(char)),'cancel_batch',intent={'orders':[{'orderId':char+'id'},{'orderId':'id'+char},{'orderId':'in'+char+'side'}]},withoutPortfolio=True)
    randomizer=random.Random(722194)
    for index in range(150):
        orders=[place(f'o-{i}',size=randomizer.choice([0,-1,1,4,10,21,30]),side=randomizer.choice(['BUY','SELL']),assetId=randomizer.choice(['up','down'])) for i in range(randomizer.randrange(1,12))]
        chosen=[batch(orders)] if index%2 else orders
        add(f'seeded-risk-{index}',events=[sub('seed','x',randomizer.choice([0,3,10]),side=randomizer.choice(['BUY','SELL']))],intents=chosen,limits=limits,realizedPnlTotal=randomizer.choice([0,-500,-10]))
    return cases

def assert_equal(expected,actual,path='$'):
    if isinstance(expected,dict):
        if not isinstance(actual,dict) or expected.keys()!=actual.keys():
            raise AssertionError(f'{path}: object field presence differs: expected={list(expected)} actual={list(actual) if isinstance(actual,dict) else actual}')
        for key in expected: assert_equal(expected[key],actual[key],f'{path}.{key}')
    elif isinstance(expected,list):
        if not isinstance(actual,list) or len(expected)!=len(actual): raise AssertionError(f'{path}: array length differs')
        for i,(a,b) in enumerate(zip(expected,actual)): assert_equal(a,b,f'{path}[{i}]')
    elif isinstance(expected,bool)!=isinstance(actual,bool):
        raise AssertionError(f'{path}: boolean/number differs')
    elif isinstance(expected,(int,float)) and not isinstance(expected,bool) and isinstance(actual,(int,float)):
        # JSON.stringify and Serde choose different shortest decimal spellings
        # for some large JS doubles. Compare binary64, while still rejecting
        # an unnormalized serde integer which carries nonrepresentable bits.
        if isinstance(actual,int) and float(actual)!=actual:
            raise AssertionError(f'{path}: native integer retains precision unavailable to JS Number: {actual}')
        if float(expected)!=float(actual): raise AssertionError(f'{path}: TS={expected!r}, Rust={actual!r}')
    elif expected!=actual:
        raise AssertionError(f'{path}: TS={expected!r}, Rust={actual!r}')


def check_comparator_mutations():
    mutations=[(0,False),(1,True),(False,0),(True,1),({'field':None},{}),
        ({}, {'field':None}), ([1,2],[2,1]),
        ({'mapKeys':{'ordersByClientId':['a','b']}},{'mapKeys':{'ordersByClientId':['b','a']}}),
        (9007199254740992,9007199254740993)]
    for expected,actual in mutations:
        try: assert_equal(expected,actual)
        except AssertionError: continue
        raise AssertionError('Differential comparator accepted a deliberate mutation')
    assert_equal(0,0.0)
    return len(mutations)


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node',default='/Users/mijat/.nvm/versions/node/v20.19.6/bin/node')
    parser.add_argument('--report',type=Path)
    parser.add_argument('--target-dir',type=Path,default=Path(tempfile.gettempdir())/('pmb-rust-integration-proof-'+hashlib.sha256(str(ROOT).encode()).hexdigest()[:12]))
    args=parser.parse_args()
    mutation_count=check_comparator_mutations()
    version=subprocess.check_output([args.node,'--version'],text=True).strip()
    if not version.startswith('v20.'): raise RuntimeError('Pinned production oracle requires Node 20')
    fingerprints={}
    for path in SOURCES:
        pinned=subprocess.check_output(['git','show',f'{REFERENCE}:{path}'],cwd=ROOT)
        if pinned!=(ROOT/path).read_bytes(): raise RuntimeError(f'Oracle source differs from reference commit: {path}')
        fingerprints[path]=digest(ROOT/path)
    wrappers=[Path(__file__).resolve(),ROOT/'scripts/rust-migration/intents-oracle.mts']
    crate=ROOT/'native/trading-runtime'
    native_sources=[p for folder in ['src','tests','examples'] for p in sorted((crate/folder).rglob('*.rs'))]
    native_sources += [crate/'Cargo.toml',crate/'Cargo.lock']
    wrapper_hashes={str(p.relative_to(ROOT)):digest(p) for p in wrappers+native_sources}
    cases=fixtures()
    payload=json.dumps({'cases':cases},separators=(',',':'))
    build=subprocess.run(['cargo','test','--manifest-path','native/trading-runtime/Cargo.toml','--test','intents','--target-dir',str(args.target_dir),'--locked','--offline','--no-run','--message-format=json'],cwd=ROOT,check=True,capture_output=True,text=True)
    binaries=[item['executable'] for line in build.stdout.splitlines() if (item:=json.loads(line)).get('reason')=='compiler-artifact' and item.get('executable') and item['target']['name']=='intents']
    if len(binaries)!=1: raise RuntimeError('Expected one compiled intents test adapter')
    with tempfile.TemporaryDirectory(prefix='rust-intents-parity-') as directory:
        directory=Path(directory); executable=Path(binaries[0]); before=digest(executable)
        frozen=directory/'intents-driver'; shutil.copy2(executable,frozen)
        if digest(frozen)!=before or digest(executable)!=before: raise RuntimeError('Native test executable changed while freezing')
        source=directory/'input.json'; target=directory/'output.json'; source.write_text(payload)
        expected=json.loads(subprocess.check_output([args.node,'--import','tsx',str(ROOT/'scripts/rust-migration/intents-oracle.mts'),str(source)],cwd=ROOT,text=True))
        environment={**os.environ,'PMB_INTENTS_FIXTURE_INPUT':str(source),'PMB_INTENTS_FIXTURE_OUTPUT':str(target)}
        subprocess.run([str(frozen),'differential_fixture_driver','--ignored','--exact'],cwd=ROOT,env=environment,check=True,capture_output=True,text=True)
        actual=json.loads(target.read_text())
        if digest(frozen)!=before: raise RuntimeError('Frozen native test executable changed')
    for path,original in {**fingerprints,**wrapper_hashes}.items():
        if digest(ROOT/path)!=original: raise RuntimeError(f'Source changed during comparison: {path}')
    if len(actual)!=len(cases) or len(expected)!=len(cases): raise AssertionError('Fixture response count differs from source case count')
    for left,right in zip(expected,actual):
        if left['name']!=right['name']: raise AssertionError('Fixture identity/order differs')
        assert_equal(left['result'],right['result'],left['name'])
    report={'referenceCommit':REFERENCE,'oracleSourceSha256':fingerprints,'node':version,
        'nativeTestAdapterSha256':before,'nativeTestAdapterFrozenForExecution':True,
        'ownedSourceSha256':wrapper_hashes,'fixturesSha256':hashlib.sha256(payload.encode()).hexdigest(),
        'cases':len(cases),'fullOutputAndFieldPresenceParity':True,'internalBinary64BitsParity':True,'opaqueKeyOrderParity':True,
        'comparatorMutationChecks':mutation_count,'nativeBuildLockedOffline':True,'privateCargoTarget':str(args.target_dir),
        'scope':'Typed intent required strings/enums, finite Unicode-scalar fixture controls, malformed number/cancel validators; production shared metadata graph and raw UTF16/overflow SDK integration remain pending'}
    if args.report: args.report.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__': main()
