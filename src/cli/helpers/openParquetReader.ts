import { promises as fs } from 'fs'
import * as parquet from '@dsnp/parquetjs'
import { isR2Url, parseR2Url } from '../../r2/parseR2Url.js'
import { getObjectBuffer } from '../../r2/client.js'

type ParquetReader = Awaited<ReturnType<typeof parquet.ParquetReader.openFile>>

type Deps = {
  openFile: (filePath: string) => Promise<ParquetReader>
  openBuffer: (buffer: Buffer) => Promise<ParquetReader>
  readFile: (filePath: string) => Promise<Buffer>
  fetchR2: (bucket: string, key: string) => Promise<Buffer>
  log: (line: string) => void
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err
}

export async function openParquetReaderWithEpermFallback(
  filePath: string,
  deps?: Partial<Deps>,
): Promise<ParquetReader> {
  const openFile = deps?.openFile ?? parquet.ParquetReader.openFile.bind(parquet.ParquetReader)
  const openBuffer =
    deps?.openBuffer ?? parquet.ParquetReader.openBuffer.bind(parquet.ParquetReader)
  const readFile = deps?.readFile ?? fs.readFile
  const fetchR2 = deps?.fetchR2 ?? getObjectBuffer
  const log = deps?.log ?? console.log

  if (isR2Url(filePath)) {
    const { bucket, key } = parseR2Url(filePath)
    log(`[backtest] parquet open r2 bucket=${bucket} key=${key}`)
    const buf = await fetchR2(bucket, key)
    return openBuffer(buf)
  }

  try {
    return await openFile(filePath)
  } catch (err) {
    if (!isErrnoException(err) || err.code !== 'EPERM') throw err
    log(`[backtest] parquet fallback=openBuffer reason=EPERM file=${filePath}`)
    const buf = await readFile(filePath)
    return openBuffer(buf)
  }
}
