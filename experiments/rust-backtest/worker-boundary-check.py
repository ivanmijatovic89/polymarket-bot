"""Audit current production processor wiring and native process handoff, offline."""
import argparse
import copy
import hashlib
import json
import os
import statistics
import subprocess
import time
from pathlib import Path
from benchmark import HERE, execute, fingerprint
from compare import compare, normalized
from raw_benchmark_helpers import raw_fingerprint, source_fingerprint, sha


def stable_aggregate(document):
    document=copy.deepcopy(document)
    for stats in [document['batch']]+[s['stats'] for s in document['segments']]:
        for key in ['durationTotalMs','durationAvgMs','durationWallClockMs']:stats.pop(key)
    return document


def current_sources(root, artifact):
    paths=sorted(list((root/'src').rglob('*.ts'))+[root/'package.json',root/'package-lock.json',root/'data/strategy-artifacts'/f'{artifact}.mjs'])
    return {str(p.relative_to(root)):sha(p) for p in paths}


def replay_view(result):
    return {'slug':result['slug'],'eventsProcessed':result['eventsProcessed'],'eventsByType':result['eventsByType'],'stats':result['marketStats']}


def job_view(result):
    result=copy.deepcopy(result)
    result.pop('durationMs')
    if result['marketStats']:
        for field in ['startedAtMs','finishedAtMs','durationMs']:result['marketStats']['execution'].pop(field)
    return result


def batch(engine,manifest,workers,directory,node,root,binary,commit):
    started=time.perf_counter();children=[];outputs=[];diagnostics=[]
    try:
        for i in range(workers):
            indices=list(range(i,len(manifest['markets']),workers))
            chunk=dict(manifest,markets=[manifest['markets'][j] for j in indices],auditOriginalIndices=[manifest['auditOriginalIndices'][j] for j in indices])
            source=directory/f'{engine}-{i}-manifest.json';source.write_text(json.dumps(chunk))
            output=directory/f'{engine}-{i}.json';log=(directory/f'{engine}-{i}.log').open('wb')
            command=[node,'--import','tsx',str(HERE/'worker-boundary.mts'),str(root),str(source),str(output),engine,str(binary),str(i+1)]
            env=dict(os.environ,WORKER_LAUNCH_SHA=commit,BENCHMARK_PROGRESS_EVERY='0')
            p=subprocess.Popen(command,cwd=HERE.parent.parent,env=env,stdout=log,stderr=log)
            children.append((p,log,source,output))
        for p,log,source,output in children:
            p.wait();log.close()
            if p.returncode:raise RuntimeError(f'{engine} worker failed: {output.with_suffix(".log").read_text()}')
            doc=json.loads(output.read_text())
            if doc['manifestSha256']!=sha(source) or doc['productionCommit']!=commit:raise RuntimeError('Worker provenance mismatch')
            outputs.extend(doc['results']);diagnostics.extend(doc['diagnostics'])
    finally:
        for p,log,_,_ in children:
            if p.poll() is None:p.terminate();p.wait()
            log.close()
    outputs.sort(key=lambda r:r['idx'])
    if [r['idx'] for r in outputs]!=sorted(manifest['auditOriginalIndices']):raise RuntimeError('Wrong job coverage/order')
    starts={m['slug']:m['startMs'] for m in manifest['markets']}
    markets=[dict(r['marketStats'],marketStartMs=starts[r['slug']]) for r in outputs]
    aggregate_input=directory/f'{engine}-aggregate-input.json';aggregate_output=directory/f'{engine}-aggregate.json'
    aggregate_input.write_text(json.dumps({'markets':markets,'initialCapital':1000}))
    aggregate_timing=execute([node,'--import','tsx',str(HERE/'worker-boundary.mts'),str(root),str(aggregate_input),str(aggregate_output),'aggregate'],engine+'-aggregate',directory)
    timing={'wallMs':(time.perf_counter()-started)*1000,'aggregationMs':aggregate_timing['wallMs']}
    if diagnostics:
        overhead=[d['bridgeWallMs']-d['nativeBatchMs'] for d in diagnostics]
        timing['bridge']={'jobs':len(diagnostics),'summedWallMs':sum(d['bridgeWallMs'] for d in diagnostics),'summedNativeBatchMs':sum(d['nativeBatchMs'] for d in diagnostics),'summedDifferenceMs':sum(overhead),'medianDifferenceMs':statistics.median(overhead),'maxDifferenceMs':max(overhead),'requestBytes':sum(d['requestBytes'] for d in diagnostics),'responseBytes':sum(d['responseBytes'] for d in diagnostics),'note':'Sum of per-job elapsed intervals across concurrent workers, not batch wall time or isolated CPU cost. Includes process launch, filesystem/JSON handoff, native initialization and OS scheduling.'}
    return outputs,json.loads(aggregate_output.read_text()),timing


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--manifest',type=Path,required=True)
    parser.add_argument('--node',required=True)
    parser.add_argument('--production-root',type=Path,required=True)
    parser.add_argument('--workers',type=int,default=8)
    parser.add_argument('--indices',type=int,nargs='*')
    parser.add_argument('--results',type=Path,default=HERE/'results/worker-boundary-final')
    args=parser.parse_args()
    node_version=subprocess.check_output([args.node,'--version'],text=True).strip()
    if not node_version.startswith('v20.'):raise RuntimeError('Node 20 required')
    original=json.loads(args.manifest.read_text());manifest=copy.deepcopy(original)
    indices=args.indices if args.indices else list(range(len(manifest['markets'])))
    if len(set(indices))!=len(indices) or any(i<0 or i>=len(original['markets']) for i in indices):raise RuntimeError('Invalid market selection')
    manifest['markets']=[original['markets'][i] for i in indices];manifest['auditOriginalIndices']=indices
    if not 1<=args.workers<=len(indices):raise RuntimeError('Invalid worker count')
    directory=args.results.resolve();directory.mkdir(parents=True,exist_ok=True)
    root=args.production_root.resolve();binary=HERE/'target/release/rust-backtest-experiment'
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    sources=current_sources(root,original['artifactSha256']);experiment_sources=source_fingerprint();binary_hash=sha(binary)
    fingerprint(manifest);raw_fingerprint(manifest)
    os.nice(10)
    report={'dateUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'node':node_version,'productionCommit':commit,'productionSourceSha256':sources,'experimentSourceSha256':experiment_sources,'binarySha256':binary_hash,'manifestSha256':sha(args.manifest),'marketCount':len(indices),'workers':args.workers,'repetitions':1,'nice':10,'loadStart':os.getloadavg(),'scope':'Actual current production makeMarketProcessor and artifact loader; Node-to-native per-market subprocess/file/JSON handoff; current production batch and segment computation. Offline job envelopes, no BullMQ Redis transport, heartbeat, MySQL persistence, fleet or downloads. Console output suppressed; calculations preserved. One timing pair, not a repeated-run median.'}
    baseline=json.loads((HERE/'measurements-june-1000-full.json').read_text())
    provenance=json.loads((HERE/'results/june-1000-full/full-typescript-trace-provenance.json').read_text())
    if sha(args.manifest)!=baseline['manifestSha256'] or sha(args.manifest)!=provenance['manifestSha256'] or provenance['schema']!='full-local-output-v2':raise RuntimeError('Reference input provenance mismatch')
    for rel,h in provenance['sourceSha256'].items():
        if sha(HERE.parent.parent/rel)!=h:raise RuntimeError('Full reference source or artifact changed')
    reference={}
    for p in sorted((HERE/'results/june-1000-full').glob('full-trace-typescript-[0-7].json')):
        if sha(p)!=provenance['outputsSha256'][p.name]:raise RuntimeError('Full reference output changed')
        doc=json.loads(p.read_text())
        if doc['engine']!='typescript' or doc['mode']!='production' or not doc['trace'] or doc['node']!=node_version:raise RuntimeError('Reference runtime or trace mode differs')
        for r in normalized(doc):
            if r['slug'] in reference:raise RuntimeError('Duplicate full reference market')
            reference[r['slug']]=r
    expected=[]
    for local_idx,m in enumerate(manifest['markets']):
        r=copy.deepcopy(reference[m['slug']]);r={k:r[k] for k in ['slug','eventsProcessed','eventsByType','stats']}
        r['stats']['execution']['commitSha']=commit;r['stats']['execution']['workerChildId']=local_idx%args.workers+1
        expected.append(r)
    original_order={m['slug']:i for i,m in enumerate(original['markets'])}
    expected.sort(key=lambda r:original_order[r['slug']])
    # The existing full reference is valid only if its audited production runtime sources remain fixed.
    baseline=json.loads((HERE/'measurements-june-1000-full.json').read_text())
    for rel,h in baseline['sourceSha256'].items():
        if rel.startswith('src/') and sha(HERE.parent.parent/rel)!=h:raise RuntimeError('Measured production reference changed')
    actual={};aggregates={};measurements={}
    for engine in ['rust','typescript']:
        print(f'Starting current production processor boundary: {engine}',flush=True)
        outputs,aggregate_result,timing=batch(engine,manifest,args.workers,directory,args.node,root,binary,commit)
        compare(expected,normalized({'results':[replay_view(r) for r in outputs]}))
        actual[engine]=[job_view(r) for r in outputs];aggregates[engine]=stable_aggregate(aggregate_result);measurements[engine]=timing
        print(f'{engine}: {timing["wallMs"]/1000:.3f} s; all market outputs matched full reference',flush=True)
        (directory/'progress.json').write_text(json.dumps(dict(report,measurements=measurements),indent=2))
    compare(actual['typescript'],actual['rust']);compare(aggregates['typescript'],aggregates['rust'])
    fingerprint(manifest);raw_fingerprint(manifest)
    if sources!=current_sources(root,original['artifactSha256']) or experiment_sources!=source_fingerprint() or binary_hash!=sha(binary):raise RuntimeError('Inputs, implementation or current production source changed during boundary check')
    report.update(measurements=measurements,singlePairSpeedup=measurements['typescript']['wallMs']/measurements['rust']['wallMs'],fullJobOutputParity=True,batchAndSegmentParity=True,sourceInputBinaryChecksPassed=True,loadFinish=os.getloadavg())
    (directory/'measurements.json').write_text(json.dumps(report,indent=2))
    print(f'Boundary check passed: {report["singlePairSpeedup"]:.3f}x in this single timing pair',flush=True)

if __name__=='__main__':main()
