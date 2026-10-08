"""Pinned actual OrderManager/Portfolio graph parity (bounded own-data domain)."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import random
import re
import shutil
import subprocess
import tempfile
ROOT=Path(__file__).resolve().parents[2]
REFERENCE='07245602d6ff9bca0dcdf772134cba3dd227526c'
SOURCES=['src/trading/OrderManager.ts','src/trading/riskLimits.ts','src/trading/cancellation.ts','src/strategy/Strategy.ts','src/trading/Portfolio.ts','src/trading/capital.ts','src/trading/fees.ts','src/trading/utils/rounding.ts']


def fixtures():
    cases=[]
    def add(name,operations,**input):cases.append({'name':name,'input':{'operations':operations,**input}})
    def place(cid='a',**extra):return {'kind':'place_limit','clientOrderId':cid,'assetId':'up','side':'BUY','price':.5,'size':2,'orderType':'GTC','postOnly':True,'meta':{'marker':'shared'},**extra}
    def batch(orders):return {'kind':'place_batch','orders':[{k:v for k,v in o.items()if k!='kind'}for o in orders],'reason':'batch','opaqueBatch':{'2':'b','1':'a'}}
    def handle(intents,mode='immediate',now=1000):return {'op':'handle','intents':intents,'mode':mode,'nowMs':now}
    seed=[{'kind':'positions_split','split':{'id':'seed','tsMs':0,'assetIdA':'up','assetIdB':'down','size':10,'splitCost':10}}]
    market='0x'+'ab'*32
    operations=[place(),batch([place('b'),place('c',side='SELL')]),{'kind':'cancel_order','clientOrderId':'a'},{'kind':'cancel_batch','orders':[{'clientOrderId':'b'},{'orderId':'external'}]},{'kind':'cancel_market','market':market},{'kind':'cancel_all'},{'kind':'merge_positions','assetIdA':'up','assetIdB':'down','size':2,'reason':'merge'},{'kind':'split_positions','assetIdA':'up','assetIdB':'down','size':2,'costPerShare':.5}]
    for dry in [False,True]:
        execution=[{'events':[{'kind':'order_accepted','tsMs':1000,'clientOrderId':'a','orderId':'x'}]},{'events':[]},{'events':[]},{'events':[]},{'events':[]},{'events':[]},{'events':[{'kind':'positions_merged','id':'m','tsMs':1000,'assetIdA':'up','assetIdB':'down','size':2}]},{'events':[{'kind':'positions_split','split':{'id':'s','tsMs':1000,'assetIdA':'up','assetIdB':'down','size':2,'splitCost':2}}]}]
        if dry:execution=[{'events':[{'kind':'positions_split','split':{'id':'s','tsMs':1000,'assetIdA':'up','assetIdB':'down','size':2,'splitCost':2}}]}]
        add(f'all-eight-dry-{dry}',[handle(operations),{'op':'apply','index':0},{'op':'tick'}],seed=seed,market=market,dryRun=dry,execution=execution)
    add('queued-then-tick-and-market-reset',[handle([place()],mode='queued'),{'op':'tick'},{'op':'apply','index':1},handle([place('b')],mode='queued'),{'op':'begin'},{'op':'tick'}])
    add('no-portfolio-original-intent',[handle([place(),place('b')])],withoutPortfolio=True)
    add('empty-intents',[handle([]),{'op':'tick'}])
    add('active-retry-risk-does-not-finalize',[handle([place()]),handle([place(size=3000)]),{'op':'apply','index':0},handle([place()])])
    add('partial-batch-risk-and-validation',[handle([batch([place('a',size=3000),place('b',price=0),place('c'),place('c'),place('d')])]),{'op':'apply','index':0}])
    add('same-batch-funding-obligations',[handle([batch([place('a',size=800),place('b',size=800)])])])
    add('adapter-throw-retains-submission',[handle([place()]),handle([place()]),{'op':'begin'},handle([place()])],execution=[{'error':'original-adapter-error'}])
    add('immediate-terminal-allows-client-reuse',[handle([place()]),handle([place()])],execution=[{'events':[{'kind':'order_done','tsMs':1000,'clientOrderId':'a','reason':'killed'}]}])
    for field,values in [('price',[None,False,'1',0,-1,.1]),('size',[None,False,'2',0,-1,1]),('assetId',['',None]),('postOnly',[None,False,True])]:
        for index,value in enumerate(values):add(f'validation-{field}-{index}',[handle([place(**{field:value})])])
    for expiry in [None,False,'65000',0,60999,61000,100000]:add(f'gtd-{expiry!r}',[handle([place(orderType='GTD',expireAtMs=expiry)])])
    add('gtd-expiry-missing',[handle([place(orderType='GTD')])])
    add('non-gtd-expiry-log',[handle([place(expireAtMs=90000)])])
    add('postonly-fok',[handle([place(orderType='FOK')])])
    for meta in [None,False,0,1,'yes',{'2':9007199254740993,'1':-0.0}]:add(f'meta-{meta!r}',[handle([place(meta=meta)])])
    for orders in [None,False,{},'x',[],[None,False,{},[],{'orderId':' '},{'clientOrderId':'unknown'},{'orderId':'external'}]]:
        add(f'cancel-refs-{orders!r}',[handle([{'kind':'cancel_batch','orders':orders}])],dryRun=True)
    for scope in [{},{'market':None},{'market':''},{'market':market},{'assetId':'101'},{'assetId':101}]:add(f'cancel-scope-{scope!r}',[handle([{'kind':'cancel_market',**scope}])],dryRun=True)
    for kind in ['split_positions','merge_positions']:
        for size in [None,False,'3',0,-1,2,20]:add(f'{kind}-size-{size!r}',[handle([{'kind':kind,'assetIdA':'up','assetIdB':'down','size':size}])],seed=seed,dryRun=True)
        add(f'{kind}-equal-assets',[handle([{'kind':kind,'assetIdA':'up','assetIdB':'up','size':2}])])
    add('merge-reserves-positions-until-original-reconcile',[handle([{'kind':'merge_positions','assetIdA':'up','assetIdB':'down','size':8},{'kind':'merge_positions','assetIdA':'up','assetIdB':'down','size':8}]),{'op':'reconcile','index':0},handle([{'kind':'merge_positions','assetIdA':'up','assetIdB':'down','size':2}]),{'op':'begin'},handle([{'kind':'merge_positions','assetIdA':'up','assetIdB':'down','size':2}])],seed=seed,dryRun=True)
    for field in ['kind','size','price','postOnly']:
        operation=handle([place()]);operation['getter']={'intentIndex':0,'field':field,'thrown':{'token':'original-'+field}}
        add('actual-getter-throw-'+field,[operation])
    for field,first in [('price',.5),('size',2)]:
        operation=handle([place()]);operation['getter']={'intentIndex':0,'field':field,'returns':[first,0],'thrown':{'token':'late-'+field}}
        add('actual-changing-validator-getter-'+field,[operation],withoutPortfolio=True)
    operation=handle([place(orderType='GTD',expireAtMs=95000)]);operation['getter']={'intentIndex':0,'field':'expireAtMs','returns':[95000,95000,0],'thrown':{'token':'late-expiry'}}
    add('actual-changing-validator-getter-expiry',[operation],withoutPortfolio=True)
    operation=handle([place()]);operation['getter']={'intentIndex':0,'field':'orderType','returns':['GTC'],'thrown':{'token':'late-order-type'}}
    add('actual-short-circuit-order-type-getter',[operation],withoutPortfolio=True)
    rng=random.Random(919433)
    for n in range(80):
        orders=[place(f'order-{i}',size=rng.choice([0,-1,1,4,1000,2001]),price=rng.choice([0,.25,.5]),side=rng.choice(['BUY','SELL']),assetId=rng.choice(['up','down']))for i in range(rng.randrange(1,8))]
        add(f'seeded-manager-{n}',[handle([batch(orders)] if n%2 else orders),{'op':'apply','index':0},{'op':'tick'}],dryRun=True,seed=seed)
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
    cases=[{'name':'guard-a','input':{'operations':[{'op':'handle'}]}},{'name':'guard-b','input':{'operations':[{'op':'tick'}]}}]
    good=[{'name':case['name'],'result':{'operations':[{'op':case['input']['operations'][0]['op'],'samePendingRoot':True,'pendingFrozen':False,'capitalFrozen':True}],'calls':[{'originalIntent':True}]}}for case in cases]
    symmetric=[]
    symmetric.append(good[:-1])
    symmetric.append(good+[copy.deepcopy(good[0])])
    symmetric.append(list(reversed(good)))
    wrong=copy.deepcopy(good);wrong[0]['name']='wrong';symmetric.append(wrong)
    wrong=copy.deepcopy(good);wrong[0]['result']['operations'][0]['samePendingRoot']=1;symmetric.append(wrong)
    wrong=copy.deepcopy(good);wrong[0]['result']['operations'][0]['op']='tick';symmetric.append(wrong)
    wrong=copy.deepcopy(good);wrong[0]['result']['operations']=[];symmetric.append(wrong)
    wrong=copy.deepcopy(good);wrong[0]['result']['calls'][0]['originalIntent']=1;symmetric.append(wrong)
    for output in symmetric:
        try: compare_cases(cases,output,copy.deepcopy(output))
        except AssertionError: continue
        raise AssertionError('Comparator accepted symmetrically malformed fixture responses')
    compare_cases(cases,good,copy.deepcopy(good))
    cases[0]['input']['operations'][0]['getter']={'field':'price'}
    good[0]['result']['operations'][0].update(getterCalls=1,thrownOriginal=True)
    for field,value in [('getterCalls',True),('getterCalls',0),('thrownOriginal',False)]:
        wrong=copy.deepcopy(good);wrong[0]['result']['operations'][0][field]=value
        try:compare_cases(cases,wrong,copy.deepcopy(wrong))
        except AssertionError:continue
        raise AssertionError('Comparator accepted malformed getter count/identity evidence')
    wrong=copy.deepcopy(good);del wrong[0]['result']['operations'][0]['getterCalls']
    try:compare_cases(cases,wrong,copy.deepcopy(wrong))
    except AssertionError:pass
    else:raise AssertionError('Comparator accepted omitted getter count evidence')
    compare_cases(cases,good,copy.deepcopy(good))
    return len(mutations)+len(symmetric)+4


def compare_cases(cases,expected,actual):
    if not isinstance(expected,list) or not isinstance(actual,list) or len(actual)!=len(cases) or len(expected)!=len(cases):raise AssertionError('Fixture response count/type differs from source cases')
    for source,left,right in zip(cases,expected,actual):
        for output in [left,right]:
            if not isinstance(output,dict) or output.keys()!={'name','result'} or output['name']!=source['name']:raise AssertionError('Fixture identity/order/envelope differs from source case')
            result=output['result']
            if not isinstance(result,dict) or not isinstance(result.get('operations'),list) or len(result['operations'])!=len(source['input']['operations']):raise AssertionError('Operation count differs from source fixture')
            for original,operation in zip(source['input']['operations'],result['operations']):
                if not isinstance(operation,dict) or operation.get('op')!=original['op']:raise AssertionError('Operation identity/order differs from source fixture')
                if original.get('getter'):
                    count=operation.get('getterCalls')
                    if not isinstance(count,(int,float)) or isinstance(count,bool) or count<1 or int(count)!=count or not isinstance(operation.get('thrownOriginal'),bool) or (not original['getter'].get('returns') and operation.get('thrownOriginal') is not True):raise AssertionError('Getter fixture must bind read count and original thrown identity')
                for flag in ['samePendingRoot','pendingFrozen','capitalFrozen','thrownOriginal']:
                    if flag in operation and not isinstance(operation[flag],bool):raise AssertionError('Root identity/freeze flag must be boolean')
            if not isinstance(result.get('calls'),list):raise AssertionError('Adapter calls must be an array')
            for call in result['calls']:
                if not isinstance(call,dict) or not isinstance(call.get('originalIntent'),bool):raise AssertionError('Adapter intent identity flag must be boolean')
        assert_equal(left['result'],right['result'],source['name'])

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
    wrappers=[Path(__file__).resolve(),ROOT/'scripts/rust-migration/order-manager-oracle.mts']
    crate=ROOT/'native/trading-runtime'
    native_sources=[p for folder in ['src','tests','examples'] for p in sorted((crate/folder).rglob('*.rs'))]
    native_sources += [crate/'Cargo.toml',crate/'Cargo.lock']
    wrapper_hashes={str(p.relative_to(ROOT)):digest(p) for p in wrappers+native_sources}
    cases=fixtures()
    payload=json.dumps({'cases':cases},separators=(',',':'))
    build=subprocess.run(['cargo','test','--manifest-path','native/trading-runtime/Cargo.toml','--test','order_manager','--target-dir',str(args.target_dir),'--locked','--offline','--no-run','--message-format=json'],cwd=ROOT,check=True,capture_output=True,text=True)
    binaries=[item['executable'] for line in build.stdout.splitlines() if (item:=json.loads(line)).get('reason')=='compiler-artifact' and item.get('executable') and item['target']['name']=='order_manager']
    if len(binaries)!=1: raise RuntimeError('Expected one compiled order manager test adapter')
    with tempfile.TemporaryDirectory(prefix='rust-order-manager-parity-') as directory:
        directory=Path(directory); executable=Path(binaries[0]); before=digest(executable)
        frozen=directory/'order-manager-driver'; shutil.copy2(executable,frozen)
        if digest(frozen)!=before or digest(executable)!=before: raise RuntimeError('Native test executable changed while freezing')
        units=subprocess.check_output([str(frozen),'--skip','differential_fixture_driver'],cwd=ROOT,text=True)
        match=re.search(r'test result: ok\. (\d+) passed; 0 failed',units)
        if not match or int(match.group(1))!=6:raise RuntimeError('Expected six public native OrderManager regressions')
        native_unit_count=int(match.group(1))
        source=directory/'input.json'; target=directory/'output.json'; source.write_text(payload)
        expected=json.loads(subprocess.check_output([args.node,'--import','tsx',str(ROOT/'scripts/rust-migration/order-manager-oracle.mts'),str(source)],cwd=ROOT,text=True))
        environment={**os.environ,'PMB_ORDER_MANAGER_FIXTURE_INPUT':str(source),'PMB_ORDER_MANAGER_FIXTURE_OUTPUT':str(target)}
        subprocess.run([str(frozen),'differential_fixture_driver','--ignored','--exact'],cwd=ROOT,env=environment,check=True,capture_output=True,text=True)
        actual=json.loads(target.read_text())
        if digest(frozen)!=before: raise RuntimeError('Frozen native test executable changed')
    for path,original in {**fingerprints,**wrapper_hashes}.items():
        if digest(ROOT/path)!=original: raise RuntimeError(f'Source changed during comparison: {path}')
    compare_cases(cases,expected,actual)
    final_sources=[p for folder in ['src','tests','examples'] for p in sorted((crate/folder).rglob('*.rs'))]+[crate/'Cargo.toml',crate/'Cargo.lock']
    if set(final_sources)!=set(native_sources): raise RuntimeError('Native source file set changed during comparison')
    report={'referenceCommit':REFERENCE,'oracleSourceSha256':fingerprints,'node':version,
        'nativeTestAdapterSha256':before,'nativeTestAdapterFrozenForExecution':True,
        'ownedSourceSha256':wrapper_hashes,'fixturesSha256':hashlib.sha256(payload.encode()).hexdigest(),
        'cases':len(cases),'fullOutputAndFieldPresenceParity':True,'internalBinary64BitsParity':True,'opaqueKeyOrderParity':True,
        'comparatorMutationChecks':mutation_count,'publicNativeRegressionTests':native_unit_count,'sourceOperationCountAndIdentityBound':True,'callbackThrownObjectIdentityRegression':True,'nativeBuildLockedOffline':True,
        'privateCargoTarget':str(args.target_dir),'graphAuthorityWithoutSerdeHotPath':True,'allEightAdapterOperations':True,'scope':'Actual shared OrderManager/Portfolio graph core in numeric own-data domain plus bounded original-thrown-object and stateful-validator accessor fixtures; original intent/event/meta identity and shallow frozen cache roots; full accessor/prototype/coercion behavior, exact nested Promise-job owner scheduling and production adapters remain required' }
    if args.report: args.report.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__': main()
