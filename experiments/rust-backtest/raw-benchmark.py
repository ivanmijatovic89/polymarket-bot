"""Compare native and production replay with original daily feeds inside timing."""
import argparse
import hashlib
import json
import os
import platform
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from benchmark import HERE, command, execute, fingerprint, summary
from scaling import chunks_for, run_workers, load_reference_trace
from compare import compare


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024*1024), b''):
            digest.update(block)
    return digest.hexdigest()


def raw_fingerprint(manifest):
    for item in manifest['rawInputFiles']:
        if sha(item['path']) != item['sha256']:
            raise RuntimeError(f'Original daily feed changed: {item["path"]}')


def source_fingerprint():
    root = HERE.parent.parent
    paths = sorted(list((root/'src').rglob('*.ts')) +
                   list((HERE/'src').glob('*.rs')) + list(HERE.glob('*.mts')) +
                   list(HERE.glob('*.py')) + [HERE/'Cargo.toml', HERE/'Cargo.lock',
                   root/'package.json', root/'package-lock.json'])
    return {str(p.relative_to(root)): sha(p) for p in paths}


def verify_feed_series(chunks, directory, node):
    def run(item):
        index, chunk = item
        output = directory/f'feed-parity-{index}.json'
        execute(command('rust', chunk, output, 'verify-feeds', node),
                f'feed-parity-{index}', directory)
        result = json.loads(output.read_text())
        if not result['exactSeriesParity'] or result['manifestSha256'] != sha(chunk):
            raise RuntimeError('Invalid raw feed verification output')
        return result
    with ThreadPoolExecutor(max_workers=len(chunks)) as pool:
        results = list(pool.map(run, enumerate(chunks)))
    return {key: sum(result[key] for result in results)
            for key in ['marketCount', 'binanceRows', 'chainlinkRows']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--reference-results', type=Path, required=True)
    parser.add_argument('--node', required=True)
    parser.add_argument('--results', type=Path, default=HERE/'results/june-1000-raw')
    parser.add_argument('--workers', type=int, nargs='+', default=[4, 8])
    parser.add_argument('--trace-workers', type=int, default=8)
    parser.add_argument('--rounds', type=int, default=1)
    args = parser.parse_args()
    if args.rounds < 1 or args.trace_workers < 1 or any(w < 1 for w in args.workers):
        parser.error('Positive rounds and worker counts required')
    node_version = subprocess.check_output([args.node, '--version'], text=True).strip()
    if not node_version.startswith('v20.'):
        raise RuntimeError('Node 20 required')
    os.nice(10)
    os.environ['BENCHMARK_PROGRESS_EVERY'] = '25'
    manifest = json.loads(args.manifest.read_text())
    reference_path = Path(manifest['referenceManifestPath'])
    if sha(reference_path) != manifest['referenceManifestSha256']:
        raise RuntimeError('Reference manifest changed')
    reference = json.loads(reference_path.read_text())
    if [{k: v for k, v in m.items() if k != 'rawFeeds'} for m in manifest['markets']] != reference['markets']:
        raise RuntimeError('Raw sample differs from the original selected markets')
    for key in ['settings', 'params', 'strategy', 'artifactSha256']:
        if manifest[key] != reference[key]:
            raise RuntimeError(f'Raw configuration differs: {key}')
    if max(args.workers + [args.trace_workers]) > len(manifest['markets']):
        raise RuntimeError('Worker count exceeds market count')
    settings = manifest['rawInputSettings']
    for name, value in {
        'BACKTEST_BINANCE_FEED_LOOKBACK_MS': settings['binanceLookbackMs'],
        'BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS': settings['chainlinkLookbackMs'],
        'BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS': settings['chainlinkMaxGapMs'],
    }.items():
        os.environ[name] = str(value)
    directory = args.results.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    fingerprint(reference)
    raw_fingerprint(manifest)
    sources = source_fingerprint()
    binary_sha = sha(HERE/'target/release/rust-backtest-experiment')
    ref_chunks = [args.reference_results/f'8-workers-{i}-manifest.json' for i in range(8)]
    expected = load_reference_trace(ref_chunks, args.reference_results, reference_path, node_version)
    slugs = [m['slug'] for m in manifest['markets']]
    if set(expected) != set(slugs):
        raise RuntimeError('Reference trace coverage differs')
    report = {
        'dateUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'machine': platform.platform(), 'hardware': {'cpu': 'Apple M1 Pro', 'cpuCores': 10, 'memoryGiB': 16, 'hosts': 1},
        'loadStart': os.getloadavg(), 'nice': 10, 'node': node_version,
        'rust': subprocess.check_output(['rustc', '--version'], text=True).strip(),
        'engineCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=HERE, text=True).strip(),
        'manifestSha256': sha(args.manifest), 'referenceManifestSha256': sha(reference_path),
        'referenceProvenanceSha256': sha(args.reference_results/'typescript-trace-provenance.json'),
        'sourceFingerprintSha256': hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest(),
        'experimentSourceSha256': {k: v for k, v in sources.items() if k.startswith('experiments/rust-backtest/')},
        'releaseBinarySha256': binary_sha, 'artifactSha256': manifest['artifactSha256'],
        'sourceRunId': manifest['runId'], 'settings': manifest['settings'], 'rawInputSettings': settings,
        'marketCount': len(slugs), 'firstSlug': slugs[0], 'lastSlug': slugs[-1],
        'rawFeedFiles': [{'file': Path(f['path']).name, 'kind': f['kind'], 'bytes': f['bytes'], 'sha256': f['sha256']} for f in manifest['rawInputFiles']],
        'roundsPerConfiguration': args.rounds, 'traceWorkers': args.trace_workers,
        'warmup': 'Feed verification and native full-trace replay read all inputs before timing. No extra workload warm-ups. Host not isolated from background work.',
        'scope': 'Original market and daily Binance/Chainlink Parquet reads, seed/range extraction and ordering, outage check, ticks, strategy, FOK execution, portfolio and per-market stats. Prepared feed JSON used only for untimed verification. No fleet/network/queue/DB output or batch aggregation.',
        'measurements': {}, 'completed': False, 'stage': 'feed-series-verification',
    }
    def save():
        report['loadCurrent'] = os.getloadavg()
        (directory/'raw-scaling.json').write_text(json.dumps(report, indent=2)+'\n')
    save()
    chunks = chunks_for(manifest, args.trace_workers, directory)
    print('Verifying exact native raw-feed series against production-loader reference for every market', flush=True)
    report['feedParity'] = verify_feed_series(chunks, directory, args.node)
    if report['feedParity']['marketCount'] != len(slugs):
        raise RuntimeError('Feed verification coverage differs')
    report['feedParity']['exactSeriesParity'] = True
    report['stage'] = 'native-full-trace'
    save()
    print('Exact raw feed series parity passed for all markets; starting full native replay traces', flush=True)
    native, _ = run_workers('rust', chunks, 'trace-rust-raw', directory, args.node, 'trace')
    if set(native) != set(slugs):
        raise RuntimeError('Native trace coverage differs')
    compare([expected[s] for s in slugs], [native[s] for s in slugs])
    report['parity'] = {'fullTrace': True, 'reference': 'Previously verified unchanged TypeScript full traces; native raw series also matched production-loader series exactly for every market',
                        'events': sum(expected[s]['eventsProcessed'] for s in slugs),
                        'decisions': sum(len(expected[s]['decisions']) for s in slugs),
                        'accountEvents': sum(len(expected[s]['events']) for s in slugs), 'numericTolerance': 1e-10}
    report['stage'] = 'timings'
    save()
    print('Full native raw replay trace parity passed; starting equal-worker original-file timings', flush=True)
    keys = ['slug', 'eventsProcessed', 'eventsByType', 'stats']
    target = [{k: expected[s][k] for k in keys} for s in slugs]
    for workers in args.workers:
        chunks = chunks_for(manifest, workers, directory)
        samples = {'typescript-production': [], 'rust': []}
        report['measurements'][str(workers)] = {}
        for iteration in range(args.rounds):
            order = ['typescript-production', 'rust']
            if (args.workers.index(workers)+iteration)%2:
                order.reverse()
            for engine in order:
                label = f'{workers}-workers-{engine}-raw-{iteration+1}'
                print(f'Starting {label}', flush=True)
                got, measured = run_workers(engine, chunks, label, directory, args.node, 'no-trace')
                if set(got) != set(slugs):
                    raise RuntimeError('Timed sample coverage differs')
                compare(target, [{k: got[s][k] for k in keys} for s in slugs])
                samples[engine].append(measured)
                report['measurements'][str(workers)][engine] = {'samples': samples[engine], 'summary': summary(samples[engine])}
                save()
                print(f'{label}: {measured["wallMs"]/1000:.3f} s, all market stats matched', flush=True)
    fingerprint(reference)
    raw_fingerprint(manifest)
    if sources != source_fingerprint() or binary_sha != sha(HERE/'target/release/rust-backtest-experiment'):
        raise RuntimeError('Measured source or binary changed during timing')
    load_reference_trace(ref_chunks, args.reference_results, reference_path, node_version)
    report['completed'] = True
    report['stage'] = 'complete'
    report['finalInputSourceBinaryChecksPassed'] = True
    save()
    for workers, measurement in report['measurements'].items():
        ts = measurement['typescript-production']['summary']['wallMs']['median']/1000
        rust = measurement['rust']['summary']['wallMs']['median']/1000
        print(f'{workers} workers, original files: TypeScript={ts:.3f}s Rust={rust:.3f}s ratio={ts/rust:.2f}x', flush=True)


if __name__ == '__main__':
    main()
