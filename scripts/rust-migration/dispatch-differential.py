#!/usr/bin/env python3
"""Pinned callback-admission comparison; instrumented runner bodies are scoped out."""
import argparse, copy, hashlib, importlib.util, json, os, random, shutil, subprocess, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
REFERENCE='07245602d6ff9bca0dcdf772134cba3dd227526c'

def book(ts,asset='up'):
    return {'event_type':'book','market':'m','asset_id':asset,'timestamp':str(ts),'bids':[{'price':'0.4','size':'3'}],'asks':[]}
def submit(id,messages=None,**extra):
    return {'kind':'submit','id':id,**({'messages':messages} if messages is not None else {}),**extra}
def flush():return {'kind':'flush'}
def fixtures():
    cases=[]
    def add(name,ops,**extra):cases.append({'name':name,'input':{'operations':ops,'callbacks':{},**extra}})
    add('void-live-children-atomic',[submit('a',[book(1),book(2)]),submit('b',[book(3)]),flush()])
    add('ready-deferred-still-yields',[submit('a',[book(1),book(2)]),submit('b',[book(3)]),flush()],callbacks={'1':{'ready':True}})
    add('direct-throw-next-frame-recovers',[submit('a',[book(1),book(2)]),submit('b',[book(3)]),flush()],callbacks={'1':{'throw':True}})
    add('direct-capture-throw-next-frame-recovers',[submit('a',[book(1),book(2)]),submit('b',[book(3)]),flush()],callbacks={'1':{'captureThrow':True}})
    add('deferred-rejection-poisons-existing-chain',[submit('a',[book(1),book(2)]),submit('b',[book(3)]),submit('c',[book(4)]),flush(),{'kind':'resolve','gate':'g','error':'rejected'},flush(),submit('fresh',[book(5)]),flush()],callbacks={'1':{'gate':'g'}})
    add('queued-direct-error-also-poisons',[submit('a',[book(1)]),submit('b',[book(2),book(3)]),submit('c',[book(4)]),{'kind':'resolve','gate':'g'},flush(),submit('fresh',[book(5)]),flush()],callbacks={'1':{'gate':'g'},'2':{'throw':True}})
    add('later-child-error-after-await-poisons',[submit('a',[book(1),book(2),book(3)]),submit('b',[book(4)]),{'kind':'resolve','gate':'g'},flush()],callbacks={'1':{'gate':'g'},'2':{'throw':True}})
    add('queued-invalid-decoded-child-error',[submit('a',[book(1)]),submit('b',[book(2),None,book(3)]),submit('c',[book(4)]),{'kind':'resolve','gate':'g'},flush()],callbacks={'1':{'gate':'g'}})
    bad=book(2);bad['timestamp']='bad'
    add('partial-mutation-invalid-timestamp-after-await',[submit('a',[book(1),bad,book(3)]),submit('b',[book(4)]),{'kind':'resolve','gate':'g'},flush()],callbacks={'1':{'gate':'g'}})
    add('reset-during-pause-preserves-pending-history',[submit('a',[book(1),book(2)]),submit('b',[book(3)]),{'kind':'reset'},{'kind':'resolve','gate':'g'},flush()],callbacks={'1':{'gate':'g'}})
    source={'kind':'parquet','filePath':'fixture','ingestSeq':'900719925474099312345678901234567890','tsLocalMs':77}
    raw=[None,{'event_type':'disconnect'},book(1),{'event_type':'last_trade_price','market':'m','asset_id':'up','timestamp':'2','price':'0.5','size':'1','side':'BUY'},book(3,'down')]
    add('raw-filtered-index-bigint-bootstrap',[submit('bootstrap',rawJson=json.dumps(raw),source=source,bootstrap=True),submit('raw',rawJson=json.dumps(raw),source=source),flush()])
    add('ignored-raw-frame-after-pending',[submit('a',[book(1)]),submit('bad',rawJson='{bad'),{'kind':'resolve','gate':'g'},flush()],callbacks={'1':{'gate':'g'}})
    for awaited in [False,True]:
        add(f'combined-capture-and-provider-time-{awaited}',[submit('a',[book(1),book(2)]),{'kind':'account','id':'account'},submit('b',[book(3)]),{'kind':'provider','value':'later'},flush(),{'kind':'resolve','gate':'g'},flush()],combined=True,awaited=awaited,callbacks={'1':{'gate':'g'}})
        add(f'combined-process-error-chain-{awaited}',[submit('a',[book(1),book(2)]),{'kind':'account','id':'account'},submit('b',[book(3)]),flush(),submit('fresh',[book(4)]),flush()],combined=True,awaited=awaited,callbacks={'1':{'throw':True}})
        add(f'combined-capture-error-{awaited}',[submit('a',[book(1),book(2)]),submit('b',[book(3)]),flush()],combined=True,awaited=awaited,callbacks={'1':{'captureThrow':True}})
        add(f'combined-account-error-recovers-{awaited}',[{'kind':'account','id':'bad'},submit('a',[book(1),book(2)]),flush()],combined=True,awaited=awaited,callbacks={'bad':{'throw':True}})
    for name,hash_value,extra in [('compact','a'*40,{}),('empty','',{}),('noncompact','other',{}),('extra-field','a'*40,{'extra':True})]:
        msg={'event_type':'price_change','market':'m','timestamp':'1','price_changes':[{'asset_id':'up','price':'0.4','size':'2','side':'BUY','hash':hash_value,'best_bid':'','best_ask':''},{'asset_id':'down','price':'0.3','size':'1','side':'BUY','hash':'','best_bid':'','best_ask':''}],**extra}
        add(f'normalization-identity-{name}',[submit('identity',[msg]),flush()],identityProbe=True,expectedIdentitySame=name!='compact')
    msg=copy.deepcopy(msg);msg.pop('extra',None)
    add('normalization-identity-awaited-runner',[submit('identity',[msg]),flush()],identityProbe=True,combined=True,awaited=True,expectedIdentitySame=False)
    def source_create(**extra):return {'kind':'source_create','id':'s',**extra}
    def source_submit(id,messages):return submit(id,messages,sourceId='s')
    for label,bits in [('negative-zero','8000000000000000'),('positive-infinity','7ff0000000000000'),('negative-infinity','fff0000000000000'),('nan','7ff8000000000001')]:
        add('typed-source-'+label,[source_create(source={'kind':'parquet','filePath':'fixture','ingestSeq':'900719925474099312345678901234567890'},localTimeBits=bits,filePathUnits=[102,55296,112]),source_submit('one',[book(1)]),flush()],sourceProbe=True)
    add('typed-source-legacy-shared-reference',[source_create(),source_submit('multi',[book(1),book(2)]),{'kind':'source_mutate','id':'s','localTimeBits':'8000000000000000'},flush()],sourceProbe=True)
    add('typed-source-shallow-child-alias',[source_create(source={'frameIndex':99,'kind':'live','ingestSeq':'9','extra':{'value':1}},localTimeBits='8000000000000000'),source_submit('multi',[book(1),book(2)]),{'kind':'source_mutate','id':'s','nestedValue':7,'localTimeBits':'7ff0000000000000'},flush()],sourceProbe=True)
    add('typed-source-mutation-between-awaited-children',[source_create(source={'kind':'parquet','filePath':'fixture','ingestSeq':'9'}),source_submit('multi',[book(1),book(2)]),{'kind':'source_mutate','id':'s','sequence':'900719925474099312345','localTimeBits':'fff0000000000000'},{'kind':'resolve','gate':'g'},flush()],sourceProbe=True,callbacks={'1':{'gate':'g'}})
    add('typed-source-delete-sequence-while-paused',[source_create(source={'kind':'live','ingestSeq':'9','attempt':1}),source_submit('multi',[book(1),book(2)]),{'kind':'source_mutate','id':'s','removeSequence':True},{'kind':'resolve','gate':'g'},flush()],sourceProbe=True,callbacks={'1':{'gate':'g'}})
    add('typed-source-undefined-own-sequence',[source_create(undefinedSequence=True),source_submit('multi',[book(1),book(2)]),flush()],sourceProbe=True)
    add('typed-source-live-queued-runner-alias',[source_create(),source_submit('multi',[book(1),book(2)]),{'kind':'source_mutate','id':'s','localTimeBits':'7ff0000000000000'},flush()],sourceProbe=True,combined=True)
    add('typed-source-shared-record-two-frames',[source_create(source={'kind':'parquet','filePath':'fixture','ingestSeq':'-900719925474099312345'}),source_submit('one',[book(1)]),source_submit('two',[book(2)]),flush()],sourceProbe=True)
    rng=random.Random(733019)
    for n in range(20):
        operations=[];callbacks={};ts=1
        for f in range(5):
            children=[book(ts+i,'up' if i%2==0 else 'down') for i in range(rng.randrange(1,4))]
            for child in children:
                if rng.random()<.3:callbacks[child['timestamp']]={'ready':True,'reject':rng.random()<.2}
            ts+=len(children);operations.append(submit(str(f),children));
            if rng.random()<.4:operations.append(flush())
        operations.append(flush());add(f'seeded-admission-{n}',operations,callbacks=callbacks)
    return cases

def equal(a,b,path='$'):
    if type(a) is bool or type(b) is bool:
        if type(a) is not type(b) or a!=b:raise AssertionError(f'{path}: bool mismatch')
    elif isinstance(a,dict):
        if not isinstance(b,dict) or a.keys()!=b.keys():raise AssertionError(f'{path}: field mismatch')
        for k in a:equal(a[k],b[k],f'{path}.{k}')
    elif isinstance(a,list):
        if not isinstance(b,list) or len(a)!=len(b):raise AssertionError(f'{path}: length mismatch')
        for i,(x,y) in enumerate(zip(a,b)):equal(x,y,f'{path}[{i}]')
    elif isinstance(a,(float,int)) and isinstance(b,(float,int)):
        if isinstance(b,int) and float(b)!=b:raise AssertionError(f'{path}: unsafe native integer')
        if float(a)!=float(b):raise AssertionError(f'{path}: number {a} != {b}')
    elif a!=b:raise AssertionError(f'{path}: {a!r} != {b!r}')
def compare_cases(expected,actual,cases):
    names=[case['name'] for case in cases]
    for rows in [expected,actual]:
        if not isinstance(rows,list) or len(rows)!=len(cases):raise AssertionError('Response count differs from authoritative fixture count')
        if any(not isinstance(row,dict) or set(row)!={'name','result'} for row in rows):raise AssertionError('Response envelope differs')
        if [row['name'] for row in rows]!=names:raise AssertionError('Response identity/order differs from source cases')
    equal(expected,actual)

def mutation_checks():
    cases=[{'name':'first'},{'name':'second'}]
    baseline=[{'name':'first','result':{'number':0,'flag':True,'ordered':[1,2]}},{'name':'second','result':{}}]
    mutations=[]
    mutations += [(baseline,[]),([],[]),(baseline,baseline+[baseline[0]]),(baseline+[baseline[0]],baseline+[baseline[0]])]
    mutations += [(list(reversed(baseline)),list(reversed(baseline)))]
    wrong=copy.deepcopy(baseline);wrong[0]['name']='wrong';mutations.append((wrong,wrong))
    for expected,actual in [(0,False),(1,True),(False,0),(True,1)]:
        left=copy.deepcopy(baseline);right=copy.deepcopy(baseline);left[0]['result']['number']=expected;right[0]['result']['number']=actual;mutations.append((left,right))
    omitted=copy.deepcopy(baseline);del omitted[0]['result']['flag'];mutations.append((baseline,omitted))
    order=copy.deepcopy(baseline);order[0]['result']['ordered']=[2,1];mutations.append((baseline,order))
    left=copy.deepcopy(baseline);right=copy.deepcopy(baseline);left[0]['result']['number']=9007199254740992;right[0]['result']['number']=9007199254740993;mutations.append((left,right))
    for left,right in mutations:
        try:compare_cases(left,right,cases)
        except AssertionError:continue
        raise AssertionError('Comparator accepted a deliberate response mutation')
    compare_cases(baseline,baseline,cases)
    return len(mutations)

def native_paths(crate):
    return [p for d in ['src','tests','examples'] for p in sorted((crate/d).rglob('*.rs'))]+[crate/'Cargo.toml',crate/'Cargo.lock']

def hash(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def tooling(node,cargo):
    rustc=os.environ.get('RUSTC') or str(Path(cargo).with_name('rustc'))
    if not Path(rustc).exists():rustc='rustc'
    result={}
    for name,command,args in [('node',node,['--version']),('cargo',cargo,['--version','--verbose']),('rustc',rustc,['--version','--verbose'])]:
        path=Path(shutil.which(command) or command).resolve()
        result[name]={'command':command,'path':str(path),'binarySha256':hash(path),'version':subprocess.check_output([command,*args],text=True).strip()}
    sysroot=Path(subprocess.check_output([rustc,'--print','sysroot'],text=True).strip())
    for name in ['cargo','rustc']:
        executable=sysroot/'bin'/name
        if executable.exists() and Path(result[name]['path']).name in ['rustup','rustup-init']:
            result[name]['selectedExecutable']={'path':str(executable),'sha256':hash(executable)}
    return result

def dependency_files(loaded):
    result=set(loaded)
    for path in loaded:
        for parent in path.parents:
            package=parent/'package.json'
            if package.is_file():
                result.add(package)
                if 'node_modules' in parent.parts:
                    # Include package helper/data/native files, not just module
                    # imports. Esbuild executes a platform binary out of process.
                    result.update(p.resolve() for p in parent.rglob('*') if p.is_file())
                break
        for parent in path.parents:
            if parent.name=='node_modules':
                platform=parent/'@esbuild'
                if platform.is_dir():result.update(p.resolve() for p in platform.rglob('*') if p.is_file())
    override=os.environ.get('ESBUILD_BINARY_PATH')
    if override:result.add(Path(override).resolve())
    return result

def dependency_guard(expected_files,hashes,current_files):
    if current_files!=expected_files:raise RuntimeError('Imported oracle dependency file set changed')
    if any(hash(Path(p))!=h for p,h in hashes.items()):raise RuntimeError('Imported oracle dependency bytes changed')

def dependency_mutation_checks():
    with tempfile.TemporaryDirectory(prefix='dispatch-dependency-guards-') as directory:
        package=Path(directory)/'node_modules'/'fixture';package.mkdir(parents=True)
        module=package/'index.js';meta=package/'package.json';helper=package/'native.bin'
        module.write_text('export const value=1;');meta.write_text('{"name":"fixture"}');helper.write_bytes(b'first')
        loaded={module};baseline=dependency_files(loaded);hashes={str(p):hash(p) for p in baseline}
        dependency_guard(baseline,hashes,dependency_files(loaded))
        def rejects():
            try:dependency_guard(baseline,hashes,dependency_files(loaded))
            except RuntimeError:return
            raise AssertionError('Dependency guard accepted a deliberate mutation')
        module.write_text('export const value=2;');rejects();module.write_text('export const value=1;')
        meta.write_text('{"name":"changed"}');rejects();meta.write_text('{"name":"fixture"}')
        helper.write_bytes(b'other');rejects();helper.write_bytes(b'first')
        extra=package/'added.js';extra.write_text('new file');rejects();extra.unlink()
        helper.unlink();rejects();helper.write_bytes(b'first')
        dependency_guard(baseline,hashes,dependency_files(loaded))
    return 5

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--node',default='node');parser.add_argument('--cargo',default=str(Path.home()/'.cargo/bin/cargo'));parser.add_argument('--release',action='store_true');parser.add_argument('--report',type=Path);parser.add_argument('--exploratory',action='store_true');args=parser.parse_args()
    mutations=mutation_checks()
    dependency_mutations=dependency_mutation_checks()
    tools_before=tooling(args.node,args.cargo)
    version=tools_before['node']['version'];assert version.startswith('v20.')
    # Pin all TS source imports, including the constructor dependencies of the
    # instrumented StrategyRunner. New unrelated native files are hash guarded.
    sources=[p for p in sorted((ROOT/'src').rglob('*.ts')) if subprocess.run(['git','cat-file','-e',f'{REFERENCE}:{p.relative_to(ROOT)}'],cwd=ROOT,capture_output=True).returncode==0]
    source_hashes={}
    for p in sources:
        original=subprocess.check_output(['git','show',f'{REFERENCE}:{p.relative_to(ROOT)}'],cwd=ROOT)
        if p.read_bytes()!=original:raise RuntimeError(f'Pinned source drift: {p.relative_to(ROOT)}')
        source_hashes[str(p.relative_to(ROOT))]=hash(p)
    crate=ROOT/'native/trading-runtime'
    wrappers=[Path(__file__).resolve(),ROOT/'scripts/rust-migration/dispatch-oracle.mts',ROOT/'scripts/rust-migration/dispatch-dependency-preload.cjs',ROOT/'scripts/rust-migration/dispatch-dependency-loader.mjs',ROOT/'package.json',ROOT/'package-lock.json']
    owned=native_paths(crate)+wrappers
    hashes={str(p.relative_to(ROOT)):hash(p) for p in owned}
    cases=fixtures();payload=json.dumps({'cases':cases},separators=(',',':'))
    build=subprocess.run([args.cargo,'test','--manifest-path',str(crate/'Cargo.toml'),'--test','dispatch','--locked','--offline','--no-run','--message-format=json',*(['--release'] if args.release else [])],cwd=ROOT,capture_output=True,text=True,check=True)
    binaries=[x['executable'] for l in build.stdout.splitlines() if (x:=json.loads(l)).get('reason')=='compiler-artifact' and x.get('executable') and x['target']['name']=='dispatch'];assert len(binaries)==1
    with tempfile.TemporaryDirectory(prefix='dispatch-parity-') as d:
        d=Path(d);binary=Path(binaries[0]);before=hash(binary);frozen=d/'driver';shutil.copy2(binary,frozen)
        assert hash(frozen)==hash(binary)==before
        source=d/'input.json';target=d/'output.json';source.write_text(payload)
        preload=ROOT/'scripts/rust-migration/dispatch-dependency-preload.cjs'
        def oracle(trace):
            trace.write_text('')
            return json.loads(subprocess.check_output([args.node,'--require',str(preload),'--import','tsx',str(ROOT/'scripts/rust-migration/dispatch-oracle.mts'),str(source)],cwd=ROOT,env={**os.environ,'PMB_DISPATCH_DEPENDENCY_TRACE':str(trace)},text=True))
        discovery=d/'discovery.jsonl';oracle(discovery)
        loaded_dependencies={Path(json.loads(line)) for line in discovery.read_text().splitlines()}-{source}
        dependency_set=dependency_files(loaded_dependencies)
        dependency_hashes={str(p):hash(p) for p in dependency_set}
        trace=d/'authoritative.jsonl';expected=oracle(trace)
        actual_loaded={Path(json.loads(line)) for line in trace.read_text().splitlines()}-{source}
        if actual_loaded!=loaded_dependencies:raise RuntimeError('Imported module set changed between discovery and authoritative execution')
        dependency_guard(dependency_set,dependency_hashes,dependency_files(actual_loaded))
        subprocess.run([str(frozen),'differential_fixture_driver','--ignored','--exact'],cwd=ROOT,env={**os.environ,'PMB_DISPATCH_FIXTURE_INPUT':str(source),'PMB_DISPATCH_FIXTURE_OUTPUT':str(target)},capture_output=True,check=True)
        actual=json.loads(target.read_text());assert hash(frozen)==before
        try:compare_cases(expected,actual,cases)
        except AssertionError:
            Path('/private/tmp/dispatch-mismatch-input.json').write_text(payload);Path('/private/tmp/dispatch-mismatch-ts.json').write_text(json.dumps(expected));Path('/private/tmp/dispatch-mismatch-native.json').write_text(json.dumps(actual));raise
    for source_case,left,right in zip(cases,expected,actual):
        if source_case['input'].get('identityProbe'):
            wanted=source_case['input']['expectedIdentitySame']
            for result in [left['result'],right['result']]:
                captures=[e for e in result['observations'][-1]['events'] if e['kind']=='capture']
                if len(captures)!=1:raise AssertionError('Identity probe did not capture its one message')
                identity=captures[0]['identity']
                if identity!={'messageSame':wanted,'changesSame':wanted,'changeObjectsSame':[wanted,wanted]}:raise AssertionError('Identity fixture did not exercise intended fresh/no-op nodes')
                if result['observations'][-1]['statuses']['frames'][0]['returnSame'] is not True:raise AssertionError('Frame return lost original message identity')
    final_paths=native_paths(crate)+wrappers
    if set(owned)!=set(final_paths):raise RuntimeError('Native source file set changed during comparison')
    drift=[p for p,h in {**source_hashes,**hashes}.items() if hash(ROOT/p)!=h]
    if drift and not args.exploratory:raise RuntimeError(f'Sources moved during comparison: {drift}')
    if tooling(args.node,args.cargo)!=tools_before:raise RuntimeError('Node/Cargo/rustc tooling changed during comparison')
    dependency_guard(dependency_set,dependency_hashes,dependency_files(loaded_dependencies))
    report={'referenceCommit':REFERENCE,'node':version,'buildProfile':'release' if args.release else 'debug','tooling':tools_before,'importedOracleDependencySha256':dependency_hashes,'importedOracleDependencyCount':len(dependency_set),'importedDependencySetAndBytesGuarded':True,'dependencyMutationChecks':dependency_mutations,'cases':len(cases),'operationCount':sum(len(c['input']['operations']) for c in cases),'fullDiagnosticOutputParity':True,'actualPinnedMarketEngineCallbacks':True,'actualPinnedStrategyRunnerPublicAdmission':True,'compactHashNodeIdentityParity':True,'unchangedHashNodeIdentityParity':True,'frameOriginalReturnIdentityParity':True,'identityProbeCases':5,'typedSourceProbeCases':sum(bool(c['input'].get('sourceProbe')) for c in cases),'sourceBigIntClockBitsIdentityParity':True,'sourceInheritedDescriptorsParity':False,'instrumentedRunnerBodies':True,'scope':'Frame/admission/capture/FIFO behavior only; full strategy, execution, plugins, account processing and owning-thread live transport integration remain required. Instrumented runner processing bodies are excluded.','oracleSourceSha256':source_hashes,'compiledSourceSha256':hashes,'sourceDrift':drift,'sourceBound':not drift,'nativeExecutableSha256':before,'nativeExecutableFrozen':True,'fixturesSha256':hashlib.sha256(payload.encode()).hexdigest(),'comparatorMutationChecks':mutations,'responseCountIdentitySourceBound':True,'nativeSourceFileSetGuarded':True}
    if args.report:args.report.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if not k.endswith('Sha256')},indent=2))
if __name__=='__main__':main()
