/**
 * Engine identity embedded into every binary (31 §5.3):
 * PMB_ENGINE_SOURCE_HASH, PMB_ENGINE_COMMIT, PMB_ENGINE_DIRTY.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { runOk } from './host.js'
import {
  ENGINE_SOURCE_PATHSPECS,
  computeEngineSourceHash,
  isEngineSourcePath,
  sha256Hex,
  toPosix,
} from './sourceHash.js'

export type EngineIdentity = {
  sourceHash: string
  commit: string
  dirty: boolean
  /** Number of files in the engine source set (provenance). */
  fileCount: number
}

function walkFiles(root: string, rel: string, out: string[]): void {
  const abs = path.join(root, rel)
  if (!existsSync(abs)) return
  for (const ent of readdirSync(abs, { withFileTypes: true })) {
    const childRel = path.join(rel, ent.name)
    if (ent.isDirectory()) walkFiles(root, childRel, out)
    else if (ent.isFile()) out.push(toPosix(childRel))
    else if (ent.isSymbolicLink()) throw new Error(`symlink in the engine source set: ${childRel}`)
  }
}

/**
 * Compute the engine identity of the checkout at `engineRoot`. Working-tree
 * contents are hashed (tracked and untracked, not ignored). `native/build/**`
 * is listed explicitly by 31 §5.3, so it is walked on disk as well (the root
 * .gitignore's `build/` rule would otherwise hide untracked files there).
 */
export function computeEngineIdentity(engineRoot: string, env: NodeJS.ProcessEnv): EngineIdentity {
  const git = (args: string[]): string =>
    runOk('git', ['-C', engineRoot, ...args], { cwd: engineRoot, env })
  const listed = git(['ls-files', '-z', '-c', '-o', '--exclude-standard', '--', 'native'])
    .split('\0')
    .filter((p) => p !== '')
  const buildFiles: string[] = []
  walkFiles(engineRoot, 'native/build', buildFiles)
  const set = new Set<string>()
  for (const rel of [...listed, ...buildFiles]) {
    if (!isEngineSourcePath(rel)) continue
    const abs = path.join(engineRoot, rel)
    // Tracked but deleted in the working tree: not part of the working-tree contents.
    if (!existsSync(abs) || !statSync(abs).isFile()) continue
    set.add(rel)
  }
  if (!set.has('native/Cargo.toml') || !set.has('native/build/artifact-build.toml')) {
    throw new Error(
      `${engineRoot} is not an engine checkout (native/Cargo.toml or native/build/artifact-build.toml missing)`,
    )
  }
  const entries: Array<[string, string]> = [...set].map((rel) => [
    rel,
    sha256Hex(readFileSync(path.join(engineRoot, rel))),
  ])
  const sourceHash = computeEngineSourceHash(entries)

  const commit = git(['log', '-1', '--format=%H', '--', ...ENGINE_SOURCE_PATHSPECS]).trim()
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error(`cannot determine the engine commit in ${engineRoot}`)
  const status = git([
    'status',
    '--porcelain',
    '--untracked-files=all',
    '--',
    ...ENGINE_SOURCE_PATHSPECS,
  ]).trim()
  const trackedBuild = new Set(
    git(['ls-files', '-z', '--', 'native/build'])
      .split('\0')
      .filter((p) => p !== ''),
  )
  const untrackedBuild = buildFiles.some((f) => !trackedBuild.has(f))
  return { sourceHash, commit, dirty: status !== '' || untrackedBuild, fileCount: entries.length }
}
