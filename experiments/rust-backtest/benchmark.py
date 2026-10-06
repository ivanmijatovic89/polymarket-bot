"""Run trace parity gates, then alternate isolated processes for fair warm-cache timing."""
import argparse
import hashlib
import json
import os
import platform
import statistics
import subprocess
import sys
import time
from pathlib import Path
from compare import compare, normalized

HERE = Path(__file__).resolve().parent


def execute(command, label, directory):
    log_path = directory / f'{label}.log'
    begin = time.perf_counter()
    with log_path.open('wb') as log:
        process = subprocess.Popen(command, cwd=HERE.parent.parent, stdout=log, stderr=log)
        _, status, usage = os.wait4(process.pid, 0)
        process.returncode = os.waitstatus_to_exitcode(status)
    if process.returncode:
        raise RuntimeError(f'{label} failed: {log_path.read_text()}')
    # macOS reports ru_maxrss in bytes; Linux reports KiB.
    rss = usage.ru_maxrss if sys.platform == 'darwin' else usage.ru_maxrss * 1024
    return {'wallMs': (time.perf_counter()-begin)*1000, 'cpuMs': (usage.ru_utime+usage.ru_stime)*1000,
            'peakRssBytes': rss}


def fingerprint(manifest):
    for market in manifest['markets']:
        for key, sha in [('filePath', 'marketSha256'), ('feeds', 'feedSha256')]:
            digest = hashlib.sha256()
            with open(market[key], 'rb') as source:
                for block in iter(lambda: source.read(1024*1024), b''):
                    digest.update(block)
            if digest.hexdigest() != market[sha]:
                raise RuntimeError(f'Input changed: {market[key]}')


def command(engine, manifest, out, trace, node, index=None):
    if engine.startswith('typescript'):
        mode = 'production' if engine == 'typescript-production' else 'prepared'
        cmd = [node, '--import', 'tsx', str(HERE/'oracle.mts'), str(manifest), str(out), mode, trace]
    else:
        cmd = [str(HERE/'target/release/rust-backtest-experiment'), str(manifest), str(out), trace]
    if index is not None:
        cmd.append(str(index))
    return cmd


def summary(samples):
    return {metric: {'median': statistics.median(s[metric] for s in samples),
                     'min': min(s[metric] for s in samples), 'max': max(s[metric] for s in samples)}
            for metric in ['wallMs', 'cpuMs', 'peakRssBytes']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, default=HERE/'fixtures/manifest.json')
    parser.add_argument('--node', required=True)
    parser.add_argument('--rounds', type=int, default=3)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--skip-traces', action='store_true')
    parser.add_argument('--production', action='store_true')
    args = parser.parse_args()
    if args.rounds < 3 or args.workers < 1:
        parser.error('Use at least 3 timing rounds and at least 1 worker')
    node_version = subprocess.check_output([args.node, '--version'], text=True).strip()
    if not node_version.startswith('v20.'):
        raise RuntimeError('Benchmark requires Node 20')
    os.nice(10)
    load_start = os.getloadavg()
    manifest = json.loads(args.manifest.read_text())
    fingerprint(manifest)
    results = HERE/'results'
    results.mkdir(exist_ok=True)
    # Trace parity is mandatory even when reusing previous traces.
    for engine in ['typescript', 'rust']:
        out = results / f'{engine}-trace.json'
        if not args.skip_traces:
            print(f'Verifying {engine} trace...', flush=True)
            execute(command(engine, args.manifest, out, 'trace', args.node), f'{engine}-trace', results)
        if not out.exists():
            raise RuntimeError(f'Missing trace gate: {out}')
    oracle = json.loads((results/'typescript-trace.json').read_text())
    native = json.loads((results/'rust-trace.json').read_text())
    expected_manifest_sha = hashlib.sha256(args.manifest.read_bytes()).hexdigest()
    if any(d.get('manifestSha256') != expected_manifest_sha or not d.get('trace') for d in [oracle, native]):
        raise RuntimeError('Stale or invalid trace inputs; rerun without --skip-traces')
    compare(normalized(oracle), normalized(native))
    expected = oracle['results']
    if [m['slug'] for m in manifest['markets']] != [r['slug'] for r in expected]:
        raise RuntimeError('Trace input set differs from manifest')
    print(f'Full trace parity passed: {len(expected)} markets', flush=True)
    measurements = {}
    engines = ['typescript', 'rust'] + (['typescript-production'] if args.production else [])
    for workload, index in [('single', 0), ('batch-sequential', None)]:
        samples = {e: [] for e in engines}
        for iteration in range(args.rounds+1):
            order = engines if iteration % 2 == 0 else list(reversed(engines))
            for engine in order:
                label = f'{workload}-{engine}-{iteration}'
                out = results/f'{label}.json'
                measured = execute(command(engine, args.manifest, out, 'no-trace', args.node, index), label, results)
                got = json.loads(out.read_text())
                target = expected if index is None else [expected[index]]
                compare([{k:r[k] for k in ['slug','eventsProcessed','eventsByType','stats']} for r in target], normalized(got))
                measured['replayMs'] = got['durationMs']
                if iteration:
                    samples[engine].append(measured)
                print(f'{label}: {measured["wallMs"]:.1f} ms' + (' (warm-up)' if not iteration else ''), flush=True)
        measurements[workload] = {e: {'samples': v, 'summary': summary(v)} for e,v in samples.items()}
    # Persistent worker equivalent: each process handles a chunk of markets sequentially.
    workers = min(args.workers, len(expected))
    chunks = []
    for i in range(workers):
        chunk = dict(manifest, markets=manifest['markets'][i::workers])
        filename = results / f'worker-{i}-manifest.json'
        filename.write_text(json.dumps(chunk))
        chunks.append(filename)
    samples = {e: [] for e in ['typescript', 'rust']}
    for iteration in range(args.rounds+1):
        for engine in (['typescript','rust'] if iteration % 2 == 0 else ['rust','typescript']):
            start = time.perf_counter()
            processes = []
            for i, chunk in enumerate(chunks):
                label = f'batch-parallel-{engine}-{iteration}-{i}'
                out = results / f'{label}.json'
                log = (results/f'{label}.log').open('wb')
                process = subprocess.Popen(command(engine, chunk, out, 'no-trace', args.node), cwd=HERE.parent.parent, stdout=log, stderr=log)
                processes.append((process, out, log))
            cpu = 0
            rss = 0
            merged = {}
            try:
                for process, out, log in processes:
                    _, status, usage = os.wait4(process.pid, 0)
                    process.returncode = os.waitstatus_to_exitcode(status)
                    log.close()
                    if process.returncode:
                        raise RuntimeError(f'Parallel worker failed: {out.with_suffix(".log").read_text()}')
                    cpu += (usage.ru_utime+usage.ru_stime)*1000
                    rss += usage.ru_maxrss if sys.platform == 'darwin' else usage.ru_maxrss*1024
                    for r in json.loads(out.read_text())['results']:
                        if r['slug'] in merged:
                            raise RuntimeError('Duplicate market output')
                        merged[r['slug']] = r
            finally:
                for process, _, log in processes:
                    if process.returncode is None:
                        process.terminate()
                        process.wait()
                    log.close()
            compare([{k:r[k] for k in ['slug','eventsProcessed','eventsByType','stats']} for r in expected],
                    [{k:v for k,v in merged[r['slug']].items() if k!='durationMs'} for r in expected])
            measured = {'wallMs':(time.perf_counter()-start)*1000, 'cpuMs':cpu, 'peakRssBytes':rss}
            if iteration:
                samples[engine].append(measured)
            print(f'parallel-{engine}-{iteration}: {measured["wallMs"]:.1f} ms', flush=True)
    measurements['batch-parallel'] = {e: {'samples':v,'summary':summary(v)} for e,v in samples.items()}
    fingerprint(manifest)
    report = {'machine':platform.platform(), 'loadStart':load_start, 'loadEnd':os.getloadavg(), 'nice':10, 'node':node_version, 'rust':subprocess.check_output(['rustc','--version'],text=True).strip(),
              'engineCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=HERE,text=True).strip(),
              'marketCount':len(expected),'ticks':sum(r['eventsProcessed'] for r in expected),'workers':workers,
              'artifactSha256':manifest['artifactSha256'],'sourceRunId':manifest['runId'],'settings':manifest['settings'],
              'parity':{'tickAndFeedDigests':True,'decisions':sum(len(r['decisions']) for r in expected),'accountEvents':sum(len(r['events']) for r in expected),
                        'numericTolerance':1e-10,'traceDisabledForTiming':True},'measurements':measurements,
              'scope':'Prepared-feed comparison includes market Parquet decoding, ordered real/synthetic ticks, strategy, FOK execution, portfolio and per-market stats. Raw daily-feed extraction, queue/DB/network/fleet overhead are excluded. Optional production baseline includes the production feed loaders. Parallel RSS is sum of worker peaks, not measured simultaneous peak.'}
    (results/'benchmark.json').write_text(json.dumps(report,indent=2))
    for workload in measurements:
        base = measurements[workload]['typescript']['summary']['wallMs']['median']
        rust = measurements[workload]['rust']['summary']['wallMs']['median']
        print(f'{workload}: {base/rust:.2f}x wall-clock speedup', flush=True)


if __name__ == '__main__':
    main()
