/**
 * `native:fixture-job` tests (60 §12 FX-1a; 01 §6 M1 proof; 21 §5.1, §9).
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

import { buildEngineJob } from './buildEngineJob.js'
import type { EngineJob } from './contract/generated.js'
import { parseFixtureJobArgs, renderFixtureJob, writeFixtureJob } from './fixtureJob.js'
import { REPO_ROOT } from './modelConfig.js'
import { SLUG, makeDataRoot, nativeJob, scratchDir } from './testSupport.js'

/** A fixture market dir `<root>/<slug>/` with a committed-form job.json (relative paths). */
async function makeFixture(): Promise<{ root: string; dir: string; absolute: EngineJob }> {
  const data = makeDataRoot()
  const b = await buildEngineJob(nativeJob(), { dataRoot: data }, { log: () => {} })
  assert.equal(b.kind, 'job')
  if (b.kind !== 'job') throw new Error('unreachable')
  const root = scratchDir('fixtures')
  const dir = path.join(root, SLUG)
  cpSync(data, dir, { recursive: true })
  const rel = (p: string) => path.relative(data, p)
  const committed: EngineJob = {
    ...b.job,
    market: {
      ...b.job.market,
      input: { ...b.job.market.input, path: rel(b.job.market.input.path) },
      feedFiles: b.job.market.feedFiles.map((f) => ({ ...f, path: rel(f.path) })),
    },
  }
  writeFileSync(path.join(dir, 'job.json'), JSON.stringify(committed, null, 2))
  const absolute: EngineJob = {
    ...b.job,
    market: {
      ...b.job.market,
      input: { ...b.job.market.input, path: path.join(dir, rel(b.job.market.input.path)) },
      feedFiles: b.job.market.feedFiles.map((f) => ({ ...f, path: path.join(dir, rel(f.path)) })),
    },
  }
  return { root, dir, absolute }
}

describe('native:fixture-job (60 §12 FX-1a)', () => {
  it('renders the absolute-path job, verified and schema-valid', async () => {
    // spec: 60 §12 FX-1a (fixture-relative job.json → absolute EngineJob); 21 §5.1 absolute local paths
    const { root, absolute } = await makeFixture()
    const job = await renderFixtureJob({ slug: SLUG, fixturesRoot: root })
    assert.deepEqual(job, absolute)
    const feeds = await renderFixtureJob({ slug: SLUG, fixturesRoot: root, traceLevel: 'feeds' })
    assert.equal(feeds.outputs.traceLevel, 'feeds')
  })

  it('writes the job atomically and is deterministic for the same fixture', async () => {
    // spec: 01 §6 M1 proof (the same job file runs twice); 20 G4 (atomic writes)
    const { root } = await makeFixture()
    const a = await writeFixtureJob({ slug: SLUG, fixturesRoot: root })
    const b = await writeFixtureJob({ slug: SLUG, fixturesRoot: root })
    assert.equal(a, b)
    const out = path.join(scratchDir('out'), 'job.json')
    assert.equal(await writeFixtureJob({ slug: SLUG, fixturesRoot: root, out }), out)
    assert.equal(readFileSync(out, 'utf8'), readFileSync(a, 'utf8'))
  })

  it('refuses a fixture whose files changed or whose slug differs', async () => {
    // spec: 21 §9 step 2 (bytes checked before use); R14
    const { root, dir } = await makeFixture()
    const job = JSON.parse(readFileSync(path.join(dir, 'job.json'), 'utf8')) as EngineJob
    writeFileSync(path.join(dir, job.market.input.path), Buffer.alloc(3))
    await assert.rejects(renderFixtureJob({ slug: SLUG, fixturesRoot: root }), /integrity_mismatch/)
    await assert.rejects(
      renderFixtureJob({ slug: 'btc-updown-15m-1776557700', fixturesRoot: root }),
      /no fixture job/,
    )
  })

  it('parses its arguments strictly', () => {
    // spec: R14 (unknown flags are errors)
    assert.deepEqual(parseFixtureJobArgs([SLUG]), { slug: SLUG })
    assert.equal(parseFixtureJobArgs([SLUG, '--trace-level', 'feeds']).traceLevel, 'feeds')
    assert.throws(() => parseFixtureJobArgs([]), /usage/)
    assert.throws(() => parseFixtureJobArgs([SLUG, '--strategy', 'x']), /unknown argument/)
    assert.throws(() => parseFixtureJobArgs([SLUG, '--out', 'a', '--out', 'b']), /twice/)
    assert.throws(() => parseFixtureJobArgs([SLUG, '--trace-level', 'all']), /expected decisions/)
    assert.throws(() => parseFixtureJobArgs(['../x']), /invalid fixture slug/)
  })

  it('prints only the written path on stdout (the M1 proof captures it)', async () => {
    // spec: 01 §6 M1 proof `J=$(npm run -s native:fixture-job -- <fixture slug>)`
    const { root } = await makeFixture()
    const stdout = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        path.join(REPO_ROOT, 'scripts/native/fixture-job.ts'),
        SLUG,
        '--fixtures-root',
        root,
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    const lines = stdout.split('\n').filter((l) => l !== '')
    assert.equal(lines.length, 1)
    const job = JSON.parse(readFileSync(lines[0]!, 'utf8')) as EngineJob
    assert.ok(path.isAbsolute(job.market.input.path))
  })
})
