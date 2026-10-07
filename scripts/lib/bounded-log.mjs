import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import path from 'node:path'

/** A single writer owns each descriptor; rotation never truncates another process's open file. */
export class BoundedLog {
  constructor(file, { maxBytes = 8 * 1024 ** 2, archives = 3 } = {}) {
    if (
      !path.isAbsolute(file) ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      !Number.isSafeInteger(archives) ||
      archives < 1 ||
      archives > 10
    )
      throw new Error('Invalid bounded log configuration')
    this.file = file
    this.maxBytes = maxBytes
    this.archives = archives
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    for (let i = 0; i <= archives; i++) {
      const candidate = i === 0 ? file : `${file}.${i}`
      const info = lstatSync(candidate, { throwIfNoEntry: false })
      if (info && !info.isFile()) throw new Error('Log destination must be a regular file')
    }
    this.bytes = existsSync(file) ? lstatSync(file).size : 0
    this.fd = openSync(
      file,
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    )
    if (this.bytes > maxBytes) {
      // Existing oversized files are not silently discarded during installation.
      this.close()
      throw new Error('Existing log exceeds its budget; archive it before activating this service')
    }
    for (let i = 1; i <= archives; i++) {
      if (existsSync(`${file}.${i}`) && lstatSync(`${file}.${i}`).size > maxBytes) {
        this.close()
        throw new Error('Existing log archive exceeds its budget')
      }
    }
  }
  rotate() {
    closeSync(this.fd)
    this.fd = null
    if (existsSync(`${this.file}.${this.archives}`)) unlinkSync(`${this.file}.${this.archives}`)
    for (let i = this.archives - 1; i >= 1; i--)
      if (existsSync(`${this.file}.${i}`)) renameSync(`${this.file}.${i}`, `${this.file}.${i + 1}`)
    renameSync(this.file, `${this.file}.1`)
    this.fd = openSync(
      this.file,
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    )
    this.bytes = 0
  }
  write(chunk) {
    if (this.fd === null) throw new Error('Log is closed')
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    let offset = 0
    while (offset < bytes.length) {
      if (this.bytes === this.maxBytes) this.rotate()
      const length = Math.min(this.maxBytes - this.bytes, bytes.length - offset)
      const written = writeSync(this.fd, bytes, offset, length)
      if (written === 0) throw new Error('Log write made no progress')
      this.bytes += written
      offset += written
    }
  }
  close() {
    if (this.fd !== null) closeSync(this.fd)
    this.fd = null
  }
}
