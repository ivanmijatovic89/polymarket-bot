"""Production producer -> isolated real Redis queues -> real MySQL persistence."""
import argparse
import copy
import hashlib
import json
import os
import shutil
import statistics
import subprocess
import time
import uuid
from pathlib import Path
from compare import compare, normalized
from raw_benchmark_helpers import sha, raw_fingerprint
from benchmark import fingerprint

HERE = Path(__file__).resolve().parent


def sources(root):
    return {str(p.relative_to(root)): sha(p) for p in sorted((root/'src').rglob('*.ts'))}


def controls(manifest, root, commit):
    return dict(os.environ, BOT_ENV='', WORKER_LAUNCH_SHA=commit,
        BACKTEST_ALLOW_DIRTY='1', INITIAL_CAPITAL='1000',
        BINANCE_DATA_BASE_DIR=str(root/'data/binance'),
        TELONEX_CRYPTO_PRICES_BASE_DIR=str(root/'data/telonex/crypto_prices'),
        BACKTEST_BINANCE_FEED_LATENCY_MS=str(manifest['settings']['binanceLatencyMs']),
        BACKTEST_RTDS_CHAINLINK_LATENCY_MS=str(manifest['settings']['chainlinkLatencyMs']),
        BACKTEST_PRICE_TO_BEAT_LATENCY_MS=str(manifest['settings']['priceToBeatLatencyMs']),
        BACKTEST_BINANCE_FEED_LOOKBACK_MS=str(manifest['rawInputSettings']['binanceLookbackMs']),
        BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS=str(manifest['rawInputSettings']['chainlinkLookbackMs']),
        BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS=str(manifest['rawInputSettings']['chainlinkMaxGapMs']),
        BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS='0', WEB_UI_ORDERBOOK_LEVELS='10', BENCHMARK_PROGRESS_EVERY='0')


def prepare_snapshot(root, target, namespace, manifest_path, commit):
    target.mkdir()
    shutil.copytree(root/'src', target/'src')
    for name in ['package.json', 'package-lock.json', 'tsconfig.json']:
        shutil.copy2(root/name, target/name)
    for name in ['node_modules', 'data', '.env']:
        (target/name).symlink_to(root/name, target_is_directory=name != '.env')
    patches = {}
    def patch(rel, fn):
        p=target/rel; original=p.read_text(); altered=fn(original)
        if altered == original: raise RuntimeError('Snapshot patch failed: '+rel)
        p.write_text(altered); patches[rel]={'before':hashlib.sha256(original.encode()).hexdigest(),'after':sha(p)}
    patch('src/backtest/queue.ts', lambda s:s.replace("'backtest-markets'", repr(namespace+'backtest-markets')).replace("'backtest-aggregate'", repr(namespace+'backtest-aggregate')))
    patch('src/db/schema.ts', lambda s: replace_tables(s, namespace))
    patch('src/backtest/workerIdentity.ts', lambda s:s.replace('`backtest:worker:', '`'+namespace+'backtest:worker:').replace("return getGitRefSha('HEAD')", 'return process.env.WORKER_LAUNCH_SHA!'))
    # Validate the real producer payload immediately before submission. No replay or selection logic changes.
    hook = '''
  if (process.env.RUST_BENCH_ROUND_DIRECTORY) {
    const fsAudit = await import('node:fs/promises')
    const assertAudit = (await import('node:assert/strict')).default
    const frozenAudit = JSON.parse(await fsAudit.readFile(process.env.RUST_BENCH_MANIFEST!, 'utf8'))
    assertAudit.deepEqual(marketContexts.map(ctx => ctx.slug), frozenAudit.markets.map((m: { slug: string }) => m.slug))
    assertAudit.equal(totalMarkets, frozenAudit.markets.length)
    await fsAudit.writeFile(process.env.RUST_BENCH_ROUND_DIRECTORY + '/producer-payload.json', JSON.stringify({ aggData, children }))
  }
'''
    patch('src/cli/backtest.ts', lambda s:s.replace("  let node: Awaited<ReturnType<typeof flow.add>>", hook+"\n  let node: Awaited<ReturnType<typeof flow.add>>"))
    return patches


def replace_tables(s, namespace):
    for name in ['backtest_runs','backtest_run_markets','backtest_run_segments','backtest_run_failures']:
        s=s.replace(repr(name), repr(namespace+name))
    return s


def execute(command, directory, env, log_path):
    with log_path.open('wb') as log:
        p=subprocess.run(command,cwd=directory,env=env,stdout=log,stderr=log)
    if p.returncode:
        raise RuntimeError(f'{log_path.name} failed; see local log (not printed to avoid exposing connection details)')


def stable_job(r):
    r=copy.deepcopy(r);r.pop('durationMs')
    if r['marketStats']:
        for field in ['startedAtMs','finishedAtMs','durationMs','workerChildId']:
            r['marketStats']['execution'].pop(field)
    return r


def round_run(mode, count, directory, settings_path, settings, manifest, workers, node, env):
    directory.mkdir()
    subset=copy.deepcopy(manifest)
    if count == 2: subset['markets']=[manifest['markets'][0],manifest['markets'][50]]
    round_manifest=directory/'manifest.json';round_manifest.write_text(json.dumps(subset))
    round_settings=dict(settings,manifestPath=str(round_manifest))
    config=directory/'settings.json';config.write_text(json.dumps(round_settings))
    round_env=dict(env,RUST_BENCH_ROUND_DIRECTORY=str(directory),RUST_BENCH_MANIFEST=str(round_manifest))
    children=[]
    def start(role,i):
        log=(directory/f'{role}-{i}.log').open('wb')
        p=subprocess.Popen([node,'--import','tsx',str(HERE/'e2e-worker.mts'),str(config),mode,role,str(i),str(directory)],cwd=settings['snapshotRoot'],env=round_env,stdout=log,stderr=log)
        children.append((p,log,role,i))
    try:
        for i in range(1,workers+1): start('market',i)
        start('aggregate',0)
        deadline=time.monotonic()+90
        while not all((directory/f'{role}-{i}-ready').exists() for _,_,role,i in children):
            if any(p.poll() is not None for p,_,_,_ in children): raise RuntimeError(f'{mode} worker startup failed; see {directory}')
            if time.monotonic()>deadline: raise RuntimeError('Worker readiness timeout')
            time.sleep(.2)
        argv=['--strategy-artifact',manifest['artifactSha256'],'--input-mode','telonex-delta','--read-from','local-or-download-from-r2-to-local','--starting-capital',str(manifest['settings']['startingCapital']),'--latency-delay-ms',str(manifest['settings']['delayMs']),'--latency-jitter-ms',str(manifest['settings']['jitterMs']),'--batchUid',directory.name,'--comment','Isolated Rust end-to-end benchmark']
        if count==2:
            for m in subset['markets']: argv.extend(['--slug',m['slug']])
        else:
            argv.extend(['--symbol','btc','--timeframe','15m','--from-ms',str(subset['markets'][0]['startMs']),'--to-ms',str(subset['markets'][-1]['startMs']),'--limit',str(len(subset['markets']))])
        for k,v in manifest['params'].items():argv.extend(['--param',f'{k}={v}'])
        begin=time.perf_counter();begin_epoch=time.time()*1000
        with (directory/'producer.log').open('wb') as log:
            producer=subprocess.Popen([node,'--import','tsx',str(Path(settings['snapshotRoot'])/'src/cli/backtest.ts'),*argv],cwd=settings['snapshotRoot'],env=round_env,stdout=log,stderr=log)
            children.append((producer,log,'producer',0))
            deadline=time.monotonic()+2400
            while producer.poll() is None:
                if time.monotonic()>deadline:raise RuntimeError('Producer completion timeout')
                if any(p.poll() is not None for p,_,role,_ in children if role!='producer'):raise RuntimeError('Worker exited during benchmark')
                time.sleep(.2)
            end=time.perf_counter()
            if producer.returncode:raise RuntimeError(f'Producer failed; see {directory}/producer.log')
        complete=json.loads((directory/'aggregate-complete.json').read_text())
        assert complete['result']['totalFailed']==0 and complete['result']['totalSucceeded']==count
        end_to_end=(end-begin)*1000
        for p,_,role,_ in children:
            if role!='producer':p.terminate()
        for p,_,_,_ in children:
            p.wait(timeout=30)
        results=[];logs={};timings=[]
        for i in range(1,workers+1):
            result=json.loads((directory/f'market-{i}-results.json').read_text())
            results+=result['results'];logs.update(result['logs']);timings+=result['timings']
        results.sort(key=lambda r:r['idx'])
        assert [r['idx'] for r in results]==list(range(count))
        saved=complete['result']['submissionUid']
        execute([node,'--import','tsx',str(HERE/'e2e-setup.mts'),str(settings_path),'dump'],settings['snapshotRoot'],env,directory/'database-dump.log')
        tables=json.loads((Path(settings['directory'])/'persisted-results.json').read_text())
        run=next(r for r in tables['backtest_runs'] if r['submission_uid']==saved)
        persisted={'run':run,'markets':[r for r in tables['backtest_run_markets'] if r['run_id']==run['id']],'segments':[r for r in tables['backtest_run_segments'] if r['run_id']==run['id']],'failures':[r for r in tables['backtest_run_failures'] if r['run_id']==run['id']]}
        assert len(persisted['markets'])==count and not persisted['failures']
        assert run['status']=='completed' and run['markets_persisted']==count
        (directory/'persisted.json').write_text(json.dumps(persisted))
        phase={'producerStartEpochMs':begin_epoch,'firstMarketEpochMs':min(t['begin'] for t in timings),'lastMarketEpochMs':max(t['end'] for t in timings),'aggregateStartEpochMs':complete['begin'],'aggregateFinishEpochMs':complete['end'],'producerStartupToFirstMarketMs':min(t['begin'] for t in timings)-begin_epoch,'marketProcessingSpanMs':max(t['end'] for t in timings)-min(t['begin'] for t in timings),'aggregateAndPersistenceAndCleanupMs':complete['end']-complete['begin'],'submissionToAggregateCompletionMs':complete['end']-begin_epoch,'producerLaunchThroughExitMs':end_to_end}
        (directory/'observations.json').write_text(json.dumps({'mode':mode,'results':results,'logs':logs,'timings':timings,'phase':phase},indent=2))
        return results,logs,persisted,phase
    finally:
        for p,log,_,_ in children:
            if p.poll() is None:
                p.terminate()
                try:p.wait(timeout=30)
                except subprocess.TimeoutExpired:p.kill();p.wait()
            log.close()


def stable_persisted(doc):
    doc=copy.deepcopy(doc)
    for row in [doc['run']]+doc['markets']+doc['segments']+doc['failures']:
        for key in ['id','run_id','created_at','updated_at','batch_uid','submission_uid','cmd','machine_id','worker_child_id','started_at_ms','finished_at_ms','duration_ms','duration_total_ms','duration_avg_ms','duration_wall_clock_ms']:
            row.pop(key,None)
    doc['markets'].sort(key=lambda r:r['idx'])
    doc['segments'].sort(key=lambda r:(r['segment_kind'],r['segment_key']))
    return doc


def main():
    p=argparse.ArgumentParser();p.add_argument('--node',required=True);p.add_argument('--production-root',type=Path,required=True);p.add_argument('--manifest',type=Path,required=True);p.add_argument('--results',type=Path,default=HERE/'results/end-to-end');p.add_argument('--workers',type=int,default=8);p.add_argument('--repetitions',type=int,default=3);p.add_argument('--smoke-only',action='store_true');p.add_argument('--reuse-preflight',type=Path);args=p.parse_args()
    root=args.production_root.resolve();directory=args.results.resolve();directory.mkdir(parents=True,exist_ok=True)
    if any(directory.iterdir()):raise RuntimeError('Results directory must be new')
    manifest=json.loads(args.manifest.read_text());assert len(manifest['markets'])==1000
    version=subprocess.check_output([args.node,'--version'],text=True).strip();assert version.startswith('v20.')
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    original_sources=sources(root);namespace='rbx_'+uuid.uuid4().hex[:8]+'_';snapshot=directory/'snapshot'
    patches=prepare_snapshot(root,snapshot,namespace,args.manifest.resolve(),commit)
    settings={'namespace':namespace,'productionRoot':str(root),'snapshotRoot':str(snapshot),'productionCommit':commit,'manifestPath':str(args.manifest.resolve()),'directory':str(directory),'binary':str(HERE/'target/release/rust-backtest-experiment')}
    settings_path=directory/'settings.json';settings_path.write_text(json.dumps(settings,indent=2))
    env=controls(manifest,root,commit)
    fingerprint(manifest);raw_fingerprint(manifest)
    binary_hash=sha(Path(settings['binary']));snapshot_sources=sources(snapshot)
    harness={p.name:sha(p) for p in [HERE/'e2e-check.py',HERE/'e2e-worker.mts',HERE/'e2e-setup.mts',HERE/'e2e-selection.mts']}
    report={'dateUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'namespace':namespace,'productionCommit':commit,'node':version,'manifestSha256':sha(args.manifest),'binarySha256':binary_hash,'nativeSourceSha256':{str(p.relative_to(HERE)):sha(p) for p in sorted((HERE/'src').glob('*.rs'))},'productionSourceSha256':original_sources,'snapshotSourceSha256':snapshot_sources,'snapshotPatches':patches,'harnessSha256':harness,'workers':args.workers,'repetitions':args.repetitions,'loadStart':os.getloadavg(),'scope':'Current production producer/catalog/schema/artifact/preflight; real BullMQ transport/scheduling, heartbeats/counters; complete local engine; actual aggregate processor and durable MySQL writes and Redis cleanup. Configured Redis/MySQL hosts, isolated queues/heartbeat keys/result tables. Single Mac, cached local files, frozen v15 strategy. Normal console formatting and file log output retained. Persistent worker service startup outside submission timing; native process startup per market included.'}
    (directory/'progress.json').write_text(json.dumps(report,indent=2))
    print('Read-only production selection preflight',flush=True)
    if args.reuse_preflight:
        prior=args.reuse_preflight.resolve();prior_proof=json.loads((prior/'progress.json').read_text())
        assert prior_proof['productionSourceSha256']==original_sources
        assert prior_proof['originalManifestSha256']==sha(args.manifest)
        assert prior_proof['harnessSha256']['e2e-selection.mts']==sha(HERE/'e2e-selection.mts')
        assert prior_proof['manifestSha256']==sha(prior/'current-manifest.json')
        for name in ['current-manifest.json','selection-preflight.json','added-typescript-trace.json','added-manifest.json']:shutil.copy2(prior/name,directory/name)
        report['reusedPreflightSource']=str(prior)
    else:
        execute([args.node,'--import','tsx',str(HERE/'e2e-selection.mts'),str(settings_path)],snapshot,env,directory/'selection.log')
    manifest=json.loads((directory/'current-manifest.json').read_text())
    settings['manifestPath']=str(directory/'current-manifest.json');settings_path.write_text(json.dumps(settings,indent=2))
    report['originalManifestSha256']=report['manifestSha256'];report['manifestSha256']=sha(directory/'current-manifest.json');report['selection']=manifest['selection']
    fingerprint(manifest);raw_fingerprint(manifest)
    print('Validating complete traces for newly selected markets',flush=True)
    added=set(manifest['selection']['additionalMarkets'])
    if added:
        extra=dict(manifest,markets=[m for m in manifest['markets'] if m['slug'] in added])
        extra_path=directory/'added-manifest.json';extra_path.write_text(json.dumps(extra))
        copied=snapshot/'experiments/rust-backtest';copied.mkdir(parents=True)
        for name in ['oracle.mts','common.mts']:shutil.copy2(HERE/name,copied/name)
        trace_env=dict(env,BENCHMARK_DATA_ROOT=str(root))
        if args.reuse_preflight:
            old_manifest=json.loads((args.reuse_preflight/'added-manifest.json').read_text());assert old_manifest==extra
            old_oracle=args.reuse_preflight/'snapshot/experiments/rust-backtest'
            for name in ['oracle.mts','common.mts']:assert sha(old_oracle/name)==sha(copied/name)
            report['reusedAddedTypeScriptTraceSha256']=sha(directory/'added-typescript-trace.json')
        else:
            execute([args.node,'--import','tsx',str(copied/'oracle.mts'),str(extra_path),str(directory/'added-typescript-trace.json'),'production','trace'],snapshot,trace_env,directory/'added-typescript-trace.log')
        execute([settings['binary'],str(extra_path),str(directory/'added-rust-trace.json'),'trace'],snapshot,trace_env,directory/'added-rust-trace.log')
        ts_trace=json.loads((directory/'added-typescript-trace.json').read_text());rust_trace=json.loads((directory/'added-rust-trace.json').read_text())
        assert ts_trace['engine']=='typescript' and ts_trace['mode']=='production' and ts_trace['trace'] and ts_trace['node']==version
        assert ts_trace['manifestSha256']==sha(extra_path) and rust_trace['manifestSha256']==sha(extra_path)
        compare(normalized(ts_trace),normalized(rust_trace))
        report['addedTypeScriptTraceSha256']=sha(directory/'added-typescript-trace.json');report['addedRustTraceSha256']=sha(directory/'added-rust-trace.json')
        report['addedFullTraceParity']=len(added)
    provenance=json.loads((HERE/'results/june-1000-full/full-typescript-trace-provenance.json').read_text())
    assert provenance['schema']=='full-local-output-v2'
    reference={}
    for ref_path in sorted((HERE/'results/june-1000-full').glob('full-trace-typescript-[0-7].json')):
        assert sha(ref_path)==provenance['outputsSha256'][ref_path.name]
        reference_doc=json.loads(ref_path.read_text());assert reference_doc['engine']=='typescript' and reference_doc['mode']=='production' and reference_doc['trace'] and reference_doc['node']==version
        for r in normalized(reference_doc):
            if r['slug'] not in added:reference[r['slug']]={k:r[k] for k in ['slug','eventsProcessed','eventsByType','stats']}
    if added:
        for r in normalized(json.loads((directory/'added-typescript-trace.json').read_text())):reference[r['slug']]={k:r[k] for k in ['slug','eventsProcessed','eventsByType','stats']}
    assert all(m['slug'] in reference for m in manifest['markets'])
    report['fullTraceReferenceMarkets']=len(manifest['markets'])
    print('Creating isolated result tables on configured MySQL host',flush=True)
    execute([args.node,'--import','tsx',str(HERE/'e2e-setup.mts'),str(settings_path),'prepare'],snapshot,env,directory/'setup.log')
    os.nice(10)
    measurements=[]
    for count,reps,workers,label in [(2,1,2,'smoke')]+([] if args.smoke_only else [(1000,args.repetitions,args.workers,'full')]):
        for repetition in range(reps):
            collected={}
            for mode in (['rust','typescript'] if repetition%2==0 else ['typescript','rust']):
                name=f'{label}-{repetition+1}-{mode}'
                print(f'Starting {name}: {count} markets, {workers} real Redis workers',flush=True)
                outputs,logs,persisted,phase=round_run(mode,count,directory/name,settings_path,settings,manifest,workers,args.node,env)
                for output in outputs:
                    expected=copy.deepcopy(reference[output['slug']]);execution=output['marketStats']['execution']
                    for field in ['machineId','workerChildId','commitSha']:expected['stats']['execution'][field]=execution[field]
                    actual={'slug':output['slug'],'eventsProcessed':output['eventsProcessed'],'eventsByType':output['eventsByType'],'stats':output['marketStats']}
                    compare(expected,normalized({'results':[actual]})[0])
                collected[mode]=(outputs,logs,persisted)
                measurements.append({'name':name,'engine':mode,'marketCount':count,'workers':workers,'phase':phase,'load':os.getloadavg()})
                report['measurements']=measurements;(directory/'progress.json').write_text(json.dumps(report,indent=2))
                print(f'{name}: {phase["producerLaunchThroughExitMs"]/1000:.3f}s launch-through-exit; {phase["submissionToAggregateCompletionMs"]/1000:.3f}s through persisted aggregate completion',flush=True)
            compare([stable_job(r) for r in collected['typescript'][0]],[stable_job(r) for r in collected['rust'][0]])
            compare(collected['typescript'][1],collected['rust'][1])
            compare(stable_persisted(collected['typescript'][2]),stable_persisted(collected['rust'][2]))
            print(f'{label}-{repetition+1}: full job, trade-log and persisted market/segment result parity passed',flush=True)
    fingerprint(manifest);raw_fingerprint(manifest)
    assert sources(snapshot)==snapshot_sources and sha(Path(settings['binary']))==binary_hash
    assert all(sha(HERE/name)==h for name,h in harness.items())
    report.update(sourceInputBinaryChecksPassed=True,fullJobParity=True,tradeLogParity=True,persistedResultParity=True,loadFinish=os.getloadavg())
    if not args.smoke_only:
        full=[m for m in measurements if m['marketCount']==1000]
        medians={mode:statistics.median(m['phase']['producerLaunchThroughExitMs'] for m in full if m['engine']==mode) for mode in ['typescript','rust']}
        persisted={mode:statistics.median(m['phase']['submissionToAggregateCompletionMs'] for m in full if m['engine']==mode) for mode in ['typescript','rust']}
        report.update(medianLaunchThroughExitMs=medians,medianThroughPersistedCompletionMs=persisted,medianEndToEndSpeedup=medians['typescript']/medians['rust'],medianPersistedCompletionSpeedup=persisted['typescript']/persisted['rust'])
    (directory/'measurements.json').write_text(json.dumps(report,indent=2))
    print('End-to-end benchmark completed; evidence saved',flush=True)


if __name__=='__main__':main()
