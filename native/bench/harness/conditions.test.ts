import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyConditions,
  countFleetProcesses,
  PRE_START_SAMPLES,
  type ConditionInputs,
} from './conditions.js'

const QUIET: ConditionInputs = {
  quietHostConfirmed: true,
  fleetProcessCount: 0,
  preStartLoad1: new Array<number>(PRE_START_SAMPLES).fill(0.4),
  startLocalHour: 3,
  binariesCanonical: true,
  acPower: true,
  lowPowerMode: false,
}

describe('classifyConditions (16 §13.5)', () => {
  it('is idle only when every condition holds', () => {
    assert.deepEqual(classifyConditions(QUIET), { label: 'idle', reasons: [] })
  })

  const cases: Array<[string, Partial<ConditionInputs>, RegExp]> = [
    ['not confirmed', { quietHostConfirmed: false }, /not confirmed/],
    ['fleet running', { fleetProcessCount: 2 }, /2 fleet/],
    ['no pre-start sampling', { preStartLoad1: [] }, /pre-start/],
    ['load too high', { preStartLoad1: [...QUIET.preStartLoad1.slice(1), 1.0] }, /reached 1.00/],
    ['before window', { startLocalHour: 0 }, /window/],
    ['after window', { startLocalHour: 7 }, /window/],
    ['non-canonical', { binariesCanonical: false }, /non-canonical/],
    ['battery', { acPower: false }, /not on AC/],
    ['unknown power', { acPower: null }, /unknown/],
    ['low power mode', { lowPowerMode: true }, /Low Power Mode on/],
  ]
  for (const [what, change, reason] of cases) {
    it(`is non-idle when ${what}`, () => {
      const v = classifyConditions({ ...QUIET, ...change })
      assert.equal(v.label, 'non-idle')
      assert.equal(v.reasons.length, 1)
      assert.match(v.reasons[0]!, reason)
    })
  }

  it('lists every failing condition', () => {
    const v = classifyConditions({
      ...QUIET,
      quietHostConfirmed: false,
      preStartLoad1: [],
      startLocalHour: 12,
    })
    assert.equal(v.reasons.length, 3)
  })
})

describe('countFleetProcesses', () => {
  it('counts fleet-copy, worker and Global Runtime processes but not the native clone or itself', () => {
    const ps = [
      '  101 node /Users/worker-1/Sites/polymarket-bot/node_modules/.bin/tsx src/cli/worker.ts',
      '  102 npm run worker:markets-and-aggregate',
      '  103 node dist/global-runtime/daemon.js',
      '  104 tsx /Users/worker-1/Sites/polymarket-bot-native/scripts/native/bench-l1.ts',
      '  105 /usr/bin/true',
      '  106 node /Users/worker-1/Sites/polymarket-bot/scripts/x.ts',
    ].join('\n')
    assert.equal(countFleetProcesses(ps, 106), 3)
  })
})
