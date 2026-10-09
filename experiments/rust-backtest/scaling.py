"""Verify a large fixed sample, then measure equal worker counts for both engines."""
import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
import time
from pathlib import Path
from benchmark import HERE, command, fingerprint, summary
from compare import compare, normalized


def chunks_for(manifest, workers, directory):
    chunks = []
    for index in range(workers):
        document = dict(manifest, markets=manifest['markets'][index::workers])
        filename = directory / f'{workers}-workers-{index}-manifest.json'
        filename.write_text(json.dumps(document))
        chunks.append(filename)
    return chunks


def run_workers(engine, chunks, label, directory, node, trace):
    started = time.perf_counter()
    processes = []
    merged = {}
    cpu = 0
    rss = 0
    try:
        for index, chunk in enumerate(chunks):
            output = directory / f'{label}-{index}.json'
            log_path = directory / f'{label}-{index}.log'
            log = log_path.open('wb')
            process = subprocess.Popen(command(engine, chunk, output, trace, node),
                                       cwd=HERE.parent.parent, stdout=log, stderr=log)
            processes.append((process, output, log_path, log, chunk))
        for process, output, log_path, log, chunk in processes:
            _, status, usage = os.wait4(process.pid, 0)
            process.returncode = os.waitstatus_to_exitcode(status)
            log.close()
            if process.returncode:
                raise RuntimeError(f'{label} failed: {log_path.read_text()}')
            cpu += (usage.ru_utime + usage.ru_stime) * 1000
            rss += usage.ru_maxrss if sys.platform == 'darwin' else usage.ru_maxrss * 1024
            document = json.loads(output.read_text())
            if document['manifestSha256'] != hashlib.sha256(chunk.read_bytes()).hexdigest():
                raise RuntimeError('Output manifest hash differs from worker input')
            if document['trace'] != (trace == 'trace'):
                raise RuntimeError('Output trace mode differs from requested mode')
            for result in normalized(document):
                if result['slug'] in merged:
                    raise RuntimeError(f'Duplicate market: {result["slug"]}')
                merged[result['slug']] = result
        return merged, {'wallMs': (time.perf_counter()-started)*1000,
                        'cpuMs': cpu, 'peakRssBytes': rss}
    finally:
        for process, _, _, log, _ in processes:
            if process.returncode is None:
                process.terminate()
                process.wait()
            log.close()


def load_reference_trace(chunks, directory, manifest_path, node_version):
    previous = json.loads((directory/'typescript-trace-provenance.json').read_text())
    if (previous['manifestSha256'] != hashlib.sha256(manifest_path.read_bytes()).hexdigest()
            or previous['node'] != node_version):
        raise RuntimeError('Cached reference inputs or runtime changed')
    for relative, expected in previous['sourceSha256'].items():
        if hashlib.sha256((HERE.parent.parent/relative).read_bytes()).hexdigest() != expected:
            raise RuntimeError(f'Reference source changed: {relative}')
    merged = {}
    for index, chunk in enumerate(chunks):
        output = directory / f'trace-typescript-{index}.json'
        if previous['outputsSha256'].get(output.name) != hashlib.sha256(output.read_bytes()).hexdigest():
            raise RuntimeError(f'Reference output changed: {output.name}')
        document = json.loads(output.read_text())
        if (document.get('manifestSha256') != hashlib.sha256(chunk.read_bytes()).hexdigest()
                or not document.get('trace') or document.get('mode') != 'prepared'
                or document.get('node') != node_version or document.get('engine') != 'typescript'):
            raise RuntimeError(f'Stale reference trace: {output.name}')
        for record in normalized(document):
            if record['slug'] in merged:
                raise RuntimeError('Duplicate reference market')
            merged[record['slug']] = record
    return merged


def save_reference_provenance(chunks, directory, manifest_path, node_version):
    root = HERE.parent.parent
    sources = sorted(list((root/'src').rglob('*.ts')) +
                     [HERE/'common.mts', HERE/'oracle.mts', root/'package.json', root/'package-lock.json'])
    metadata = {'manifestSha256': hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
                'node': node_version,
                'sourceSha256': {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
                'outputsSha256': {f'trace-typescript-{i}.json': hashlib.sha256((directory/f'trace-typescript-{i}.json').read_bytes()).hexdigest() for i in range(len(chunks))}}
    (directory/'typescript-trace-provenance.json').write_text(json.dumps(metadata, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--node', required=True)
    parser.add_argument('--results', type=Path, default=HERE/'results/june-1000')
    parser.add_argument('--workers', type=int, nargs='+', default=[1, 4, 8])
    parser.add_argument('--rounds', type=int, default=1)
    parser.add_argument('--trace-workers', type=int, default=4)
    parser.add_argument('--production-workers', type=int)
    parser.add_argument('--reuse-typescript-traces', action='store_true')
    args = parser.parse_args()
    if args.rounds < 1 or args.trace_workers < 1 or any(w < 1 for w in args.workers):
        parser.error('Positive rounds and worker counts required')
    node_version = subprocess.check_output([args.node, '--version'], text=True).strip()
    if not node_version.startswith('v20.'):
        raise RuntimeError('Node 20 required')
    os.nice(10)
    os.environ['BENCHMARK_PROGRESS_EVERY'] = '25'
    manifest = json.loads(args.manifest.read_text())
    if max(args.workers + [args.trace_workers, args.production_workers or 1]) > len(manifest['markets']):
        raise RuntimeError('Worker count exceeds market count')
    directory = args.results.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    fingerprint(manifest)
    load_start = os.getloadavg()
    print(f'Verifying full traces for {len(manifest["markets"])} markets with {args.trace_workers} workers per engine', flush=True)
    chunks = chunks_for(manifest, args.trace_workers, directory)
    if args.reuse_typescript_traces:
        expected = load_reference_trace(chunks, directory, args.manifest, node_version)
        print('Reused TypeScript traces after input, source and output hash checks', flush=True)
    else:
        expected, _ = run_workers('typescript', chunks, 'trace-typescript', directory, args.node, 'trace')
        save_reference_provenance(chunks, directory, args.manifest, node_version)
    native, _ = run_workers('rust', chunks, 'trace-rust', directory, args.node, 'trace')
    slugs = [m['slug'] for m in manifest['markets']]
    if set(expected) != set(slugs) or set(native) != set(slugs):
        raise RuntimeError('Trace coverage differs from selected markets')
    compare([expected[s] for s in slugs], [native[s] for s in slugs])
    print('Full trace parity passed for all selected markets', flush=True)
    keys = ['slug', 'eventsProcessed', 'eventsByType', 'stats']
    target = [{k: expected[s][k] for k in keys} for s in slugs]
    report = {
        'dateUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'machine': platform.platform(), 'loadStart': load_start, 'nice': 10,
        'node': node_version, 'rust': subprocess.check_output(['rustc', '--version'], text=True).strip(),
        'engineCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=HERE, text=True).strip(),
        'manifestSha256': hashlib.sha256(args.manifest.read_bytes()).hexdigest(),
        'artifactSha256': manifest['artifactSha256'], 'settings': manifest['settings'],
        'selection': manifest.get('selection'), 'marketCount': len(slugs),
        'firstSlug': slugs[0], 'lastSlug': slugs[-1],
        'parity': {'fullTrace': True, 'events': sum(expected[s]['eventsProcessed'] for s in slugs),
                   'decisions': sum(len(expected[s]['decisions']) for s in slugs),
                   'accountEvents': sum(len(expected[s]['events']) for s in slugs), 'numericTolerance': 1e-10},
        'measurements': {}, 'scope': 'Prepared-feed local replay. Market Parquet decoding, strategy, FOK, portfolio and per-market stats included. No fleet, queue/network/DB output or native daily-feed loading. Worker counts limit processes, not CPU affinity or background threads. RSS is sum of worker peaks.',
        'traceWorkers': args.trace_workers, 'reusedTypeScriptTraces': args.reuse_typescript_traces,
        'warmup': 'Full trace passes read all sample inputs before timing; no separate timed-workload warmups.',
        'sourceSha256': {str(p.relative_to(HERE)): hashlib.sha256(p.read_bytes()).hexdigest()
                         for p in sorted(list((HERE/'src').glob('*.rs')) + list(HERE.glob('*.mts')) + [HERE/'scaling.py'])},
        'releaseBinarySha256': hashlib.sha256((HERE/'target/release/rust-backtest-experiment').read_bytes()).hexdigest(),
    }
    def save():
        report['loadCurrent'] = os.getloadavg()
        (directory/'scaling.json').write_text(json.dumps(report, indent=2)+'\n')
    save()
    for workers in args.workers:
        chunks = chunks_for(manifest, workers, directory)
        samples = {'typescript': [], 'rust': []}
        report['measurements'][str(workers)] = {}
        for iteration in range(args.rounds):
            # Reverse engine order for alternating configurations and repetitions.
            order = ['typescript', 'rust'] if (args.workers.index(workers)+iteration)%2 == 0 else ['rust', 'typescript']
            for engine in order:
                label = f'{workers}-workers-{engine}-{iteration+1}'
                print(f'Starting {label}', flush=True)
                got, measured = run_workers(engine, chunks, label, directory, args.node, 'no-trace')
                if set(got) != set(slugs):
                    raise RuntimeError('Timed run market coverage differs')
                compare(target, [{k: got[s][k] for k in keys} for s in slugs])
                samples[engine].append(measured)
                report['measurements'][str(workers)][engine] = {'samples': samples[engine], 'summary': summary(samples[engine])}
                save()
                print(f'{label}: {measured["wallMs"]/1000:.3f} s, all market stats matched', flush=True)
    if args.production_workers:
        workers = args.production_workers
        chunks = chunks_for(manifest, workers, directory)
        print(f'Starting production TypeScript baseline with {workers} workers', flush=True)
        got, measured = run_workers('typescript-production', chunks, f'{workers}-workers-production', directory, args.node, 'no-trace')
        if set(got) != set(slugs):
            raise RuntimeError('Production run market coverage differs')
        compare(target, [{k: got[s][k] for k in keys} for s in slugs])
        report['productionBaseline'] = {'workers': workers, 'samples': [measured],
                                         'scope': 'Unmodified production replay including raw daily-feed loaders; Rust comparison uses prepared feeds.'}
        save()
        print(f'Production TypeScript: {measured["wallMs"]/1000:.3f} s, all market stats matched', flush=True)
    fingerprint(manifest)
    report['completed'] = True
    save()
    for workers, measurement in report['measurements'].items():
        ts = measurement['typescript']['summary']['wallMs']['median']
        rust = measurement['rust']['summary']['wallMs']['median']
        print(f'{workers} workers: TypeScript={ts/1000:.3f}s Rust={rust/1000:.3f}s ratio={ts/rust:.2f}x', flush=True)


if __name__ == '__main__':
    main()
