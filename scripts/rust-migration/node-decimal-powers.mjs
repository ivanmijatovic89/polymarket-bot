import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const bits = (value) => {
  const buffer = Buffer.alloc(8)
  buffer.writeDoubleBE(value)
  return buffer.toString('hex')
}
const powers = () => Array.from({ length: 310 }, (_, scale) => bits(Math.pow(10, scale)))
const cold = powers()
for (let iteration = 0; iteration < 1000; iteration += 1) powers()
const hot = powers()
console.log(
  JSON.stringify({
    evidence: 'native-reference-decimal-powers',
    platform: process.platform,
    architecture: process.arch,
    versions: process.versions,
    nodeExecutableSha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex'),
    cold,
    hot,
    coldEqualsHot: JSON.stringify(cold) === JSON.stringify(hot),
  }),
)
