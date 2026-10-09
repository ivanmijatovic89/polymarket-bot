import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const [executable, pidFile, mode] = process.argv.slice(2)
if (!executable || !pidFile) throw new Error('Missing fixture arguments')
const child = spawn(executable, mode === 'unguarded' ? [] : ['--parent-watch-fd', '3'], {
  // The test controller independently owns the input writer; parent loss cannot cause stdin EOF.
  stdio: [0, 'pipe', 'pipe', 'pipe'],
})
let output = ''
child.stdout!.on('data', (chunk: Buffer) => {
  output += chunk.toString('utf8')
  if (!output.includes('\n')) return
  const response = JSON.parse(output.slice(0, output.indexOf('\n'))) as { status: string }
  if (response.status !== 'success') process.exit(2)
  // A response proves the native guardian has initialized before the test kills this parent.
  writeFileSync(pidFile, String(child.pid))
})
child.stderr!.resume()
child.on('error', () => process.exit(2))
child.once('close', () => process.exit(2))
// The controller keeps inherited stdin open while this parent owns the separate watchdog pipe.
setTimeout(() => process.exit(2), 10_000)
