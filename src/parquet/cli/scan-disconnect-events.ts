import * as parquet from '@dsnp/parquetjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline/promises'

type Args = {
  dir: string
  recursive: boolean
  limitRows: number
  deleteDisconnectsEqualOrGreater: number | null
  deleteFilesWithLastEventDisconnect: boolean
}

function parseArgs(argv: string[]): Args | null {
  let dir: string | undefined
  let recursive = true
  let limitRows = 0
  let deleteDisconnectsEqualOrGreater: number | null = null
  let deleteFilesWithLastEventDisconnect = false

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a) continue

    if (a === '--help' || a === '-h') return null

    if (a === '--recursive') {
      recursive = true
      continue
    }
    if (a === '--no-recursive') {
      recursive = false
      continue
    }

    if (a === '--limit-rows') {
      const raw = argv[i + 1]
      i += 1
      const n = raw ? Number(raw) : NaN
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null
      limitRows = n
      continue
    }

    if (
      a === '--delete-files-where-disconnects-equal-or-greater' ||
      a.startsWith('--delete-files-where-disconnects-equal-or-greater=')
    ) {
      let raw: string | undefined
      if (a.includes('=')) {
        raw = a.split('=')[1]
      } else {
        raw = argv[i + 1]
        i += 1
      }
      const n = raw ? Number(raw) : NaN
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null
      deleteDisconnectsEqualOrGreater = n
      continue
    }

    if (a === '--delete-files-with-last-event-disconnect') {
      deleteFilesWithLastEventDisconnect = true
      continue
    }

    // Positional: first positional is dir.
    if (!a.startsWith('-') && !dir) {
      dir = a
      continue
    }
  }

  if (!dir) return null
  return {
    dir,
    recursive,
    limitRows,
    deleteDisconnectsEqualOrGreater,
    deleteFilesWithLastEventDisconnect,
  }
}

async function walkParquetFiles(dirAbs: string, recursive: boolean): Promise<string[]> {
  const out: string[] = []

  const dirents = await fs.readdir(dirAbs, { withFileTypes: true })
  for (const d of dirents) {
    const full = path.join(dirAbs, d.name)

    if (d.isFile() && d.name.endsWith('.parquet')) {
      out.push(full)
      continue
    }

    if (recursive && d.isDirectory()) {
      const nested = await walkParquetFiles(full, recursive)
      out.push(...nested)
    }
  }

  return out
}

async function countDisconnectsInFile(
  filePath: string,
  limitRows: number,
): Promise<{
  disconnects: number
  rowsScanned: number
  lastEventDisconnect: boolean
  gapCount: number
  gapMinMs: number | null
  gapMaxMs: number | null
  gapAvgMs: number | null
  disconnectsWithoutNextEvent: number
}> {
  let reader: parquet.ParquetReader | undefined
  try {
    reader = await parquet.ParquetReader.openFile(filePath)
    const cursor = reader.getCursor()

    const toMs = (v: unknown): number | null => {
      if (typeof v === 'number') return Number.isFinite(v) ? v : null
      if (typeof v === 'bigint') {
        const n = Number(v)
        return Number.isFinite(n) ? n : null
      }
      if (typeof v === 'string') {
        const n = Number(v)
        return Number.isFinite(n) ? n : null
      }
      return null
    }

    let rowsScanned = 0
    let disconnects = 0
    let lastEventType: string | null = null
    let pendingDisconnectTsLocalMs: number | null = null

    let gapCount = 0
    let gapSumMs = 0
    let gapMinMs: number | null = null
    let gapMaxMs: number | null = null
    while (true) {
      const row = await cursor.next()
      if (!row) break
      rowsScanned += 1

      const ev = (row as { event_type?: unknown }).event_type
      const evStr = typeof ev === 'string' ? ev : ev == null ? '' : String(ev)
      lastEventType = evStr

      const tsLocalMs = toMs((row as { ts_local_ms?: unknown }).ts_local_ms)

      // If we previously saw a disconnect, measure time until this next event (any event type).
      if (pendingDisconnectTsLocalMs !== null && tsLocalMs !== null) {
        const gapMs = tsLocalMs - pendingDisconnectTsLocalMs
        gapCount += 1
        gapSumMs += gapMs
        gapMinMs = gapMinMs === null ? gapMs : Math.min(gapMinMs, gapMs)
        gapMaxMs = gapMaxMs === null ? gapMs : Math.max(gapMaxMs, gapMs)
        pendingDisconnectTsLocalMs = null
      }

      if (evStr === 'disconnect') {
        disconnects += 1
        // Start (or restart) a pending timer. If disconnect is the last row, it won't be cleared.
        if (tsLocalMs !== null) pendingDisconnectTsLocalMs = tsLocalMs
      }

      if (limitRows > 0 && rowsScanned >= limitRows) break
    }

    const lastEventDisconnect = lastEventType === 'disconnect'
    const disconnectsWithoutNextEvent =
      pendingDisconnectTsLocalMs !== null && disconnects > 0 ? 1 : 0
    const gapAvgMs = gapCount > 0 ? gapSumMs / gapCount : null

    return {
      disconnects,
      rowsScanned,
      lastEventDisconnect,
      gapCount,
      gapMinMs,
      gapMaxMs,
      gapAvgMs,
      disconnectsWithoutNextEvent,
    }
  } finally {
    await reader?.close().catch(() => undefined)
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed) {
    console.error(
      'Usage:\n' +
        '  tsx src/parquet/cli/scan-disconnect-events.ts <folder> [--recursive|--no-recursive] [--limit-rows N]\n' +
        '  tsx src/parquet/cli/scan-disconnect-events.ts <folder> --delete-files-where-disconnects-equal-or-greater=2\n' +
        '  tsx src/parquet/cli/scan-disconnect-events.ts <folder> --delete-files-with-last-event-disconnect\n' +
        'Examples:\n' +
        '  tsx src/parquet/cli/scan-disconnect-events.ts data/events\n' +
        '  tsx src/parquet/cli/scan-disconnect-events.ts data/events/btc --no-recursive\n' +
        '  tsx src/parquet/cli/scan-disconnect-events.ts data/events/btc --delete-files-where-disconnects-equal-or-greater=2\n' +
        '  tsx src/parquet/cli/scan-disconnect-events.ts data/events/btc --delete-files-with-last-event-disconnect\n' +
        '  npm run -s scan:disconnect-events -- data/events/btc --no-recursive\n',
    )
    process.exit(2)
  }

  const dirAbs = path.resolve(process.cwd(), parsed.dir)

  let files: string[]
  try {
    files = await walkParquetFiles(dirAbs, parsed.recursive)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[scan-disconnect-events] failed to read "${dirAbs}": ${msg}`)
    process.exit(2)
  }

  files.sort((a, b) => a.localeCompare(b))

  if (files.length === 0) {
    console.log(`[scan-disconnect-events] no .parquet files found under "${dirAbs}"`)
    return
  }

  let filesWithDisconnect = 0
  const filesByDisconnectCount = new Map<number, number>()
  let filesProcessed = 0
  let totalDisconnects = 0
  let filesWithLastEventDisconnect = 0
  let totalGaps = 0
  let totalDisconnectGapSumMs = 0
  let totalDisconnectGapMinMs: number | null = null
  let totalDisconnectGapMaxMs: number | null = null
  let totalDisconnectsWithoutNextEvent = 0
  let filesErrored = 0
  const filesToDelete: string[] = []

  for (let i = 0; i < files.length; i += 1) {
    const filePath = files[i] as string
    const rel = path.relative(dirAbs, filePath) || path.basename(filePath)
    console.log(`${i + 1}/${files.length} ${rel}`)

    try {
      const res = await countDisconnectsInFile(filePath, parsed.limitRows)
      filesProcessed += 1
      filesByDisconnectCount.set(
        res.disconnects,
        (filesByDisconnectCount.get(res.disconnects) ?? 0) + 1,
      )
      if (
        parsed.deleteDisconnectsEqualOrGreater !== null &&
        res.disconnects >= parsed.deleteDisconnectsEqualOrGreater
      ) {
        filesToDelete.push(filePath)
      }
      if (parsed.deleteFilesWithLastEventDisconnect && res.lastEventDisconnect) {
        filesToDelete.push(filePath)
      }
      if (res.disconnects > 0) {
        filesWithDisconnect += 1
        totalDisconnects += res.disconnects
        if (res.lastEventDisconnect) filesWithLastEventDisconnect += 1
        totalDisconnectsWithoutNextEvent += res.disconnectsWithoutNextEvent

        if (res.gapCount > 0 && res.gapAvgMs !== null) {
          totalGaps += res.gapCount
          totalDisconnectGapSumMs += res.gapAvgMs * res.gapCount
          if (res.gapMinMs !== null)
            totalDisconnectGapMinMs =
              totalDisconnectGapMinMs === null
                ? res.gapMinMs
                : Math.min(totalDisconnectGapMinMs, res.gapMinMs)
          if (res.gapMaxMs !== null)
            totalDisconnectGapMaxMs =
              totalDisconnectGapMaxMs === null
                ? res.gapMaxMs
                : Math.max(totalDisconnectGapMaxMs, res.gapMaxMs)
        }
        console.log(
          `  -> disconnects=${res.disconnects} last_event_disconnect=${res.lastEventDisconnect} gaps=${res.gapCount} gap_ms_avg=${
            res.gapAvgMs === null ? 'n/a' : res.gapAvgMs.toFixed(2)
          } gap_ms_min=${res.gapMinMs === null ? 'n/a' : res.gapMinMs} gap_ms_max=${
            res.gapMaxMs === null ? 'n/a' : res.gapMaxMs
          } (rows_scanned=${res.rowsScanned}${parsed.limitRows > 0 ? `, limit=${parsed.limitRows}` : ''})`,
        )
      }
    } catch (e) {
      filesErrored += 1
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`  -> ERROR reading parquet: ${msg}`)
    }
  }

  const totalGapAvgMs = totalGaps > 0 ? totalDisconnectGapSumMs / totalGaps : null
  console.log(
    `[scan-disconnect-events] done: files=${files.length} files_with_disconnect=${filesWithDisconnect} files_with_last_event_disconnect=${filesWithLastEventDisconnect} total_disconnects=${totalDisconnects} total_disconnects_without_next_event=${totalDisconnectsWithoutNextEvent} gaps=${totalGaps} gap_ms_avg=${
      totalGapAvgMs === null ? 'n/a' : totalGapAvgMs.toFixed(2)
    } gap_ms_min=${totalDisconnectGapMinMs === null ? 'n/a' : totalDisconnectGapMinMs} gap_ms_max=${
      totalDisconnectGapMaxMs === null ? 'n/a' : totalDisconnectGapMaxMs
    } files_errored=${filesErrored}`,
  )

  if (filesProcessed > 0) {
    const levels = Array.from(filesByDisconnectCount.keys()).sort((a, b) => a - b)
    if (!filesByDisconnectCount.has(0)) filesByDisconnectCount.set(0, 0)
    if (levels[0] !== 0) levels.unshift(0)
    const countsByLevel = levels.map((level) => filesByDisconnectCount.get(level) ?? 0)
    const geCounts: number[] = []
    let suffix = 0
    for (let i = countsByLevel.length - 1; i >= 0; i -= 1) {
      suffix += countsByLevel[i] ?? 0
      geCounts[i] = suffix
    }
    const colLevel = 'level'
    const colCount = 'count'
    const colGe = 'count_ge'
    const rows = levels.map((level, i) => ({
      level: String(level),
      count: String(countsByLevel[i] ?? 0),
      ge: String(geCounts[i] ?? 0),
    }))
    const widthLevel = Math.max(colLevel.length, ...rows.map((r) => r.level.length))
    const widthCount = Math.max(colCount.length, ...rows.map((r) => r.count.length))
    const widthGe = Math.max(colGe.length, ...rows.map((r) => r.ge.length))

    console.log('[scan-disconnect-events] disconnects_per_file:')
    console.log(
      `  ${colLevel.padStart(widthLevel)} ${colCount.padStart(widthCount)} ${colGe.padStart(widthGe)}`,
    )
    console.log(`  ${'-'.repeat(widthLevel)} ${'-'.repeat(widthCount)} ${'-'.repeat(widthGe)}`)
    for (const row of rows) {
      console.log(
        `  ${row.level.padStart(widthLevel)} ${row.count.padStart(widthCount)} ${row.ge.padStart(
          widthGe,
        )}`,
      )
    }
  }

  if (
    parsed.deleteDisconnectsEqualOrGreater !== null ||
    parsed.deleteFilesWithLastEventDisconnect
  ) {
    const toDelete = Array.from(new Set(filesToDelete))
    const deleteCount = toDelete.length
    if (deleteCount === 0) {
      const deleteReasons: string[] = []
      if (parsed.deleteDisconnectsEqualOrGreater !== null) {
        deleteReasons.push(`disconnects equal or greater ${parsed.deleteDisconnectsEqualOrGreater}`)
      }
      if (parsed.deleteFilesWithLastEventDisconnect) {
        deleteReasons.push('last_event_disconnect=true')
      }
      const reasonText =
        deleteReasons.length === 1
          ? (deleteReasons[0] ?? '')
          : deleteReasons.map((r) => `(${r})`).join(' OR ')
      console.log(`[scan-disconnect-events] no files to delete for criteria: ${reasonText}`)
      return
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      const deleteReasons: string[] = []
      if (parsed.deleteDisconnectsEqualOrGreater !== null) {
        deleteReasons.push(`disconnects equal or greater ${parsed.deleteDisconnectsEqualOrGreater}`)
      }
      if (parsed.deleteFilesWithLastEventDisconnect) {
        deleteReasons.push('last_event_disconnect=true')
      }
      const reasonText =
        deleteReasons.length === 1
          ? (deleteReasons[0] ?? '')
          : deleteReasons.map((r) => `(${r})`).join(' OR ')

      console.log(
        `You requested to delete files where ${reasonText}, there is ${deleteCount} files to be deleted. Before we delete files please double check files:`,
      )

      let choice = ''
      while (choice !== 'show files' && choice !== 'cancel') {
        choice = (await rl.question('Choose: show files | cancel\n')).trim().toLowerCase()
      }

      if (choice === 'cancel') return

      for (const filePath of toDelete) {
        const rel = path.relative(dirAbs, filePath) || path.basename(filePath)
        const displayPath = path.join(parsed.dir, rel)
        console.log(displayPath)
      }

      const confirm = (
        await rl.question(
          `Please confirm you wanna delete ${deleteCount} files where ${reasonText}.\nType 'delete' to confirm:\n`,
        )
      ).trim()
      if (confirm !== 'delete') return

      let deleted = 0
      let deleteErrors = 0
      for (const filePath of toDelete) {
        try {
          await fs.unlink(filePath)
          deleted += 1
        } catch {
          deleteErrors += 1
        }
      }
      console.log(`[scan-disconnect-events] delete done: deleted=${deleted} errors=${deleteErrors}`)
    } finally {
      rl.close()
    }
  }
}

await main()
