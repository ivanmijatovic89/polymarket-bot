import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildNative, engineIdentity, loadPackage, readToolchain } from './builder.js'
import { autoPublishNativeStrategyFile } from './cli.js'
import { syncLock } from './syncLock.js'
import { ENGINE_ROOT, makeHostContext } from './host.js'
import type { BuildManifest } from './manifest.js'
import { publishNativeLocalOnly, runNativeCheck } from './pipeline.js'
import { computeSourceHash, sha256Hex } from './sourceHash.js'

// End-to-end runs of the real toolchain on the std-only proof package of
// scripts/native/build-proof-package.sh. They need macOS on Apple Silicon
// with the pinned toolchain and the Xcode tools, so they are skipped
// elsewhere (Linux CI). The local cache and target directories are temporary.
const hasToolchain =
  process.platform === 'darwin' &&
  process.arch === 'arm64' &&
  spawnSync('cargo', ['-V']).status === 0 &&
  spawnSync('codesign', ['-h']).error === undefined
const skip = hasToolchain ? false : 'needs aarch64-apple-darwin with cargo and codesign'

function proofPackage(root: string): string {
  const r = spawnSync(path.join(ENGINE_ROOT, 'scripts/native/build-proof-package.sh'), [root], {
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stderr)
  return path.join(root, 'strategies')
}

const quiet = (): void => {}

// spec: 31 §4.3, §5.1, D17 — identical bytes from two package locations and two
// target directories of different path lengths; 31 §6.1 cache layout; 31 §5.4 manifest.
test('local-only publish is reproducible across package and target paths', { skip }, () => {
  const work = mkdtempSync(path.join('/private/tmp', 'pmb-native-e2e-'))
  try {
    const a = proofPackage(path.join(work, 'a'))
    const b = proofPackage(path.join(work, 'b', 'deeper', 'nested'))
    const cacheDir = path.join(work, 'cache')
    const common = {
      bin: 'builder-proof',
      allowDirty: false,
      skipChecks: false,
      parityCheck: false,
      cacheDir,
      log: quiet,
    }
    const [ra] = publishNativeLocalOnly({
      ...common,
      packageDir: a,
      targetDir: path.join(work, 't1'),
    })
    const [rb] = publishNativeLocalOnly({
      ...common,
      packageDir: b,
      targetDir: path.join(work, 'b', 'a-much-longer-target-directory'),
    })
    assert.ok(ra && rb)
    assert.equal(ra.reusedFor, null)
    assert.equal(rb.reusedFor, null, 'the second build produced different bytes')
    assert.equal(rb.sha256, ra.sha256)
    assert.equal(rb.alreadyCached, true)
    assert.equal(ra.binaryPath, path.join(cacheDir, ra.sha256))
    const bytes = readFileSync(ra.binaryPath)
    assert.equal(sha256Hex(bytes), ra.sha256)
    const m = JSON.parse(readFileSync(ra.manifestPath, 'utf8')) as BuildManifest
    assert.equal(m.artifact.profile, 'artifact')
    assert.equal(m.artifact.strategyId, 'builder-proof.v1')
    assert.equal(computeSourceHash(m.sourceHashInput), m.sourceHash)
    // 31 §5.4: the recorded command replays the staged build, host-independently.
    const mp = m.build.command.indexOf('--manifest-path')
    assert.equal(m.build.command[mp + 1], '/tmp/pmb-stage/.pmb-package/Cargo.toml')
    assert.ok(m.pendingChecks.some((c) => c.includes("kind = 'js'")))
    assert.ok(
      !JSON.stringify(m.build).includes(os.homedir()),
      'host paths must be remapped in the manifest',
    )
    const sign = spawnSync('codesign', ['-dv', ra.binaryPath], { encoding: 'utf8' })
    assert.match(sign.stderr, /Identifier=pmb\.builder-proof\.v1/)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

// spec: 31 §4.4 step 4 — a binary embedding its package root fails the build.
// Cargo sees the package under the fixed staging root (stage.ts), so
// CARGO_MANIFEST_DIR is the staged path, never the host path; the gate
// catches the unremapped staging root.
test('the path-leak gate fails a binary that embeds its package root', { skip }, () => {
  const work = mkdtempSync(path.join('/private/tmp', 'pmb-native-e2e-'))
  try {
    const pkg = proofPackage(path.join(work, 'leak'))
    const lib = path.join(pkg, 'src', 'lib.rs')
    writeFileSync(
      lib,
      `${readFileSync(lib, 'utf8')}\n/// Leaks the package root.\npub const ROOT: &str = env!("CARGO_MANIFEST_DIR");\n`,
    )
    const bin = path.join(pkg, 'src', 'bin', 'builder-proof.rs')
    // Print the root from selftest, so describe (and the id) stay valid and
    // the build reaches the path-leak gate.
    const src = readFileSync(bin, 'utf8')
    const selftest = 'println!("{{\\"type\\":\\"selftest\\",\\"ok\\":true,\\"checks\\":[]}}")'
    assert.ok(src.includes(selftest))
    writeFileSync(
      bin,
      src.replace(
        selftest,
        'println!("{{\\"type\\":\\"selftest\\",\\"ok\\":true,\\"checks\\":[],\\"root\\":\\"{}\\"}}", proof_strategies::ROOT)',
      ),
    )
    assert.throws(
      () =>
        publishNativeLocalOnly({
          packageDir: pkg,
          bin: 'builder-proof',
          allowDirty: true,
          skipChecks: true,
          parityCheck: false,
          cacheDir: path.join(work, 'cache'),
          targetDir: path.join(work, 't'),
          log: quiet,
        }),
      /path-leak gate failed[\s\S]*\/tmp\/pmb-stage/,
    )
    assert.equal(existsSync(path.join(work, 'cache')), false)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

// spec: 31 §7.6 — CI runs gates 1-4 and 6 (gate 6 on a host build) and
// skips the canonical build and gate 7, which run on worker-1 (LG-1).
test('strategy:check --ci runs gates 1-4 and 6 on a host build', { skip }, () => {
  const work = mkdtempSync(path.join('/private/tmp', 'pmb-native-e2e-'))
  try {
    const pkg = proofPackage(path.join(work, 'p'))
    const { ok, gates } = runNativeCheck({
      packageDir: pkg,
      targetDir: path.join(work, 't'),
      ci: true,
      log: quiet,
    })
    assert.equal(ok, true, JSON.stringify(gates, null, 1))
    assert.deepEqual(
      gates.map((g) => [g.gate, g.status]),
      [
        [1, 'pass'],
        [2, 'pass'],
        [3, 'pass'],
        [4, 'pending'],
        [5, 'skipped'],
        [6, 'pass'],
        [7, 'skipped'],
      ],
    )
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

// spec: 31 §7.1 — the Rust strategy:check gates on a clean package.
test('strategy:check passes the proof package with pre-SDK pending gates', { skip }, () => {
  const work = mkdtempSync(path.join('/private/tmp', 'pmb-native-e2e-'))
  try {
    const pkg = proofPackage(path.join(work, 'p'))
    const { ok, gates } = runNativeCheck({
      packageDir: pkg,
      targetDir: path.join(work, 't'),
      log: quiet,
    })
    assert.equal(ok, true)
    assert.deepEqual(
      gates.map((g) => [g.gate, g.status]),
      [
        [1, 'pass'],
        [2, 'pass'],
        [3, 'pass'],
        [4, 'pending'],
        [5, 'pass'],
        [6, 'pass'],
        [7, 'pending'],
      ],
    )
    // Gate 2 fails on unformatted code; gate 1 on a forbidden section.
    writeFileSync(path.join(pkg, 'src', 'lib.rs'), 'pub const ID: &str="builder-proof.v1";\n')
    const manifest = path.join(pkg, 'Cargo.toml')
    writeFileSync(manifest, `${readFileSync(manifest, 'utf8')}\n[profile.release]\nlto = false\n`)
    const bad = runNativeCheck({ packageDir: pkg, targetDir: path.join(work, 't'), log: quiet })
    assert.equal(bad.ok, false)
    assert.equal(bad.gates.find((g) => g.gate === 1)?.status, 'fail')
    assert.equal(bad.gates.find((g) => g.gate === 2)?.status, 'fail')
    assert.equal(bad.gates.find((g) => g.gate === 5)?.status, 'skipped')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

function sh(cwd: string, cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}: ${r.stderr}`)
}

function put(root: string, rel: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), text)
}

function commitAll(dir: string): void {
  sh(dir, 'git', ['init', '-q'])
  sh(dir, 'git', ['add', '-A'])
  sh(dir, 'git', [
    '-c',
    'user.name=e2e',
    '-c',
    'user.email=e2e@localhost',
    'commit',
    '-q',
    '-m',
    'e2e',
  ])
}

const PROBE_BIN = '//! Probe strategy.\npmb_sdk::strategy_main!("stage-probe.v1");\n'

// pmb-sdk stand-in: strategy_main! expands to a main that answers describe
// and selftest; the TypeId and file!() expose the crate's -C metadata and the
// source path rustc saw.
const PROBE_SDK = String.raw`pub struct Marker;
pub fn marker() -> String { format!("{:?}", core::any::TypeId::of::<Marker>()) }
pub fn file() -> &'static str { file!() }
pub fn run(id: &str, profile: &str) {
    match std::env::args().nth(1).as_deref() {
        Some("describe") => println!(
            "{{\"type\":\"describe\",\"protocolVersion\":2,\"binary\":{{\"target\":\"aarch64-apple-darwin\",\"buildProfile\":\"{}\"}},\"capabilities\":{{\"subcommands\":[\"describe\",\"selftest\"],\"realOrders\":false}},\"strategy\":{{\"id\":\"{}\"}},\"probe\":{{\"marker\":\"{}\",\"file\":\"{}\"}}}}",
            profile, id, marker(), file()
        ),
        Some("selftest") => println!("{{\"type\":\"selftest\",\"ok\":true,\"checks\":[]}}"),
        _ => std::process::exit(2),
    }
}
#[macro_export]
macro_rules! strategy_main {
    ($id:expr) => {
        fn main() {
            $crate::run($id, env!("PMB_BUILD_PROFILE"))
        }
    };
}
`

function probePackage(dir: string, sdkPath: string): void {
  put(
    dir,
    'Cargo.toml',
    `[package]\nname = "probe-strategies"\nedition = "2021"\nversion = "0.0.0"\npublish = false\n\n[workspace]\n\n[package.metadata.pmb]\nformat = 1\n\n[dependencies]\npmb-sdk = { path = "${sdkPath}" }\n\n[dev-dependencies]\npmb-sdk = { path = "${sdkPath}", features = ["testkit"] }\n\n[lints.rust]\nunsafe_code = "forbid"\n`,
  )
  put(
    dir,
    'rust-toolchain.toml',
    readFileSync(path.join(ENGINE_ROOT, 'native/rust-toolchain.toml'), 'utf8'),
  )
  put(dir, '.gitignore', 'target/\n')
  put(dir, 'src/lib.rs', '//! Probe package.\n')
  put(dir, 'src/bin/stage-probe.rs', PROBE_BIN)
  sh(dir, 'cargo', ['generate-lockfile', '--offline', '-q'])
}

/**
 * A minimal engine checkout: the real build policy and toolchain pin, and a
 * pmb-sdk stand-in whose TypeId hash and file!() expose the crate's -C
 * metadata and the path rustc saw. It inherits edition and version from the
 * engine workspace, as the engine crates do. The in-repo package sits at
 * native/strategies (31 §2.3).
 */
function fakeEngine(root: string): void {
  const e = path.join(root, 'engine')
  put(e, '.gitignore', 'target/\n')
  put(
    e,
    'native/Cargo.toml',
    '[workspace]\nresolver = "2"\nmembers = ["crates/*"]\nexclude = ["strategies"]\n\n[workspace.package]\nedition = "2021"\nversion = "0.0.0"\n',
  )
  for (const rel of [
    'native/rust-toolchain.toml',
    'native/build/artifact-build.toml',
    'native/build/dylib-allowlist.txt',
    'native/build/clippy/clippy.toml',
  ])
    put(e, rel, readFileSync(path.join(ENGINE_ROOT, rel), 'utf8'))
  put(
    e,
    'native/crates/pmb-sdk/Cargo.toml',
    '[package]\nname = "pmb-sdk"\nedition.workspace = true\nversion.workspace = true\n\n[features]\ntestkit = []\n',
  )
  put(e, 'native/crates/pmb-sdk/src/lib.rs', PROBE_SDK)
  sh(path.join(e, 'native'), 'cargo', ['generate-lockfile', '--offline', '-q'])
  probePackage(path.join(e, 'native', 'strategies'), '../crates/pmb-sdk')
  commitAll(e)
  probePackage(path.join(root, 'pkg'), '../engine/native/crates/pmb-sdk')
  commitAll(path.join(root, 'pkg'))
}

function buildProbe(engineRoot: string, packageDir: string, targetDir: string) {
  const base = makeHostContext({ rustcRelease: 'e2e', targetDir, qos: 'interactive' })
  const host = { ...base, engineRoot }
  const toolchain = readToolchain(packageDir, host.toolEnv, engineRoot)
  const loaded = loadPackage(packageDir, host)
  assert.deepEqual(loaded.rules.violations, [])
  const built = buildNative({
    loaded,
    bin: 'stage-probe',
    profile: 'artifact',
    host,
    toolchain,
    engine: engineIdentity(host),
    log: quiet,
  })
  built.cleanup()
  const probe = (built.describe as { probe: { marker: string; file: string } }).probe
  return { sha: built.sha256, id: built.strategyId, probe, engineRelPath: loaded.engineRelPath }
}

// spec: 31 §4.3, §5.1, D17 (60 DET-12) — identical sources give identical
// bytes when the ENGINE checkout moves, for a sibling package that reaches
// pmb-sdk through ../engine and for the in-repo package (../crates, with
// workspace inheritance). Cargo hashes a path dependency's absolute path into
// its -C metadata; the staging root makes that path host-independent.
test('canonical bytes do not depend on where the engine checkout lives', { skip }, () => {
  const work = mkdtempSync(path.join('/private/tmp', 'pmb-native-e2e-'))
  try {
    const h1 = path.join(work, 'h1')
    const h2 = path.join(work, 'h2-a-longer-host-path')
    fakeEngine(h1)
    cpSync(h1, h2, { recursive: true })
    const sib1 = buildProbe(path.join(h1, 'engine'), path.join(h1, 'pkg'), path.join(work, 't1'))
    const sib2 = buildProbe(path.join(h2, 'engine'), path.join(h2, 'pkg'), path.join(work, 't2'))
    assert.equal(sib1.probe.marker, sib2.probe.marker, 'TypeId depends on the engine path')
    assert.equal(sib2.sha, sib1.sha)
    assert.equal(sib1.probe.file, '/pmb/src/engine/native/crates/pmb-sdk/src/lib.rs')
    assert.equal(sib1.engineRelPath, '../engine', '31 §2.2: the recorded package-to-engine path')
    const inRepo = (h: string, t: string) =>
      buildProbe(
        path.join(h, 'engine'),
        path.join(h, 'engine/native/strategies'),
        path.join(work, t),
      )
    const in1 = inRepo(h1, 't3')
    const in2 = inRepo(h2, 't4')
    assert.equal(in2.sha, in1.sha)
    assert.equal(in1.probe.file, '/pmb/src/crates/pmb-sdk/src/lib.rs')
    assert.equal(in1.engineRelPath, '../..')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

/** Set every file's mtime under `dir` (except .git) to `when`. */
function ageTree(dir: string, when: Date): void {
  const r = spawnSync('find', [dir, '-path', '*/.git', '-prune', '-o', '-type', 'f', '-print0'], {
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stderr)
  for (const f of r.stdout.split('\0').filter((x) => x !== '')) utimesSync(f, when, when)
}

// spec: 31 §4.5 (one shared target directory per host), §5.1 — a build in the
// shared target directory never reuses outputs compiled from another checkout
// of the same package, even when that checkout's files are older than the
// earlier outputs (cargo's freshness check is mtime-based, and a package's
// own paths are relative to its root, so two checkouts share one unit).
test("the shared target directory never serves another checkout's outputs", { skip }, () => {
  const work = mkdtempSync(path.join('/private/tmp', 'pmb-native-e2e-'))
  try {
    const h1 = path.join(work, 'h1')
    fakeEngine(h1)
    const pkg2 = path.join(h1, 'pkg-second-checkout')
    cpSync(path.join(h1, 'pkg'), pkg2, { recursive: true })
    const bin2 = path.join(pkg2, 'src/bin/stage-probe.rs')
    writeFileSync(bin2, readFileSync(bin2, 'utf8').replace('stage-probe.v1', 'stage-probe.v2'))
    sh(pkg2, 'git', [
      '-c',
      'user.name=e2e',
      '-c',
      'user.email=e2e@localhost',
      'commit',
      '-q',
      '-am',
      'v2',
    ])
    ageTree(pkg2, new Date(Date.now() - 3600_000))
    const t = path.join(work, 'shared-target')
    const a = buildProbe(path.join(h1, 'engine'), path.join(h1, 'pkg'), t)
    const b = buildProbe(path.join(h1, 'engine'), pkg2, t)
    assert.equal(a.id, 'stage-probe.v1')
    assert.equal(b.id, 'stage-probe.v2', 'stale outputs from the other checkout')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

// spec: 31 §7.2, §7.5 — `--strategy-file <pkg>/src/bin/<name>.rs` auto-publishes
// local-only with skip-checks semantics (gate 2 skipped) and allow-dirty.
test('a .rs strategy file auto-publishes local-only, dirty and unformatted', { skip }, async () => {
  const work = mkdtempSync(path.join('/private/tmp', 'pmb-native-e2e-'))
  try {
    const pkg = proofPackage(path.join(work, 'p'))
    // Unformatted (gate 2 would fail) and uncommitted (dirty).
    writeFileSync(path.join(pkg, 'src', 'lib.rs'), 'pub const ID: &str="builder-proof.v1";\n')
    const r = await autoPublishNativeStrategyFile(path.join(pkg, 'src/bin/builder-proof.rs'), {
      targetDir: path.join(work, 't'),
      cacheDir: path.join(work, 'cache'),
      log: quiet,
    })
    assert.equal(r.strategyId, 'builder-proof.v1')
    assert.equal(r.profile, 'artifact')
    const m = JSON.parse(readFileSync(r.manifestPath, 'utf8')) as BuildManifest
    assert.equal(m.git.strategy.dirty, true)
    assert.equal(m.git.strategy.allowDirty, true)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

// spec: 31 §3 item 3 — strategy:sync-lock regenerates the package lock from the
// engine lock (copy, then prune offline); the result is a subset of it.
test('syncLock rebuilds a package lock from the engine lock', { skip }, () => {
  const work = mkdtempSync(path.join('/private/tmp', 'pmb-native-e2e-'))
  try {
    const pkg = proofPackage(path.join(work, 'p'))
    const lock = path.join(pkg, 'Cargo.lock')
    const before = readFileSync(lock, 'utf8')
    rmSync(lock)
    const r = syncLock(pkg)
    assert.equal(r.changed, true)
    assert.equal(r.packages, 1, 'a dependency-free package keeps only itself')
    assert.equal(readFileSync(lock, 'utf8'), before)
    assert.equal(syncLock(pkg).changed, false)
    assert.throws(() => syncLock(work), /not a Rust strategy package/)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})
