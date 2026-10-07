import { existsSync } from 'node:fs'
import { runNativeOperation } from '../nativeClient.js'

const [fixture, pidFile] = process.argv.slice(2)
if (!fixture || !pidFile) throw new Error('Missing fixture arguments')
void runNativeOperation(
  { executablePath: process.execPath, args: [fixture, 'hang', pidFile] },
  { operation: 'describe_runtime', input: {} },
).catch(() => {})
const poll = setInterval(() => {
  if (existsSync(pidFile)) process.exit(0)
}, 10)
setTimeout(() => {
  clearInterval(poll)
  process.exit(2)
}, 5000)
