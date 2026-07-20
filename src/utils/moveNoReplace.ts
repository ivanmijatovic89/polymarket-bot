import { promises as fs } from 'node:fs'

/**
 * Atomically move a finished tmp file to the first FREE target path.
 *
 * Recorder hourly paths are fully deterministic, so a recorder restarted
 * within the same UTC hour — or two concurrent recorders on the same
 * dataset — would silently clobber the other session's rows with a plain
 * `fs.rename` (which overwrites). `fs.link` fails with EEXIST instead of
 * replacing, so the exists-check and the move are one atomic step; later
 * segments park under `-part2`, `-part3`, … and the verify CLIs (which glob
 * the recording pattern) pick them all up automatically.
 */
export async function moveNoReplace(tmpPath: string, finalPath: string): Promise<string> {
  for (let n = 1; ; n++) {
    const target = n === 1 ? finalPath : finalPath.replace(/\.parquet$/, `-part${n}.parquet`)
    try {
      await fs.link(tmpPath, target)
      await fs.unlink(tmpPath)
      return target
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
}
