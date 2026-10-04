import { verifyCapturePackage } from '../recorder-v3/verify.js'

async function main(): Promise<void> {
  const inputs = process.argv.slice(2)
  if (!inputs.length || inputs.includes('--help')) {
    console.log(
      'Usage: npm run record:v3:verify -- <package-directory|manifest.json|events.parquet> [...]',
    )
    console.log(
      'Reads every row and replays tick/feed state locally. Incomplete coverage is reported, not treated as corruption.',
    )
    if (!inputs.length) process.exitCode = 1
    return
  }
  for (const input of inputs) {
    try {
      console.log(JSON.stringify(await verifyCapturePackage(input)))
    } catch (error) {
      console.error(
        `[recorder-verify] ${input}: ${error instanceof Error ? error.message : String(error)}`,
      )
      process.exitCode = 1
    }
  }
}

void main()
