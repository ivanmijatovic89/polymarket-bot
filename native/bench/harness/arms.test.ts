import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkArms, parseArm } from './arms.js'

describe('parseArm / checkArms (16 §13.3, §13.5)', () => {
  it('parses an arm with defaults and labels by position', () => {
    assert.deepEqual(parseArm('bin=/x/bin,T=8', 1), {
      label: 'B',
      bin: '/x/bin',
      concurrency: 8,
      qos: 'utility',
      tapeDir: null,
    })
    assert.deepEqual(parseArm('bin=/x/bin,T=4,qos=default,tape-dir=/t,label=tape', 0), {
      label: 'tape',
      bin: '/x/bin',
      concurrency: 4,
      qos: 'default',
      tapeDir: '/t',
    })
  })

  const bad: Array<[string, string]> = [
    ['no bin', 'T=8'],
    ['no T', 'bin=/x'],
    ['T zero', 'bin=/x,T=0'],
    ['unknown key', 'bin=/x,T=1,threads=2'],
    ['duplicate key', 'bin=/x,T=1,T=2'],
    ['bad qos', 'bin=/x,T=1,qos=user-interactive'],
    ['not key=value', 'bin=/x,T=1,fast'],
    ['empty tape-dir', 'bin=/x,T=1,tape-dir='],
  ]
  for (const [what, spec] of bad) {
    it(`rejects: ${what}`, () => assert.throws(() => parseArm(spec, 0), /--arm/))
  }

  it('allows the same binary in two arms but not two identical arms', () => {
    const a = parseArm('bin=/x,T=8', 0)
    assert.doesNotThrow(() => checkArms([a, parseArm('bin=/x,T=8,tape-dir=/t', 1)]))
    assert.doesNotThrow(() => checkArms([a, parseArm('bin=/x,T=4', 1)]))
    assert.throws(() => checkArms([a, parseArm('bin=/x,T=8', 1)]), /same configuration/)
    assert.throws(() => checkArms([a, parseArm('bin=/y,T=8,label=A', 1)]), /labels/)
    assert.throws(() => checkArms([]), /at least one/)
  })
})
