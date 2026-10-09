import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { REPO_ROOT, canonicalJsonLoose, sha256Hex } from './cell.js'

/**
 * A scratch copy of the TS engine at the oracle pin, for patched-oracle runs
 * (60 §3.4 PM-1, `--oracle-patch`) and TS self-parity (60 OR-17): the pin's
 * sources with the parity tooling and the TS twins copied in from this
 * checkout, then the patch set applied. Built with `git archive` (no git
 * worktree is registered), never committed, never on the fleet copy.
 */

/** Paths taken from this checkout into the pin tree (OR-17: the twin and the parity tooling). */
export const TOOLING_PATHS = [
  'src/backtest/parity',
  'src/cli/parity',
  'scripts/parity',
  'src/strategies/testing',
] as const

/** Paths of the pin archived into the scratch tree. */
const PIN_PATHS = ['src', 'protocols', 'package.json', 'tsconfig.json']

export type OracleTreeInfo = {
  root: string
  pin: string
  patches: Array<{ file: string; sha256: string }>
  patchSetSha256: string | null
  /** Git tree hashes of the copied tooling at HEAD (part of the OR-12 key). */
  toolingTrees: Record<string, string>
}

function git(args: string[], cwd = REPO_ROOT): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
}

/** sha256 over the ordered patch contents; null without patches (OR-12 "patch-set sha256"). */
export function patchSetSha256(patchFiles: readonly string[]): string | null {
  if (patchFiles.length === 0) return null
  return sha256Hex(canonicalJsonLoose(patchFiles.map((f) => sha256Hex(readFileSync(f)))))
}

/**
 * Tooling paths with uncommitted changes (modified, staged or untracked) in
 * the checkout at `cwd`, from `git status --porcelain`.
 */
export function dirtyToolingPaths(cwd = REPO_ROOT): string[] {
  // Not through git(): its trim would cut the status column of the first line.
  const out = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all', '--', ...TOOLING_PATHS],
    { cwd, encoding: 'utf8' },
  )
  return out
    .split('\n')
    .filter((l) => l.length > 3)
    .map((l) => l.slice(3))
    .sort()
}

/**
 * Create (or reuse, when its marker matches) the scratch oracle tree for
 * `pin` plus `patchFiles` under `scratchRoot`. The tooling is copied from
 * the working tree but the reuse marker keys on its HEAD tree hashes, so a
 * dirty tooling tree is refused (60 OR-17, OR-12): the pin tree must hold
 * exactly the committed tooling its marker names.
 */
export function prepareOracleTree(
  pin: string,
  patchFiles: readonly string[],
  scratchRoot: string,
): OracleTreeInfo {
  const dirty = dirtyToolingPaths()
  if (dirty.length > 0)
    throw new Error(
      `--oracle-tree pin copies the parity tooling, which has uncommitted changes (60 OR-17, OR-12); commit them first: ${dirty.join(', ')}`,
    )
  const patches = patchFiles.map((f) => ({
    file: path.resolve(f),
    sha256: sha256Hex(readFileSync(f)),
  }))
  const setSha = patchSetSha256(patchFiles)
  const toolingTrees: Record<string, string> = {}
  for (const p of TOOLING_PATHS) toolingTrees[p] = git(['rev-parse', `HEAD:${p}`])
  const root = path.join(
    scratchRoot,
    `oracle-${pin.slice(0, 12)}-${setSha ? setSha.slice(0, 12) : 'nopatch'}`,
  )
  const marker = { pin, patches: patches.map((p) => p.sha256), toolingTrees }
  const markerFile = path.join(root, '.parity-oracle-tree.json')
  if (existsSync(markerFile) && readFileSync(markerFile, 'utf8') === JSON.stringify(marker))
    return { root, pin, patches, patchSetSha256: setSha, toolingTrees }
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  const tar = execFileSync('git', ['archive', '--format=tar', pin, ...PIN_PATHS], {
    cwd: REPO_ROOT,
    maxBuffer: 1024 * 1024 * 1024,
  })
  execFileSync('tar', ['-x', '-C', root], { input: tar })
  for (const p of TOOLING_PATHS) {
    rmSync(path.join(root, p), { recursive: true, force: true })
    cpSync(path.join(REPO_ROOT, p), path.join(root, p), { recursive: true })
  }
  symlinkSync(realpathSync(path.join(REPO_ROOT, 'node_modules')), path.join(root, 'node_modules'))
  for (const p of patches) git(['apply', '--whitespace=nowarn', p.file], root)
  writeFileSync(markerFile, JSON.stringify(marker))
  return { root, pin, patches, patchSetSha256: setSha, toolingTrees }
}
