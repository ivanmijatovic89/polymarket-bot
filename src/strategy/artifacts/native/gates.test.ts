import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  checkDescribe,
  checkSelftest,
  dylibViolations,
  findPathLeaks,
  parseDylibAllowlist,
  parseOtoolL,
  parseSingleJsonDocument,
  pathLeakNeedles,
} from './gates.js'
import { ENGINE_ROOT } from './host.js'
import { DYLIB_ALLOWLIST_REL } from './policy.js'

// Real output of `otool -L` on a std-only aarch64-apple-darwin binary (worker-1, 2026-10-09).
const OTOOL = `/private/tmp/x/target/aarch64-apple-darwin/artifact/proto:
\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1356.0.0)
`

// spec: 31 §4.4 step 3
test('parseOtoolL returns the install names without the header line', () => {
  assert.deepEqual(parseOtoolL(OTOOL), ['/usr/lib/libSystem.B.dylib'])
  assert.deepEqual(
    parseOtoolL(
      'bin:\n\t@rpath/libfoo.dylib (compatibility version 0.0.0, current version 0.0.0)\n',
    ),
    ['@rpath/libfoo.dylib'],
  )
})

// spec: 31 §4.4 step 3 — macOS system libraries under /usr/lib only.
test('the committed dylib allowlist parses and holds only /usr/lib entries', () => {
  const list = parseDylibAllowlist(
    readFileSync(path.join(ENGINE_ROOT, DYLIB_ALLOWLIST_REL), 'utf8'),
  )
  assert.ok(list.includes('/usr/lib/libSystem.B.dylib'))
  for (const e of list) assert.ok(e.startsWith('/usr/lib/'))
  assert.throws(
    () => parseDylibAllowlist('/opt/homebrew/lib/libzstd.dylib\n'),
    /outside \/usr\/lib/,
  )
  assert.throws(() => parseDylibAllowlist('/usr/lib/../local/lib/x.dylib\n'), /outside \/usr\/lib/)
  assert.throws(() => parseDylibAllowlist('# only comments\n'), /empty/)
})

test('dylibViolations rejects @rpath, Homebrew, /usr/local and unlisted libraries', () => {
  const allow = ['/usr/lib/libSystem.B.dylib']
  assert.deepEqual(dylibViolations(['/usr/lib/libSystem.B.dylib'], allow), [])
  const v = dylibViolations(
    [
      '@rpath/libstd.dylib',
      '/opt/homebrew/lib/libzstd.1.dylib',
      '/usr/local/lib/libssl.dylib',
      '/usr/lib/libiconv.2.dylib',
      '/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation',
    ],
    allow,
  )
  assert.equal(v.length, 5)
  assert.match(v[0]!, /relative install names/)
  assert.match(v[1]!, /Homebrew/)
  assert.match(v[2]!, /Homebrew and \/usr\/local/)
  assert.match(v[3]!, /not in native\/build\/dylib-allowlist/)
})

// spec: 31 §4.4 step 4 — home, CARGO_HOME, RUSTUP_HOME, engine root, package root, /private/var/folders.
test('pathLeakNeedles covers every host root, realpaths, /private aliases and temp folders', () => {
  const needles = pathLeakNeedles({
    home: '/Users/w',
    cargoHome: '/Users/w/.cargo',
    rustupHome: '/Users/w/.rustup',
    engineRoot: '/Users/w/Sites/bot',
    packageRoot: '/private/tmp/p/pkg',
    targetDir: '/Users/w/.cache/pmb/target/1.89.0',
    realpath: (p) => (p === '/Users/w/Sites/bot' ? '/Volumes/d/bot' : p),
  })
  for (const n of [
    '/Users/w',
    '/Users/w/.cargo',
    '/Users/w/.rustup',
    '/Users/w/Sites/bot',
    '/Volumes/d/bot',
    '/private/tmp/p/pkg',
    '/tmp/p/pkg',
    '/var/folders/',
    '/Users/',
  ]) {
    assert.ok(needles.includes(n), n)
  }
  assert.throws(
    () =>
      pathLeakNeedles({
        home: '/',
        cargoHome: '/c',
        rustupHome: '/r',
        engineRoot: '/e',
        packageRoot: '/p',
        targetDir: '/t',
        realpath: (p) => p,
      }),
    /non-root/,
  )
})

test('findPathLeaks finds embedded host paths in binary bytes', () => {
  const bytes = Buffer.concat([
    Buffer.from([0, 1, 2]),
    Buffer.from('panicked at /Users/w/Sites/bot/native/crates/x.rs:1:1'),
    Buffer.from([0]),
  ])
  assert.deepEqual(findPathLeaks(bytes, ['/Users/w/Sites/bot', '/private/var/folders/']), [
    '/Users/w/Sites/bot',
  ])
  assert.deepEqual(findPathLeaks(Buffer.from('/pmb/engine/native/crates/x.rs'), ['/Users/']), [])
})

const DESCRIBE = {
  type: 'describe',
  protocolVersion: 2,
  binary: { target: 'aarch64-apple-darwin', buildProfile: 'artifact', engineVersion: '0.1.0' },
  capabilities: { realOrders: false },
  strategy: { id: 'engine-exerciser.rs' },
}

// spec: 31 §4.4 step 6, 20 §5.1, §5.5 — target, profile, realOrders=false, id grammar (30 §4 rule 2).
test('checkDescribe accepts a standard artifact describe and returns the id', () => {
  const r = checkDescribe(DESCRIBE, { profile: 'artifact' })
  assert.ok(r.ok)
  assert.equal(r.summary.strategyId, 'engine-exerciser.rs')
})

test('checkDescribe rejects a wrong profile, target, protocol, real-order capability or id', () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ ...DESCRIBE, binary: { ...DESCRIBE.binary, buildProfile: 'iterate' } }, /buildProfile/],
    [
      { ...DESCRIBE, binary: { ...DESCRIBE.binary, target: 'x86_64-apple-darwin' } },
      /binary\.target/,
    ],
    [{ ...DESCRIBE, protocolVersion: 1 }, /protocolVersion/],
    [{ ...DESCRIBE, capabilities: { realOrders: true } }, /realOrders/],
    [{ ...DESCRIBE, capabilities: {} }, /realOrders/],
    [{ ...DESCRIBE, strategy: { id: '.bad' } }, /strategy\.id/],
    [{ ...DESCRIBE, strategy: { id: 'a'.repeat(129) } }, /strategy\.id/],
    [{ ...DESCRIBE, type: 'schema' }, /type/],
    [[], /not a JSON object/],
  ]
  for (const [doc, re] of cases) {
    const r = checkDescribe(doc, { profile: 'artifact' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.errors.join('\n'), re)
  }
})

// spec: 31 §4.4 step 5, 20 §5.3
test('checkSelftest requires exit 0 and ok=true', () => {
  assert.deepEqual(checkSelftest({ type: 'selftest', ok: true, checks: [] }, 0), [])
  assert.match(checkSelftest({ type: 'selftest', ok: true, checks: [] }, 8).join(), /exited with 8/)
  assert.match(
    checkSelftest(
      {
        type: 'selftest',
        ok: false,
        checks: [
          { name: 'fees', ok: false },
          { name: 'seeds', ok: true },
        ],
      },
      8,
    ).join(),
    /failed: fees/,
  )
  assert.match(checkSelftest('x', 0).join(), /not a JSON object/)
})

// spec: 20 G1 — exactly one JSON document on stdout.
test('parseSingleJsonDocument accepts one document and rejects anything else', () => {
  assert.deepEqual(parseSingleJsonDocument('{"a":1}\n', 'describe'), { a: 1 })
  assert.throws(() => parseSingleJsonDocument('', 'describe'), /printed nothing/)
  assert.throws(
    () => parseSingleJsonDocument('{"a":1}\n{"b":2}\n', 'describe'),
    /exactly one JSON document/,
  )
  assert.throws(
    () => parseSingleJsonDocument('log line\n{"a":1}', 'describe'),
    /exactly one JSON document/,
  )
})
