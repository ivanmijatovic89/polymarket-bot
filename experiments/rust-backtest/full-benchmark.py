"""Fresh full-output parity, then repeated original-file local batch timings."""
import argparse
import hashlib
import json
import os
import platform
import subprocess
import time
from pathlib import Path
from benchmark import HERE, command, execute, fingerprint, summary
from scaling import chunks_for, run_workers
from raw_benchmark_helpers import raw_fingerprint, source_fingerprint, sha
from compare import compare


def aggregate(engine, records, manifest, label, directory, node):
    starts={m['slug']:m['startMs'] for m in manifest['markets']}
    markets=[dict(r['stats'],marketStartMs=starts[r['slug']]) for r in records]
    source=directory/f'{label}-aggregate-input.json'
    output=directory/f'{label}-aggregate.json'
    source.write_text(json.dumps({'markets':markets,'initialCapital':1000}))
    if engine.startswith('typescript'):
        cmd=[node,'--import','tsx',str(HERE/'aggregate-oracle.mts'),str(source),str(output)]
    else:
        cmd=[str(HERE/'target/release/rust-backtest-experiment'),'aggregate',str(source),str(output)]
    measured=execute(cmd,label+'-aggregate',directory)
    return json.loads(output.read_text()), measured


def stable_aggregate(document):
    document=json.loads(json.dumps(document))
    for stats in [document['batch']]+[s['stats'] for s in document['segments']]:
        for key in ['durationTotalMs','durationAvgMs','durationWallClockMs']:
            stats.pop(key)
    return document


def batch_run(engine, chunks, label, directory, node, trace, manifest):
    start=time.perf_counter()
    records,measured=run_workers(engine,chunks,label,directory,node,trace)
    # Preserve each engine's actual execution timing for its own batch report.
    raw={}
    for index in range(len(chunks)):
        doc=json.loads((directory/f'{label}-{index}.json').read_text())
        for result in doc['results']:raw[result['slug']]=result
    slugs=[m['slug'] for m in manifest['markets']]
    if set(records)!=set(slugs):raise RuntimeError('Wrong market coverage')
    ordered=[raw[s] for s in slugs]
    aggregated,cost=aggregate(engine,ordered,manifest,label,directory,node)
    measured['cpuMs']+=cost['cpuMs']
    measured['peakRssBytes']=max(measured['peakRssBytes'],cost['peakRssBytes'])
    measured['aggregationMs']=cost['wallMs']
    measured['wallMs']=(time.perf_counter()-start)*1000
    return [records[s] for s in slugs],aggregated,measured


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--manifest',type=Path,required=True)
    parser.add_argument('--node',required=True)
    parser.add_argument('--results',type=Path,default=HERE/'results/june-1000-full')
    parser.add_argument('--workers',type=int,nargs='+',default=[8])
    parser.add_argument('--rounds',type=int,default=3)
    args=parser.parse_args()
    manifest=json.loads(args.manifest.read_text())
    if args.rounds<3 or any(w<1 or w>len(manifest['markets']) for w in args.workers):
        parser.error('At least three rounds and valid equal worker counts required')
    node_version=subprocess.check_output([args.node,'--version'],text=True).strip()
    if not node_version.startswith('v20.'):raise RuntimeError('Node 20 required')
    directory=args.results.resolve();directory.mkdir(parents=True,exist_ok=True)
    os.nice(10);os.environ['BENCHMARK_PROGRESS_EVERY']='25'
    for name,key in [('BACKTEST_BINANCE_FEED_LOOKBACK_MS','binanceLookbackMs'),('BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS','chainlinkLookbackMs'),('BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS','chainlinkMaxGapMs')]:
        os.environ[name]=str(manifest['rawInputSettings'][key])
    fingerprint(manifest);raw_fingerprint(manifest)
    sources=source_fingerprint();binary=sha(HERE/'target/release/rust-backtest-experiment')
    report={'dateUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'node':node_version,'rust':subprocess.check_output(['rustc','--version'],text=True).strip(),'platform':platform.platform(),'loadStart':os.getloadavg(),'manifestSha256':sha(args.manifest),'binarySha256':binary,'engineCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=HERE,text=True).strip(),'sourceSha256':sources,'marketCount':len(manifest['markets']),'rounds':args.rounds,'initialCapital':1000,'workerStartingCapital':manifest['settings']['startingCapital'],'measurements':{},'scope':'Original local market and Binance/Chainlink files; complete local order/portfolio/context/diagnostics and market/batch/calendar/tail statistics for the pinned v15 telonex-delta workload. Queue/database/network/fleet excluded. Other strategies/plugins/input formats not benchmarked. Logging output disabled in both engines. Warm filesystem cache. Workers are processes, not CPU affinity.'}
    chunks=chunks_for(manifest,max(args.workers),directory)
    print(f'Fresh full TypeScript traces: {len(manifest["markets"])} markets',flush=True)
    expected,ts_aggregate,_=batch_run('typescript-production',chunks,'full-trace-typescript',directory,args.node,'trace',manifest)
    print('Fresh full Rust traces',flush=True)
    native,rs_aggregate,_=batch_run('rust',chunks,'full-trace-rust',directory,args.node,'trace',manifest)
    compare(expected,native);compare(stable_aggregate(ts_aggregate),stable_aggregate(rs_aggregate))
    report['parity']={'fullOutputs':True,'marketCount':len(expected),'replayEvents':sum(r['eventsProcessed'] for r in expected),'decisions':sum(len(r['decisions']) for r in expected),'accountEvents':sum(len(r['events']) for r in expected),'contextMetricsEveryTick':True,'fullPortfolio':True,'intentMetaAndReasons':True,'batchAndSegments':True,'numericTolerance':1e-10,'normalizedFields':['per-market durationMs','execution startedAtMs/finishedAtMs/durationMs','batch/segment durationTotalMs/durationAvgMs/durationWallClockMs']}
    target=[{k:r[k] for k in ['slug','eventsProcessed','eventsByType','stats']} for r in expected]
    target_aggregate=stable_aggregate(ts_aggregate)
    (directory/'progress.json').write_text(json.dumps(report,indent=2))
    print('All 1000 full replay outputs and batch/segment statistics passed',flush=True)
    for workers in args.workers:
        chunks=chunks_for(manifest,workers,directory)
        samples={'typescript-production':[],'rust':[]}
        for iteration in range(args.rounds):
            order=['typescript-production','rust'] if iteration%2==0 else ['rust','typescript-production']
            for engine in order:
                label=f'full-{workers}-workers-{engine}-{iteration}'
                print(f'Timing {label}',flush=True)
                actual,aggregated,measurement=batch_run(engine,chunks,label,directory,args.node,'no-trace',manifest)
                compare(target,actual);compare(target_aggregate,stable_aggregate(aggregated))
                samples[engine].append(measurement)
                report['measurements'][str(workers)]={'samples':samples,'summary':{k:summary(v) for k,v in samples.items() if v}}
                (directory/'progress.json').write_text(json.dumps(report,indent=2))
                print(f'{label}: {measurement["wallMs"]/1000:.3f} s, outputs passed',flush=True)
        totals={e:summary(v) for e,v in samples.items()}
        report['measurements'][str(workers)]['speedup']=totals['typescript-production']['wallMs']['median']/totals['rust']['wallMs']['median']
    fingerprint(manifest);raw_fingerprint(manifest)
    if sources!=source_fingerprint() or binary!=sha(HERE/'target/release/rust-backtest-experiment'):
        raise RuntimeError('Source or binary changed during the experiment')
    report['loadFinish']=os.getloadavg();report['inputSourceBinaryChecksPassed']=True
    (directory/'measurements.json').write_text(json.dumps(report,indent=2))
    print('Complete. Source/input/binary hashes stable.',flush=True)
    for workers,result in report['measurements'].items():print(f'{workers} workers: {result["speedup"]:.3f}x median speedup',flush=True)

if __name__=='__main__':main()
