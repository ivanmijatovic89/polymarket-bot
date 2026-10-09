import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectHostFacts,
  coreSummary,
  formatBytes,
  hostLabel,
  parseLowPowerMode,
  parsePowerSource,
  parseSysctl,
  renderHostFactsMarkdown,
} from './hostFacts.js'

// Values as printed by `sysctl` on worker-1 (2026-10-09).
const SYSCTL: Record<string, string> = {
  'machdep.cpu.brand_string': 'Apple M4',
  'hw.model': 'Mac16,10',
  'hw.nperflevels': '2',
  'hw.logicalcpu': '10',
  'hw.physicalcpu': '10',
  'hw.memsize': '17179869184',
  'hw.cachelinesize': '128',
  'hw.pagesize': '16384',
  'kern.osproductversion': '26.2',
  'kern.osversion': '25C56',
  'hw.perflevel0.name': 'Performance',
  'hw.perflevel0.physicalcpu': '4',
  'hw.perflevel0.logicalcpu': '4',
  'hw.perflevel0.l1icachesize': '196608',
  'hw.perflevel0.l1dcachesize': '131072',
  'hw.perflevel0.l2cachesize': '16777216',
  'hw.perflevel0.cpusperl2': '4',
  'hw.perflevel1.name': 'Efficiency',
  'hw.perflevel1.physicalcpu': '6',
  'hw.perflevel1.logicalcpu': '6',
  'hw.perflevel1.l1icachesize': '131072',
  'hw.perflevel1.l1dcachesize': '65536',
  'hw.perflevel1.l2cachesize': '4194304',
  'hw.perflevel1.cpusperl2': '6',
}

function fakeRunner(cmd: string, args: readonly string[]): string {
  switch (cmd) {
    case 'sysctl':
      return args.map((k) => `${k}: ${SYSCTL[k] ?? ''}`).join('\n') + '\n'
    case 'rustc':
      return 'rustc 1.89.0 (29483883e 2025-08-04)\n'
    case 'cargo':
      return 'cargo 1.89.0 (c24e10642 2025-06-23)\n'
    case 'pmset':
      return args.includes('ps')
        ? "Now drawing from 'AC Power'\n"
        : 'System-wide power settings:\nCurrently in use:\n lowpowermode         0\n sleep                0\n'
    default:
      throw new Error(`unexpected command ${cmd}`)
  }
}

describe('host facts', () => {
  it('parses sysctl, pmset and hostnames', () => {
    assert.equal(parseSysctl('a.b: 1\nc: x: y\n\n').get('c'), 'x: y')
    assert.equal(parsePowerSource("Now drawing from 'AC Power'\n -InternalBattery"), 'AC Power')
    assert.equal(parsePowerSource(''), null)
    assert.equal(parseLowPowerMode(' lowpowermode         1'), true)
    assert.equal(parseLowPowerMode(''), null)
    assert.equal(hostLabel('Worker-1s-Mac-mini.local'), 'worker-1')
    assert.equal(hostLabel('studio.local'), 'studio')
    assert.equal(formatBytes(16777216), '16 MiB')
    assert.equal(formatBytes(196608), '192 KiB')
    assert.equal(formatBytes(17179869184), '16 GiB')
  })

  it('collects the worker-1 layout', () => {
    const f = collectHostFacts(fakeRunner, {
      hostname: 'Worker-1s-Mac-mini.local',
      node: '20.20.2',
    })
    assert.equal(f.host, 'worker-1')
    assert.equal(coreSummary(f), 'Apple M4, 4P + 6E (10 logical)')
    assert.deepEqual(f.perfLevels[1], {
      level: 1,
      name: 'Efficiency',
      physicalCpu: 6,
      logicalCpu: 6,
      l1iBytes: 131072,
      l1dBytes: 65536,
      l2Bytes: 4194304,
      cpusPerL2: 6,
    })
    assert.equal(f.memBytes, 17179869184)
    assert.equal(f.rustc, 'rustc 1.89.0 (29483883e 2025-08-04)')
    assert.equal(f.powerSource, 'AC Power')
    assert.equal(f.lowPowerMode, false)
    const md = renderHostFactsMarkdown(f, '2026-10-09', ['tail line'])
    assert.match(md, /^# Host facts: worker-1 \(2026-10-09\)/)
    assert.match(md, /\| 0 \| Performance \| 4 \| 4 \| 192 KiB \| 128 KiB \| 16 MiB \| 4 \| 1 \|/)
    assert.match(md, /\| 1 \| Efficiency \| 6 \| 6 \| 128 KiB \| 64 KiB \| 4 MiB \| 6 \| 1 \|/)
    assert.match(md, /tail line$/)
  })

  it('fails loud when a sysctl key is missing', () => {
    const broken = (cmd: string, args: readonly string[]): string =>
      cmd === 'sysctl'
        ? args.map((k) => (k === 'hw.memsize' ? '' : `${k}: ${SYSCTL[k] ?? ''}`)).join('\n')
        : fakeRunner(cmd, args)
    assert.throws(
      () => collectHostFacts(broken, { hostname: 'h', node: '20' }),
      /hw.memsize missing/,
    )
  })

  it('records unknown power state instead of failing', () => {
    const noPmset = (cmd: string, args: readonly string[]): string => {
      if (cmd === 'pmset') throw new Error('no pmset')
      return fakeRunner(cmd, args)
    }
    const f = collectHostFacts(noPmset, { host: 'worker-2', hostname: 'h', node: '20' })
    assert.equal(f.host, 'worker-2')
    assert.equal(f.powerSource, null)
    assert.equal(f.lowPowerMode, null)
  })
})
