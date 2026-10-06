import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { openCaptureSequence } from './sequence.js'
import type { RawFrame } from './types.js'

const frame: RawFrame = {
  source: 'binance',
  connectionId: 'connection',
  rawJson: '{"exact":"123.000001"}',
  stamp: { receivedAtMs: 1700000000000, monotonicNs: '123456789' },
}
async function spool(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recorder-sequence-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('lease reservation preserves capture identity and never reuses a sequence after restart', async (t) => {
  const directory = await spool(t)
  const first = await openCaptureSequence(directory)
  const a = first.capture(frame)
  const b = first.capture({
    ...frame,
    stamp: { ...frame.stamp, receivedAtMs: frame.stamp.receivedAtMs - 1000 },
  })
  assert.ok(BigInt(b.sequence) > BigInt(a.sequence))
  await assert.rejects(openCaptureSequence(directory), /locked/)
  await first.close()
  assert.throws(() => first.capture(frame), /unavailable/)
  const second = await openCaptureSequence(directory)
  const c = second.capture(frame)
  assert.equal(c.captureId, a.captureId)
  assert.notEqual(c.sessionId, a.sessionId)
  assert.ok(BigInt(c.sequence) > BigInt(b.sequence))
  assert.equal(c.rawJson, frame.rawJson)
  await second.close()
})

test('corrupt or missing sequence state fails closed and releases its claim', async (t) => {
  const directory = await spool(t)
  const owner = await openCaptureSequence(directory)
  await owner.close()
  const file = path.join(directory, 'sequence.json')
  const original = await readFile(file)
  await writeFile(file, '{"captureId":"invalid","nextLease":"1"}')
  await assert.rejects(openCaptureSequence(directory), /invalid sequence state/)
  await writeFile(file, original)
  const restored = await openCaptureSequence(directory)
  await restored.close()
  await unlink(file)
  await mkdir(path.join(directory, 'existing-market'))
  await assert.rejects(openCaptureSequence(directory), /refusing to reset/)
})

test(
  'concurrent process contenders have one owner and SIGKILL permits a safe higher lease',
  { timeout: 20_000 },
  async (t) => {
    const directory = await spool(t)
    const children: ChildProcessWithoutNullStreams[] = []
    t.after(async () => {
      for (const child of children) if (child.exitCode === null) child.kill('SIGKILL')
    })
    const script = `
    import { openCaptureSequence } from ${JSON.stringify(new URL('./sequence.ts', import.meta.url).href)};
    process.stdin.once('data', async () => {
      try {
        const owner = await openCaptureSequence(${JSON.stringify(directory)});
        console.log(JSON.stringify({ok:true,event:owner.capture(${JSON.stringify(frame)})}));
        setInterval(()=>{},1000);
      } catch(error) { console.log(JSON.stringify({ok:false,message:error.message})); process.exit(0); }
    });
  `
    const outputs = Array.from({ length: 4 }, () => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', script],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      )
      children.push(child)
      const output = once(child.stdout, 'data').then(
        ([bytes]) =>
          JSON.parse(String(bytes)) as {
            ok: boolean
            event?: { sequence: string; captureId: string }
            message?: string
          },
      )
      child.stdin.write('go')
      return output
    })
    const results = await Promise.all(outputs)
    assert.equal(results.filter((result) => result.ok).length, 1)
    assert.ok(
      results.filter((result) => !result.ok).every((result) => result.message?.includes('locked')),
    )
    const index = results.findIndex((result) => result.ok)
    const winner = children[index]!
    const exited = once(winner, 'exit')
    winner.kill('SIGKILL')
    await exited
    const restarted = await openCaptureSequence(directory)
    const next = restarted.capture(frame)
    assert.equal(next.captureId, results[index]!.event!.captureId)
    assert.ok(BigInt(next.sequence) > BigInt(results[index]!.event!.sequence))
    await restarted.close()
  },
)
