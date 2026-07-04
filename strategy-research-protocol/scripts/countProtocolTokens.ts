import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

type Encoder = {
  encode(text: string): unknown[] | Uint32Array
  free?: () => void
}

type ProtocolFileStats = {
  absolutePath: string
  file: string
  words: number
  characters: number
  tokens: number
}

type ProtocolTotals = {
  files: number
  words: number
  characters: number
  tokens: number
}

type Args = {
  encoding: string
  includeHidden: boolean
  model?: string
}

const DEFAULT_ENCODING = 'o200k_base'
const PROTOCOL_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO_ROOT = dirname(PROTOCOL_ROOT)

function parseArgs(argv: string[]): Args {
  const args: Args = { encoding: DEFAULT_ENCODING, includeHidden: false }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (arg === '--encoding') {
      if (!next) throw new Error('--encoding requires a value')
      args.encoding = next
      i += 1
    } else if (arg === '--model') {
      if (!next) throw new Error('--model requires a value')
      args.model = next
      i += 1
    } else if (arg === '--include-hidden') {
      args.includeHidden = true
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return args
}

function printHelp(): void {
  console.log(`Usage: tsx strategy-research-protocol/scripts/countProtocolTokens.ts [options]

Counts Markdown and JSON files under strategy-research-protocol.

Options:
  --encoding <name>  tiktoken encoding to use. Default: ${DEFAULT_ENCODING}
  --model <name>     use tiktoken's model mapping instead of --encoding
  --include-hidden   include hidden files and directories, such as .notes
  -h, --help         show this help
`)
}

function protocolFiles(dir: string, args: Args, extension: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      if (!args.includeHidden && entry.name.startsWith('.')) return []
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return protocolFiles(path, args, extension)
      if (entry.isFile() && entry.name.endsWith(extension)) return [path]
      return []
    })
    .sort((a, b) => a.localeCompare(b))
}

function researchMemoryFiles(args: Args): string[] {
  const files = [join(PROTOCOL_ROOT, 'LESSONS.md')]
  const researchRoot = join(REPO_ROOT, 'src', 'strategies', 'research')

  if (existsSync(researchRoot)) {
    files.push(...researchMemoryFilesInDir(researchRoot, args))
  }

  return uniqueSorted(files.filter((path) => existsSync(path)))
}

function researchMemoryFilesInDir(dir: string, args: Args): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!args.includeHidden && entry.name.startsWith('.')) return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return researchMemoryFilesInDir(path, args)
    if (!entry.isFile()) return []
    if (entry.name === 'FAMILY.md' || entry.name === 'FAMILY.json' || entry.name === 'INDEX.json') {
      return [path]
    }
    return []
  })
}

function uniqueSorted(files: string[]): string[] {
  return [...new Set(files)].sort((a, b) => a.localeCompare(b))
}

function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['_-][\p{L}\p{N}]+)*/gu)?.length ?? 0
}

function countCharacters(text: string): number {
  return Array.from(text).length
}

async function createEncoder(args: Args): Promise<Encoder> {
  let tiktoken: typeof import('tiktoken')
  try {
    tiktoken = await import('tiktoken')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Unable to load tiktoken (${message}). Install it from the repo root with: npm install tiktoken`,
    )
  }

  const getEncoding = tiktoken.get_encoding as (encoding: string) => Encoder
  const encodingForModel = tiktoken.encoding_for_model as (model: string) => Encoder

  try {
    if (args.model) return encodingForModel(args.model)
    return getEncoding(args.encoding)
  } catch (error) {
    const label = args.model ? `model ${args.model}` : `encoding ${args.encoding}`
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Unsupported tiktoken ${label}: ${message}`)
  }
}

function collectStats(files: string[], encoder: Encoder): ProtocolFileStats[] {
  return files.map((path) => {
    const text = readFileSync(path, 'utf8')
    return {
      absolutePath: path,
      file: relative(REPO_ROOT, path),
      words: countWords(text),
      characters: countCharacters(text),
      tokens: encoder.encode(text).length,
    }
  })
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}

function totalStats(rows: ProtocolFileStats[]): ProtocolTotals {
  const totals = rows.reduce(
    (sum, row) => ({
      words: sum.words + row.words,
      characters: sum.characters + row.characters,
      tokens: sum.tokens + row.tokens,
    }),
    { words: 0, characters: 0, tokens: 0 },
  )

  return {
    files: rows.length,
    ...totals,
  }
}

function printTable(title: string, rows: ProtocolFileStats[]): ProtocolTotals {
  const totals = totalStats(rows)
  const numberedRows = rows.map((row, index) => ({ ...row, number: index + 1 }))
  const tableRows = [
    ...numberedRows,
    {
      number: null,
      file: 'TOTAL',
      words: totals.words,
      characters: totals.characters,
      tokens: totals.tokens,
    },
  ]

  const widths = {
    number: Math.max(
      ...tableRows.map((row) =>
        row.number === null ? ''.length : formatNumber(row.number).length,
      ),
      '#'.length,
    ),
    file: Math.max(...tableRows.map((row) => row.file.length), 'File'.length),
    words: Math.max(...tableRows.map((row) => formatNumber(row.words).length), 'Words'.length),
    characters: Math.max(
      ...tableRows.map((row) => formatNumber(row.characters).length),
      'Characters'.length,
    ),
    tokens: Math.max(...tableRows.map((row) => formatNumber(row.tokens).length), 'Tokens'.length),
  }

  console.log(title)
  const header = [
    '#'.padStart(widths.number),
    'File'.padEnd(widths.file),
    'Words'.padStart(widths.words),
    'Characters'.padStart(widths.characters),
    'Tokens'.padStart(widths.tokens),
  ].join('  ')
  const separator = [
    '-'.repeat(widths.number),
    '-'.repeat(widths.file),
    '-'.repeat(widths.words),
    '-'.repeat(widths.characters),
    '-'.repeat(widths.tokens),
  ].join('  ')

  console.log(header)
  console.log(separator)

  for (const row of numberedRows) {
    console.log(
      [
        formatNumber(row.number).padStart(widths.number),
        row.file.padEnd(widths.file),
        formatNumber(row.words).padStart(widths.words),
        formatNumber(row.characters).padStart(widths.characters),
        formatNumber(row.tokens).padStart(widths.tokens),
      ].join('  '),
    )
  }

  console.log(separator)
  console.log(
    [
      ''.padStart(widths.number),
      'TOTAL'.padEnd(widths.file),
      formatNumber(totals.words).padStart(widths.words),
      formatNumber(totals.characters).padStart(widths.characters),
      formatNumber(totals.tokens).padStart(widths.tokens),
    ].join('  '),
  )
  console.log(`\nTotal files: ${formatNumber(totals.files)}\n`)
  return totals
}

function printCombinedTotal(rows: ProtocolFileStats[]): void {
  const uniqueRows = [...new Map(rows.map((row) => [row.absolutePath, row])).values()]
  const total = totalStats(uniqueRows)

  console.log('Combined Total')
  console.log(`Files: ${formatNumber(total.files)}`)
  console.log(`Words: ${formatNumber(total.words)}`)
  console.log(`Characters: ${formatNumber(total.characters)}`)
  console.log(`Tokens: ${formatNumber(total.tokens)}`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const rootStats = statSync(PROTOCOL_ROOT)
  if (!rootStats.isDirectory())
    throw new Error(`Protocol root is not a directory: ${PROTOCOL_ROOT}`)

  const markdownFiles = protocolFiles(PROTOCOL_ROOT, args, '.md')
  const jsonFiles = protocolFiles(PROTOCOL_ROOT, args, '.json')
  const memoryFiles = researchMemoryFiles(args)
  const encoder = await createEncoder(args)
  try {
    console.log(
      args.model ? `Tokenizer: model ${args.model}` : `Tokenizer: encoding ${args.encoding}`,
    )
    console.log(`Protocol root: ${PROTOCOL_ROOT}\n`)
    const markdownStats = collectStats(markdownFiles, encoder)
    const jsonStats = collectStats(jsonFiles, encoder)
    const memoryStats = collectStats(memoryFiles, encoder)
    printTable('Markdown Files', markdownStats)
    printTable('JSON Files', jsonStats)
    printTable('Research Memory Files', memoryStats)
    printCombinedTotal([...markdownStats, ...jsonStats, ...memoryStats])
  } finally {
    encoder.free?.()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
