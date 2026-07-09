// detach.mjs — launch a command in its own session (setsid) so it survives
// the death of the launching session (DECISIONS D10). macOS has no setsid
// binary; Node's `detached: true` performs setsid(2) on POSIX.
//
// Usage: node fable-lab/tools/detach.mjs <logfile> <cmd> [args...]
//        (env vars: set them on this process; they are inherited)
import { spawn } from 'node:child_process'
import { openSync } from 'node:fs'

const [logfile, cmd, ...args] = process.argv.slice(2)
if (!logfile || !cmd) {
  console.error('usage: detach.mjs <logfile> <cmd> [args...]')
  process.exit(1)
}
const fd = openSync(logfile, 'a')
const child = spawn(cmd, args, { detached: true, stdio: ['ignore', fd, fd] })
child.unref()
console.log(`detached pid=${child.pid} log=${logfile}`)
