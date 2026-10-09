import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const watchArg = args.indexOf('--parent-watch-fd')
if (watchArg !== -1) args.splice(watchArg, 2)
const [mode, pidFile] = args
if (pidFile) writeFileSync(pidFile, String(process.pid))
if (mode === 'ignore_term') process.on('SIGTERM', () => {})
if (mode === 'slow_input') {
  process.stdin.pause()
  setTimeout(() => process.stdin.resume(), 100)
}
let input = ''
process.stdin.on('data', (chunk) => {
  input += chunk
})
process.stdin.on('end', () => {
  const request = JSON.parse(input)
  const response = {
    protocolVersion: 1,
    requestId: request.requestId,
    status: 'success',
    engine: { name: 'polymarket-runtime', version: '0.1.0', protocolVersion: 1 },
    result: request.input,
  }
  if (mode === 'hang' || mode === 'ignore_term') {
    setInterval(() => {}, 1000)
    return
  }
  if (mode === 'malformed') return process.stdout.write('not-json\n')
  if (mode === 'oversized') return process.stdout.write(`${'x'.repeat(8192)}\n`)
  if (mode === 'invalid_utf8') return process.stdout.write(Buffer.from([0xff, 0x0a]))
  if (mode === 'no_response') return
  if (mode === 'wrong_id') response.requestId = 'another-request'
  if (mode === 'invalid_unicode_result') response.result = '\ud800'
  if (mode === 'invalid_unicode_key') response.result = { ['\udfff']: true }
  if (mode === 'control_identifier') response.requestId = 'bad\u009fidentifier'
  if (mode === 'blank_identifier') response.requestId = '\u2003'
  if (mode === 'null_id') response.requestId = null
  if (mode === 'wrong_protocol') response.protocolVersion = 2
  if (mode === 'wrong_engine') response.engine.name = 'legacy-ts-engine'
  if (mode === 'wrong_engine_protocol') response.engine.protocolVersion = 2
  if (mode === 'extra_field') response.unexpected = true
  if (mode === 'nonfinite') {
    return process.stdout.write(
      JSON.stringify(response).replace('"result":null', '"result":1e400') + '\n',
    )
  }
  if (mode === 'remote_error') {
    delete response.result
    response.status = 'failed'
    response.error = {
      code: 'unsupported_operation',
      message: 'Operation is unsupported.',
      retryable: false,
    }
  }
  if (mode === 'invalid_error') {
    response.status = 'failed'
    response.error = { code: 'failure', message: 'failed', retryable: true }
  }
  if (mode === 'diagnostics') process.stderr.write('diagnostic\n'.repeat(100_000))
  const output = JSON.stringify(response)
  if (mode === 'incomplete') return process.stdout.write(output)
  if (mode === 'bom') return process.stdout.write(`\ufeff${output}\n`)
  if (mode === 'duplicate') return process.stdout.write(`${output}\n${output}\n`)
  if (mode === 'blank_line') return process.stdout.write(`${output}\n\n`)
  if (mode === 'nonzero') {
    process.stderr.write('private-diagnostic-that-must-not-be-exposed\n')
    process.stdout.write(`${output}\n`, () => process.exit(7))
    return
  }
  if (mode === 'delayed_exit') {
    process.stdout.write(`${output}\n`)
    setTimeout(() => {}, 120)
    return
  }
  if (mode === 'fragmented') {
    const bytes = Buffer.from(`${output}\n`)
    let offset = 0
    const send = () => {
      if (offset === bytes.length) return
      process.stdout.write(bytes.subarray(offset, ++offset))
      setImmediate(send)
    }
    send()
    return
  }
  process.stdout.write(`${output}\n`)
})
