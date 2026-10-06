import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { BoundedLog } from '../lib/bounded-log.mjs'

function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bounded-recorder-log-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, file: path.join(dir, 'recorder.log') }
}

test('large output retains the newest bytes inside a strict total disk budget', (t) => {
  const { dir, file } = fixture(t)
  const log = new BoundedLog(file, { maxBytes: 10, archives: 3 })
  log.write(Buffer.from('a'.repeat(100) + 'b'.repeat(20) + 'latest1234'))
  log.close()
  assert.equal(readdirSync(dir).length, 4)
  assert.equal(
    readdirSync(dir).reduce((n, f) => n + statSync(path.join(dir, f)).size, 0),
    40,
  )
  assert.equal(readFileSync(file, 'utf8'), 'latest1234')
  assert.equal(readFileSync(`${file}.1`, 'utf8'), 'b'.repeat(10))
  assert.equal(statSync(file).mode & 0o777, 0o600)
})

test('reopening appends; unsafe paths and oversized previous logs fail without deletion', (t) => {
  const { dir, file } = fixture(t)
  const first = new BoundedLog(file, { maxBytes: 10 })
  first.write('start')
  first.close()
  const second = new BoundedLog(file, { maxBytes: 10 })
  second.write('end')
  second.close()
  assert.equal(readFileSync(file, 'utf8'), 'startend')
  writeFileSync(file, 'x'.repeat(11))
  assert.throws(() => new BoundedLog(file, { maxBytes: 10 }), /exceeds/)
  assert.equal(readFileSync(file).length, 11)
  const link = path.join(dir, 'link')
  symlinkSync(file, link)
  assert.throws(() => new BoundedLog(link), /regular file/)
  const dangling = path.join(dir, 'dangling')
  symlinkSync(path.join(dir, 'missing'), dangling)
  assert.throws(() => new BoundedLog(dangling), /regular file/)
})

test('service captures both output streams and preserves a failed recorder exit', async (t) => {
  const { file } = fixture(t)
  const child = spawn(process.execPath, [
    'scripts/recorder-service.mjs',
    '--log-file',
    file,
    '--',
    '-e',
    'console.log("stdout");console.error("stderr");process.exitCode=7',
  ])
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
  assert.equal(code, 7)
  assert.match(readFileSync(file, 'utf8'), /stdout/)
  assert.match(readFileSync(file, 'utf8'), /stderr/)
})

test('service forwards shutdown and waits for the recorder to flush', async (t) => {
  const { file } = fixture(t)
  const child = spawn(process.execPath, [
    'scripts/recorder-service.mjs',
    '--log-file',
    file,
    '--',
    '-e',
    'process.on("SIGTERM",()=>{console.log("flushed");process.exit(0)});console.log("ready");setInterval(()=>{},1000)',
  ])
  t.after(() => child.kill('SIGKILL'))
  const finished = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
  for (let i = 0; i < 100; i++) {
    try {
      if (readFileSync(file, 'utf8').includes('ready')) break
    } catch {
      /* startup */
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.match(readFileSync(file, 'utf8'), /ready/)
  child.kill('SIGTERM')
  assert.equal(await finished, 0)
  assert.match(readFileSync(file, 'utf8'), /flushed/)
})
