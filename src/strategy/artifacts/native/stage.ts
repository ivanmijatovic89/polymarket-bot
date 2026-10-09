/**
 * Host-independent engine paths for canonical builds (31 §4.3, §5.1, D17).
 *
 * Cargo hashes the absolute path of a path dependency that lies outside the
 * workspace root into that crate's `-C metadata` (SourceId::stable_hash),
 * which changes symbol mangling, TypeIds and LC_UUID; no
 * `--remap-path-prefix` undoes it. A strategy package reaches pmb-sdk and
 * the engine crates through such a dependency, so without staging the same
 * sources would give different bytes on hosts whose engine checkouts sit at
 * different paths (measured: TypeId and sha differ between two copies of one
 * engine).
 *
 * The builder therefore runs cargo against a staged view of the package at a
 * fixed path. Cargo does not resolve symlinks in manifest or dependency
 * paths, so with `--manifest-path <STAGE_ROOT>/.pmb-package/Cargo.toml` the
 * package's relative pmb-sdk path resolves lexically under STAGE_ROOT, which
 * is the same string on every host. STAGE_ROOT mirrors the directory the
 * dependency path climbs to (one symlink per entry), so the engine crates and
 * their workspace root (`edition.workspace = true`) resolve as in the real
 * layout. The bytes then depend only on the package's dependency path text
 * below that directory (part of the hashed Cargo.toml), never on where the
 * engine or the package sits on the host.
 *
 * D-PENDING: 31 §4.2-§4.3 assume remaps make the bytes host-independent; the
 * metadata hash makes that false for path dependencies outside the package;
 * chose a fixed staging root with symlinks (remapped to /pmb/src).
 */

import { lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'

/** Fixed staging root: the same path on every host (macOS resolves /tmp to /private/tmp; cargo does not). */
export const STAGE_ROOT = '/tmp/pmb-stage'

/** Name of the staged package directory at each level below STAGE_ROOT. */
export const STAGED_PACKAGE_DIR = '.pmb-package'

/**
 * Split a relative dependency path (already lexically normalized) into the
 * number of leading `..` components and the remaining tail. The engine is
 * reached by a relative path that leaves the package (31 §2.2), so `up >= 1`.
 */
export function splitDependencyPath(rel: string): { up: number; tail: string[] } {
  if (path.posix.isAbsolute(rel) || rel === '')
    throw new Error(`not a relative dependency path: ${JSON.stringify(rel)}`)
  const parts = path.posix.normalize(rel).split('/')
  let up = 0
  while (parts[up] === '..') up++
  const tail = parts.slice(up).filter((p) => p !== '.' && p !== '')
  if (tail.includes('..')) throw new Error(`cannot normalize dependency path ${rel}`)
  return { up, tail }
}

export type StagePlan = {
  stageRoot: string
  /** The package root as cargo sees it. */
  stagedPackageRoot: string
  /** Real directories to create, parents first. */
  dirs: string[]
  /** Symlinks `[link, target]`. */
  links: Array<[string, string]>
}

/**
 * Plan the staged view (pure apart from `listDir`). `sdkRelPath` is the
 * package's pmb-sdk path dependency relative to the package root (posix), or
 * null for a package without one (pre-SDK proof package).
 */
export function planStage(args: {
  stageRoot: string
  realPackageRoot: string
  sdkRelPath: string | null
  listDir: (dir: string) => string[]
}): StagePlan {
  const { stageRoot, realPackageRoot } = args
  const up = args.sdkRelPath === null ? 1 : splitDependencyPath(args.sdkRelPath).up
  if (up === 0) {
    throw new Error(
      `pmb-sdk (${args.sdkRelPath}) lies inside the package; the engine MUST be reached by a relative path that leaves the package (31 §2.2)`,
    )
  }
  const dirs = [stageRoot]
  const links: Array<[string, string]> = []
  if (args.sdkRelPath !== null) {
    // Mirror the directory the dependency path climbs to.
    let climbed = realPackageRoot
    for (let i = 0; i < up; i++) climbed = path.dirname(climbed)
    for (const name of [...args.listDir(climbed)].sort()) {
      if (name === STAGED_PACKAGE_DIR) {
        throw new Error(
          `${path.join(climbed, name)} collides with the builder's staging directory name`,
        )
      }
      links.push([path.join(stageRoot, name), path.join(climbed, name)])
    }
  }
  let staged = stageRoot
  for (let i = 1; i < up; i++) {
    staged = path.join(staged, STAGED_PACKAGE_DIR)
    dirs.push(staged)
  }
  staged = path.join(staged, STAGED_PACKAGE_DIR)
  links.push([staged, realPackageRoot])
  return { stageRoot, stagedPackageRoot: staged, dirs, links }
}

/**
 * Remove the staging root. Refuses anything but a real directory owned by
 * this user (a planted symlink or another user's stage). rmSync unlinks the
 * symlinks inside without following them.
 */
export function removeStage(stageRoot: string): void {
  let st
  try {
    st = lstatSync(stageRoot)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  if (!st.isDirectory()) throw new Error(`${stageRoot} exists and is not a directory`)
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    throw new Error(`${stageRoot} belongs to another user (uid ${st.uid})`)
  }
  rmSync(stageRoot, { recursive: true, force: true })
}

/** Create the staged view; the caller holds the builder lock (one build at a time per host). */
export function materializeStage(plan: StagePlan): void {
  removeStage(plan.stageRoot)
  for (const d of plan.dirs) mkdirSync(d, { mode: 0o700 })
  for (const [link, target] of plan.links) symlinkSync(target, link)
}

/** Default directory lister for planStage. */
export function listDir(dir: string): string[] {
  return readdirSync(dir)
}
