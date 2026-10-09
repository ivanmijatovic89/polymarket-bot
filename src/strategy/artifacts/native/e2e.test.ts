import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildNative, engineIdentity, loadPackage, readToolchain } from './builder.js'
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
  return { sha: built.sha256, probe, engineRelPath: loaded.engineRelPath }
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
