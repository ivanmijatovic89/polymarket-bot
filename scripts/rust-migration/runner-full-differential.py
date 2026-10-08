"""Actual shared Runner/OrderManager/Portfolio/PluginSet full-body differential."""
import argparse,copy,hashlib,importlib.util,json,os,shutil,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
NATIVE=ROOT/'native/trading-runtime'
REFERENCE='07245602d6ff9bca0dcdf772134cba3dd227526c'
WRAPPERS=['scripts/rust-migration/runner-full-differential.py','scripts/rust-migration/runner-full-fixtures.py','scripts/rust-migration/runner-full-oracle.mts','scripts/rust-migration/dispatch-differential.py','scripts/rust-migration/dispatch-dependency-preload.cjs','scripts/rust-migration/dispatch-dependency-loader.mjs','package.json','package-lock.json']
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,ROOT/path);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
provenance=module('runner_provenance',WRAPPERS[3])
fixtures=module('runner_fixtures',WRAPPERS[1]).fixtures

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def native_hashes():
 files=[NATIVE/'Cargo.toml',NATIVE/'Cargo.lock']+[p for name in ['src','tests','examples']for p in sorted((NATIVE/name).rglob('*.rs'))]
 return {str(p.relative_to(ROOT)):digest(p)for p in files}
def equal(a,b,path='$'):
 if isinstance(a,dict):
  if not isinstance(b,dict)or a.keys()!=b.keys():raise AssertionError(f'{path}: field presence differs: TS={list(a)} Rust={list(b)if isinstance(b,dict)else b}')
  for key in a:equal(a[key],b[key],path+'/'+key)
 elif isinstance(a,list):
  if not isinstance(b,list)or len(a)!=len(b):raise AssertionError(f'{path}: array count differs: {len(a)} vs {len(b)if isinstance(b,list)else b}')
  for i,(x,y)in enumerate(zip(a,b)):equal(x,y,f'{path}/{i}')
 elif isinstance(a,bool)!=isinstance(b,bool):raise AssertionError(f'{path}: bool/number differs')
 elif isinstance(a,(int,float))and isinstance(b,(int,float)):
  if isinstance(b,int)and float(b)!=b:raise AssertionError(f'{path}: integer precision unavailable to JS Number')
  if float(a)!=float(b):raise AssertionError(f'{path}: TS={a!r} Rust={b!r}')
 elif a!=b:raise AssertionError(f'{path}: TS={a!r} Rust={b!r}')
def compare(cases,expected,actual):
 for output in [expected,actual]:
  if not isinstance(output,list)or len(output)!=len(cases):raise AssertionError('Output count/type differs from source corpus')
  for case,row in zip(cases,output):
   if not isinstance(row,dict)or row.keys()!={'name','result'}or row['name']!=case['name']:raise AssertionError('Source case identity/envelope/order differs')
   result=row['result']
   if not isinstance(result,dict)or not isinstance(result.get('trace'),list):raise AssertionError('Trace envelope missing')
   if 'error'in result:
    if result.keys()!={'trace','error'}or not isinstance(result['error'],dict):raise AssertionError('Constructor failure envelope invalid')
   else:
    if not {'trace','receipts','portfolio','retained','retainedNumberBits'}<=result.keys():raise AssertionError('Full-body output envelope missing')
    receipts={op['receipt']for op in case['input']['operations']if op['kind']in ['submitTick','submitAccount']}
    if not isinstance(result['receipts'],dict)or result['receipts'].keys()!=receipts:raise AssertionError('Receipts do not bind source submissions')
    for receipt in result['receipts'].values():
     if not isinstance(receipt,dict)or receipt.get('status')not in ['pending','fulfilled','rejected','capture_rejected']:raise AssertionError('Receipt status invalid')
 equal(expected,actual)
def mutations():
 cases=[{'name':'a','input':{'operations':[{'kind':'submitTick','receipt':'r'}]}},{'name':'b','input':{'operations':[]}}]
 result={'trace':[{'kind':'strategyMarket','portfolioId':1,'portfolioNumberBits':{'/nowMs':'8000000000000000'}}],'receipts':{'r':{'status':'fulfilled'}},'portfolio':{},'retained':[],'retainedNumberBits':{}}
 good=[{'name':'a','result':result},{'name':'b','result':{**copy.deepcopy(result),'receipts':{}}}]
 compare(cases,good,copy.deepcopy(good))
 count=0
 for a,b in [(0,False),(1,True),(False,0),(True,1),({'field':None},{}),({}, {'field':None}),(9007199254740992,9007199254740993)]:
  try:equal(a,b)
  except AssertionError:count+=1
  else:raise AssertionError('Comparator accepted scalar/presence mutation')
 for kind in ['omit','duplicate','order','identity','envelope','receipt','status']:
  wrong=copy.deepcopy(good)
  if kind=='omit':wrong=[]
  elif kind=='duplicate':wrong.append(copy.deepcopy(wrong[0]))
  elif kind=='order':wrong.reverse()
  elif kind=='identity':wrong[0]['name']='other'
  elif kind=='envelope':del wrong[0]['result']['trace']
  elif kind=='receipt':wrong[0]['result']['receipts']={}
  else:wrong[0]['result']['receipts']['r']['status']=True
  try:compare(cases,wrong,copy.deepcopy(wrong))
  except AssertionError:count+=1
  else:raise AssertionError('Comparator accepted symmetric malformed output')
 for key in ['identity','bits','trace','receipt']:
  wrong=copy.deepcopy(good)
  if key=='identity':wrong[0]['result']['trace'][0]['portfolioId']=2
  elif key=='bits':wrong[0]['result']['trace'][0]['portfolioNumberBits']['/nowMs']='0000000000000000'
  elif key=='trace':wrong[0]['result']['trace']=[]
  else:wrong[0]['result']['receipts']['r']['status']='pending'
  try:compare(cases,good,wrong)
  except AssertionError:count+=1
  else:raise AssertionError('Comparator accepted body observation mutation')
 return count

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--node',default='node');parser.add_argument('--cargo',default=str(Path.home()/'.cargo/bin/cargo'));parser.add_argument('--release',action='store_true');parser.add_argument('--target-dir',type=Path);parser.add_argument('--report',type=Path);args=parser.parse_args()
 tools=provenance.tooling(args.node,args.cargo)
 if not tools['node']['version'].startswith('v20.'):raise RuntimeError('Node20 required')
 wrappers={p:digest(ROOT/p)for p in WRAPPERS};native=native_hashes();cases=fixtures();payload=json.dumps(cases,separators=(',',':'))+'\n'
 with tempfile.TemporaryDirectory(prefix='native-runner-full-')as temporary:
  folder=Path(temporary);target=args.target_dir.resolve()if args.target_dir else folder/'cargo-target'
  target.mkdir(parents=True,exist_ok=True)
  marker=target/'runner-source-root.txt';root_identity=str(ROOT.resolve())+'\n'
  if marker.exists()and marker.read_text()!=root_identity:raise RuntimeError('Cargo target belongs to a different source root')
  marker.write_text(root_identity)
  command=[args.cargo,'test','--locked','--offline','--no-run','--manifest-path',str(NATIVE/'Cargo.toml'),'--test','runner_full','--message-format=json','--target-dir',str(target)]
  if args.release:command.append('--release')
  build=subprocess.run(command,cwd=ROOT,text=True,capture_output=True,check=True)
  artifacts=[json.loads(line)for line in build.stdout.splitlines()if line.startswith('{')]
  binaries=[Path(row['executable'])for row in artifacts if row.get('reason')=='compiler-artifact'and row.get('target',{}).get('name')=='runner_full'and row.get('executable')]
  if len(binaries)!=1:raise RuntimeError('Exactly one Cargo-authoritative driver required')
  if native!=native_hashes():raise RuntimeError('Native source set/bytes changed during build')
  binary=binaries[0];fingerprint=digest(binary);frozen=folder/'driver';shutil.copy2(binary,frozen)
  if digest(binary)!=fingerprint or digest(frozen)!=fingerprint:raise RuntimeError('Binary changed while freezing')
  source=folder/'input.json';source.write_text(payload)
  def oracle(output,trace):
   trace.write_text('');subprocess.run([args.node,'--require',str(ROOT/WRAPPERS[4]),'--import','tsx',str(ROOT/WRAPPERS[2]),str(source),str(output)],cwd=ROOT,env={**os.environ,'PMB_DISPATCH_DEPENDENCY_TRACE':str(trace)},check=True,text=True,capture_output=True)
   return {Path(json.loads(line))for line in trace.read_text().splitlines()}
  loaded=oracle(folder/'discovery-output.json',folder/'discovery.jsonl');dependency_set=provenance.dependency_files(loaded);dependency_hashes={str(p):digest(p)for p in dependency_set}
  actual_loaded=oracle(folder/'reference-output.json',folder/'authoritative.jsonl');provenance.dependency_guard(dependency_set,dependency_hashes,provenance.dependency_files(actual_loaded))
  if loaded!=actual_loaded:raise RuntimeError('Loaded oracle dependency set changed')
  reference={}
  for path in loaded:
   if path.is_relative_to(ROOT/'src')and path.suffix in ['.ts','.js','.mts']:
    relative=str(path.relative_to(ROOT))
    if path.read_bytes()!=subprocess.check_output(['git','show',f'{REFERENCE}:{relative}'],cwd=ROOT):raise RuntimeError(f'Unpinned oracle production import:{relative}')
    reference[relative]=digest(path)
  expected=json.loads((folder/'reference-output.json').read_text());output=folder/'native-output.json'
  subprocess.run([str(frozen),'full_body_fixture_driver','--ignored','--exact'],cwd=ROOT,env={**os.environ,'PMB_RUNNER_FIXTURE_INPUT':str(source),'PMB_RUNNER_FIXTURE_OUTPUT':str(output)},check=True,text=True,capture_output=True)
  actual=json.loads(output.read_text());compare(cases,expected,actual)
  if source.read_text()!=payload or digest(frozen)!=fingerprint:raise RuntimeError('Frozen binary/input mutated')
 if native!=native_hashes():raise RuntimeError('Native source set/bytes changed during comparison')
 provenance.dependency_guard(dependency_set,dependency_hashes,provenance.dependency_files(loaded))
 if tools!=provenance.tooling(args.node,args.cargo):raise RuntimeError('Compiler/Node tooling changed')
 for p,h in wrappers.items():
  if digest(ROOT/p)!=h:raise RuntimeError(f'Wrapper/package source changed:{p}')
 report=dict(referenceCommit=REFERENCE,tooling=tools,nativeInputsSha256=native,oracleSourceSha256=reference,wrapperSha256=wrappers,importedOracleDependencySha256=dependency_hashes,importedDependencySetAndBytesGuarded=True,nativeBinarySha256=fingerprint,nativeBinaryFrozenForExecution=True,cargoTargetSourceRootIsolated=True,buildProfile='release'if args.release else'debug',buildCommand=command,fixtureInputSha256=hashlib.sha256(payload.encode()).hexdigest(),cases=len(cases),comparatorMutationChecks=mutations(),dependencyMutationChecks=provenance.dependency_mutation_checks(),fullFixtureOutputParity=True,productionReady=False,completeRunnerAcceptance=False,scope='Actual shared Runner, OrderManager, Portfolio and PluginSet bodies with original graph tick/event/intent/snapshot/context identities; scripted strategy, provider, clock and execution edges only. Existing18 original bodies plus4 public metadata cases and current-falsy plugin-cache regression. Raw production ingress and arbitrary generic coercion/accessor financial paths, full operators/clock Date string coercion, live/execution adapters, exact owning ECMAScript nested Promise-job scheduling, all supported strategies/feeds/replay modes and fleet remain required.')
 if args.report:args.report.write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({k:report[k]for k in ['cases','buildProfile','comparatorMutationChecks','fullFixtureOutputParity','productionReady']},indent=2))
if __name__=='__main__':main()
