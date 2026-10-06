import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { atomicWrite, readJson, writeJson } from './files.js'
import { activateResearchSchedule, prepareUpdateConfig } from './installation.js'
import { claimLock, SyncBusyError } from './sync.js'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'research-install-'))
  const config = {
    version: 1,
    root,
    from: '2026-06-01',
    market: 'btc:15m',
    concurrency: 8,
    requestsPerSecond: 30,
    minFreeGiB: 10,
  }
  const configFile = path.join(root, 'update-config.json')
  const plistPath = path.join(root, 'LaunchAgents', 'research.plist')
  const scheduleFile = path.join(root, 'schedule.json')
  await writeJson(configFile, config)
  await atomicWrite(plistPath, 'old release')
  await writeJson(scheduleFile, { revision: 'old' })
  const before = await Promise.all(
    [configFile, plistPath, scheduleFile].map((file) => readFile(file, 'utf8')),
  )
  return {
    root,
    config,
    configFile,
    plistPath,
    scheduleFile,
    before,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

for (const from of ['2026-05-01', 'not-a-date']) {
  test(`preparing ${from} leaves the installed configuration and plist unchanged`, async () => {
    const f = await fixture()
    try {
      const prepare = prepareUpdateConfig(path.join(f.root, 'runtime', 'candidate'), {
        root: f.root,
        from,
        market: 'btc:15m',
      })
      if (from === 'not-a-date') await assert.rejects(prepare)
      else {
        const candidate = await prepare
        assert.deepEqual(await readJson(candidate), { ...f.config, from })
      }
      assert.deepEqual(
        await Promise.all(
          [f.configFile, f.plistPath, f.scheduleFile].map((file) => readFile(file, 'utf8')),
        ),
        f.before,
      )
    } finally {
      await f.cleanup()
    }
  })
}

test('activation refuses to stop a live downloader, then publishes before starting with the lock released', async () => {
  const f = await fixture()
  try {
    const candidateConfig = await prepareUpdateConfig(path.join(f.root, 'runtime', 'candidate'), {
      root: f.root,
      from: '2026-05-01',
      market: 'btc:15m',
    })
    const events: string[] = []
    const options = {
      root: f.root,
      candidateConfig,
      plistPath: f.plistPath,
      plist: 'new release',
      metadata: { revision: 'new' },
      stop: () => {
        events.push('stop')
      },
      start: () => {
        assert.equal(existsSync(path.join(f.root, 'sync.lock')), false)
        assert.equal(readFileSync(f.plistPath, 'utf8'), 'new release')
        assert.equal(JSON.parse(readFileSync(f.configFile, 'utf8')).from, '2026-05-01')
        events.push('start')
      },
    }
    const releaseInstallation = await claimLock(path.join(f.root, 'runtime', 'installation'))
    await assert.rejects(activateResearchSchedule(options), SyncBusyError)
    assert.deepEqual(events, [])
    await releaseInstallation()
    const release = await claimLock(f.root)
    await assert.rejects(activateResearchSchedule(options), SyncBusyError)
    assert.deepEqual(events, [])
    assert.equal(await readFile(f.configFile, 'utf8'), f.before[0])
    await release()
    await activateResearchSchedule(options)
    assert.deepEqual(events, ['stop', 'start'])
    await assert.rejects(access(path.join(f.root, 'sync.lock')))
    assert.equal((await readJson<{ from: string }>(f.configFile))!.from, '2026-05-01')
    assert.equal(await readFile(f.plistPath, 'utf8'), 'new release')
    assert.deepEqual(await readJson(f.scheduleFile), { revision: 'new' })
  } finally {
    await f.cleanup()
  }
})

for (const existing of [true, false]) {
  test(`failed activation restores ${existing ? 'previous config, plist and metadata' : 'an uninstalled state'}`, async () => {
    const f = await fixture()
    try {
      if (!existing) for (const file of [f.configFile, f.plistPath, f.scheduleFile]) await rm(file)
      const candidateConfig = await prepareUpdateConfig(path.join(f.root, 'runtime', 'candidate'), {
        root: f.root,
        from: '2026-05-01',
        market: 'btc:15m',
      })
      let starts = 0
      await assert.rejects(
        activateResearchSchedule({
          root: f.root,
          candidateConfig,
          plistPath: f.plistPath,
          plist: 'new release',
          metadata: { revision: 'new' },
          stop: () => {},
          start: () => {
            assert.equal(existsSync(path.join(f.root, 'sync.lock')), false)
            if (++starts === 1) throw new Error('bootstrap failed')
            assert.equal(readFileSync(f.plistPath, 'utf8'), f.before[1])
            assert.equal(readFileSync(f.configFile, 'utf8'), f.before[0])
          },
        }),
        /bootstrap failed/,
      )
      assert.equal(starts, existing ? 2 : 1)
      const files = [f.configFile, f.plistPath, f.scheduleFile]
      if (existing)
        assert.deepEqual(await Promise.all(files.map((file) => readFile(file, 'utf8'))), f.before)
      else for (const file of files) await assert.rejects(access(file))
      await assert.rejects(access(path.join(f.root, 'sync.lock')))
    } finally {
      await f.cleanup()
    }
  })
}
