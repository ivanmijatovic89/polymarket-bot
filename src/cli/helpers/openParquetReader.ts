import { promises as fs } from 'fs'
import * as parquet from '@dsnp/parquetjs'

type ParquetReader = Awaited<ReturnType<typeof parquet.ParquetReader.openFile>>

type Deps = {
  openFile: (filePath: string) => Promise<ParquetReader>
  openBuffer: (buffer: Buffer) => Promise<ParquetReader>
  readFile: (filePath: string) => Promise<Buffer>
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
  const log = deps?.log ?? console.log

  try {
    return await openFile(filePath)
  } catch (err) {
    if (!isErrnoException(err) || err.code !== 'EPERM') throw err
    log(`[backtest] parquet fallback=openBuffer reason=EPERM file=${filePath}`)
    const buf = await readFile(filePath)
    return openBuffer(buf)
  }
}
