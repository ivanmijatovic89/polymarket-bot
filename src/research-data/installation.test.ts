import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { atomicWrite, readJson, writeJson } from './files.js'
import { activateResearchSchedule, prepareUpdateConfig } from './installation.js'
import { installedDatasetRoot } from './schedule.js'
import { claimLock, SyncBusyError } from './sync.js'

const label = 'com.polymarket.research.btc-15m'
const plistForRoot = (root: string, revision = 'old') =>
  JSON.stringify({
    Label: label,
    ProgramArguments: ['/absolute/node', path.join(root, 'runtime', revision, 'nightly.mjs')],
    StandardErrorPath: path.join(root, 'logs', 'nightly', 'latest.log'),
    StandardOutPath: path.join(root, 'logs', 'nightly', 'latest.json'),
  })
const installedRoot = (contents: string) => installedDatasetRoot(JSON.parse(contents), label)

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
  await atomicWrite(plistPath, plistForRoot(root))
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
    const newPlist = plistForRoot(f.root, 'new')
    const events: string[] = []
    const options = {
      root: f.root,
      candidateConfig,
      plistPath: f.plistPath,
      plist: plistForRoot(f.root, 'new'),
      installedRoot,
      metadata: { revision: 'new' },
      stop: () => {
        events.push('stop')
      },
      start: () => {
        assert.equal(existsSync(path.join(f.root, 'sync.lock')), false)
        assert.equal(readFileSync(f.plistPath, 'utf8'), newPlist)
        assert.equal(JSON.parse(readFileSync(f.configFile, 'utf8')).from, '2026-05-01')
        events.push('start')
      },
    }
    const releaseInstallation = await claimLock(`${f.plistPath}.installation`)
    await assert.rejects(activateResearchSchedule(options), SyncBusyError)
    assert.equal(events.length, 0)
    await releaseInstallation()
    const release = await claimLock(f.root)
    await assert.rejects(activateResearchSchedule(options), SyncBusyError)
    assert.equal(events.length, 0)
    assert.equal(await readFile(f.configFile, 'utf8'), f.before[0])
    await release()
    await activateResearchSchedule(options)
    assert.deepEqual(events, ['stop', 'start'])
    await assert.rejects(access(path.join(f.root, 'sync.lock')))
    assert.equal((await readJson<{ from: string }>(f.configFile))!.from, '2026-05-01')
    assert.equal(await readFile(f.plistPath, 'utf8'), newPlist)
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
          plist: plistForRoot(f.root, 'new'),
          installedRoot,
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

test('root changes refuse an old live downloader and serialize competing installers for the same job', async () => {
  const f = await fixture()
  const other = await fixture()
  const releaseOld = await claimLock(f.root)
  try {
    const candidateConfig = await prepareUpdateConfig(path.join(other.root, 'runtime', 'new'), {
      root: other.root,
      from: f.config.from,
      market: 'btc:15m',
    })
    const events: string[] = []
    const options = {
      root: other.root,
      candidateConfig,
      plistPath: f.plistPath,
      plist: plistForRoot(other.root, 'new'),
      metadata: { revision: 'new' },
      installedRoot,
      stop: () => {
        events.push('stop')
      },
      start: () => {
        events.push('start')
      },
    }
    const before = await Promise.all(
      [f.plistPath, f.configFile, other.configFile, other.scheduleFile].map((file) =>
        readFile(file, 'utf8'),
      ),
    )
    await assert.rejects(activateResearchSchedule(options), SyncBusyError)
    assert.equal(events.length, 0)
    assert.deepEqual(
      await Promise.all(
        [f.plistPath, f.configFile, other.configFile, other.scheduleFile].map((file) =>
          readFile(file, 'utf8'),
        ),
      ),
      before,
    )
    await assert.rejects(access(path.join(other.root, 'sync.lock')))
    await releaseOld()
    const releaseJob = await claimLock(`${f.plistPath}.installation`)
    try {
      await assert.rejects(activateResearchSchedule(options), SyncBusyError)
      assert.equal(events.length, 0)
    } finally {
      await releaseJob()
    }
    await activateResearchSchedule({
      ...options,
      stop: () => {
        assert.ok(
          existsSync(path.join(f.root, 'sync.lock')),
          'old root remains locked until job stop',
        )
        assert.ok(existsSync(path.join(other.root, 'sync.lock')), 'new root is also locked')
        events.push('stop')
      },
      start: () => {
        assert.equal(existsSync(path.join(f.root, 'sync.lock')), false)
        assert.equal(existsSync(path.join(other.root, 'sync.lock')), false)
        events.push('start')
      },
    })
    assert.deepEqual(events, ['stop', 'start'])
    assert.equal(installedRoot(await readFile(f.plistPath, 'utf8')), other.root)
  } finally {
    await releaseOld()
    await f.cleanup()
    await other.cleanup()
  }
})

test('failed root replacement restores the original job and releases both dataset locks', async () => {
  const f = await fixture()
  const other = await fixture()
  try {
    const candidateConfig = await prepareUpdateConfig(path.join(other.root, 'runtime', 'new'), {
      root: other.root,
      from: '2026-05-01',
      market: 'btc:15m',
    })
    let starts = 0
    await assert.rejects(
      activateResearchSchedule({
        root: other.root,
        candidateConfig,
        plistPath: f.plistPath,
        plist: plistForRoot(other.root, 'new'),
        metadata: { revision: 'new' },
        installedRoot,
        stop: () => {},
        start: () => {
          assert.equal(existsSync(path.join(f.root, 'sync.lock')), false)
          assert.equal(existsSync(path.join(other.root, 'sync.lock')), false)
          if (++starts === 1) throw new Error('bootstrap failed')
          assert.equal(readFileSync(f.plistPath, 'utf8'), f.before[1])
        },
      }),
      /bootstrap failed/,
    )
    assert.equal(starts, 2)
    assert.equal(await readFile(other.configFile, 'utf8'), other.before[0])
    assert.equal(await readFile(other.scheduleFile, 'utf8'), other.before[2])
    assert.equal(await readFile(f.configFile, 'utf8'), f.before[0])
  } finally {
    await f.cleanup()
    await other.cleanup()
  }
})

test('symlink aliases of the installed root do not double-lock the same dataset', async () => {
  const f = await fixture()
  const alias = `${f.root}-alias`
  try {
    await symlink(f.root, alias, 'dir')
    const candidateConfig = await prepareUpdateConfig(path.join(alias, 'runtime', 'new'), {
      root: alias,
      from: f.config.from,
      market: 'btc:15m',
    })
    await activateResearchSchedule({
      root: alias,
      candidateConfig,
      plistPath: f.plistPath,
      plist: plistForRoot(alias, 'new'),
      metadata: {},
      installedRoot,
      stop: () => {},
      start: () => {},
    })
    assert.equal(installedRoot(await readFile(f.plistPath, 'utf8')), alias)
  } finally {
    await rm(alias, { force: true })
    await f.cleanup()
  }
})

test('an unrecognized installed job fails before scheduler changes or configuration publication', async () => {
  const f = await fixture()
  try {
    const candidateConfig = await prepareUpdateConfig(path.join(f.root, 'runtime', 'new'), {
      root: f.root,
      from: '2026-05-01',
      market: 'btc:15m',
    })
    await atomicWrite(
      f.plistPath,
      JSON.stringify({ Label: label, ProgramArguments: ['/node', '/unknown/job.mjs'] }),
    )
    await assert.rejects(
      activateResearchSchedule({
        root: f.root,
        candidateConfig,
        plistPath: f.plistPath,
        plist: plistForRoot(f.root, 'new'),
        metadata: {},
        installedRoot,
        stop: () => {
          assert.fail('must not stop an unrecognized job')
        },
        start: () => {
          assert.fail('must not start')
        },
      }),
      /Unrecognized installed research job/,
    )
    assert.equal(await readFile(f.configFile, 'utf8'), f.before[0])
    assert.equal(await readFile(f.scheduleFile, 'utf8'), f.before[2])
    const inconsistent = JSON.parse(plistForRoot(f.root))
    inconsistent.StandardOutPath = '/other/logs/nightly/latest.json'
    assert.throws(() => installedDatasetRoot(inconsistent, label), /Cannot establish installed/)
  } finally {
    await f.cleanup()
  }
})
