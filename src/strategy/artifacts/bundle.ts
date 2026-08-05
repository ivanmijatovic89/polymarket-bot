import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256OfBuffer } from '../../utils/hash.js'
import { ARTIFACT_FORMAT_VERSION, type ArtifactBanner } from './types.js'

/**
 * Producer-side bundling of an external-repo strategy into a single
 * deterministic ESM artifact (see types.ts for the artifact model).
 *
 * Everything owned by the external repo (its files, its npm deps) is bundled
 * IN. Imports that resolve into this checkout's `src/` are rewritten to
 * external `#pmb/<rel>.ts` specifiers (root package.json `imports` field) so
 * the RUNNING machine's engine code is used — one class identity, engine
 * compatibility governed by the existing worker commit gate. `zod` stays
 * external for the same reason (the host calls `def.schema.safeParse`).
 *
 * The engine surface an external strategy may import is allowlisted; anything
 * else (src/db, src/cli, ...) fails the build loudly at publish time.
 */
export const ENGINE_IMPORT_ALLOWLIST = ['strategy/', 'trading/feeds/', 'market/'] as const

const DEFAULT_ENGINE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)

export type BuildStrategyArtifactArgs = {
  /** Absolute path to the external strategy repo. */
  repoDir: string
  /** Entrypoint exporting `definition`, relative to repoDir (posix separators). */
  entrypoint: string
  /** The polymarket-bot checkout providing the engine. Defaults to this one. */
  engineRoot?: string
}

export type BuildStrategyArtifactResult = {
  bytes: Buffer
  sha256: string
  banner: ArtifactBanner
  builtWith: { esbuild: string; node: string }
}

export async function buildStrategyArtifact(
  args: BuildStrategyArtifactArgs,
): Promise<BuildStrategyArtifactResult> {
  // Lazy import: workers and the live bot never load esbuild — only the
  // publish CLI (and tests) pay for it.
  const esbuild = await import('esbuild')

  // realpath both roots: esbuild resolves through symlinks (preserveSymlinks
  // is off), so a symlinked checkout path would otherwise make every
  // `path.relative(engineSrc, resolved)` comparison miss — engine files would
  // silently bundle IN, forking class identity with no error.
  const repoDir = realpathSync(path.resolve(args.repoDir))
  const engineRoot = realpathSync(path.resolve(args.engineRoot ?? DEFAULT_ENGINE_ROOT))
  const engineSrc = path.join(engineRoot, 'src')
  const entrypointAbs = path.join(repoDir, args.entrypoint)
  if (!existsSync(entrypointAbs)) {
    throw new Error(`[artifact] entrypoint not found: ${entrypointAbs}`)
  }

  // CODE-ONLY banner: no commit/dirty/repo-URL — those would fork the sha for
  // identical code (they live in the DB row / run meta instead).
  const banner: ArtifactBanner = {
    formatVersion: ARTIFACT_FORMAT_VERSION,
    entrypoint: args.entrypoint.split(path.sep).join('/'),
  }

  // Shared tail of both engine-import branches (relative paths resolving into
  // engineSrc, and hand-written `#pmb/*` specifiers): enforce the allowlist,
  // verify the target source file exists, emit the normalized external form.
  const externalizeEngineImport = (
    relPosix: string,
    importer: string,
  ): { path: string; external: true } | { errors: [{ text: string }] } => {
    // `.`/`..` segments could sneak past the prefix test (e.g.
    // `strategy/../db/index`) — Node would reject the specifier at import
    // time anyway, but the loud allowlist error belongs here.
    if (relPosix.split('/').some((seg) => seg === '.' || seg === '..')) {
      return {
        errors: [
          {
            text: `engine import must not contain "." or ".." segments: ${relPosix} (imported by ${importer})`,
          },
        ],
      }
    }
    if (!ENGINE_IMPORT_ALLOWLIST.some((prefix) => relPosix.startsWith(prefix))) {
      return {
        errors: [
          {
            text:
              `engine import not allowed for external strategies: src/${relPosix} ` +
              `(imported by ${importer}). Allowed: ${ENGINE_IMPORT_ALLOWLIST.map((p) => `src/${p}**`).join(', ')}`,
          },
        ],
      }
    }
    if (!existsSync(path.join(engineSrc, `${relPosix}.ts`))) {
      return {
        errors: [
          {
            text: `engine import does not resolve to a source file: src/${relPosix}.ts (imported by ${importer})`,
          },
        ],
      }
    }
    return { path: `#pmb/${relPosix}.ts`, external: true }
  }

  const rewriteEngineImports: import('esbuild').Plugin = {
    name: 'pmb-rewrite-engine-imports',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (a) => {
        // Hand-written `#pmb/*` engine references go through the SAME
        // allowlist as rewritten relative imports — no bypass.
        if (a.path.startsWith('#pmb/')) {
          const relPosix = a.path.slice('#pmb/'.length).replace(/\.(js|ts)$/u, '')
          return externalizeEngineImport(relPosix, a.importer)
        }
        // zod stays external: schema objects cross the artifact boundary and
        // the host consumes them (safeParse / flattenError) — one instance.
        if (a.path === 'zod' || a.path.startsWith('zod/')) {
          return { path: a.path, external: true }
        }
        const isRel = a.path.startsWith('./') || a.path.startsWith('../')
        if (!isRel && !path.isAbsolute(a.path)) return undefined // bare → bundle
        const naive = path.isAbsolute(a.path)
          ? path.normalize(a.path)
          : path.resolve(a.resolveDir, a.path)
        // realpath the DIRECTORY (the file itself may be a `.js` specifier for
        // a `.ts` file on disk): an import that reaches the engine through a
        // symlinked sibling checkout must still compare equal to engineSrc.
        const resolved = (() => {
          try {
            return path.join(realpathSync(path.dirname(naive)), path.basename(naive))
          } catch {
            return naive
          }
        })()
        const rel = path.relative(engineSrc, resolved)
        if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined // repo-own file → bundle
        const relPosix = rel
          .split(path.sep)
          .join('/')
          .replace(/\.(js|ts)$/u, '')
        return externalizeEngineImport(relPosix, a.importer)
      })
    },
  }

  const result = await esbuild.build({
    stdin: {
      contents:
        `export { definition } from ${JSON.stringify('./' + args.entrypoint.split(path.sep).join('/'))}\n` +
        `export const __pmbArtifact = ${JSON.stringify(banner)}\n`,
      resolveDir: repoDir,
      loader: 'ts',
      sourcefile: '__pmb-artifact-entry__.ts',
    },
    absWorkingDir: repoDir, // bundle path comments become repo-relative → deterministic across machines
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    minify: false,
    sourcemap: false,
    treeShaking: true,
    legalComments: 'none',
    charset: 'utf8',
    metafile: true,
    write: false,
    logLevel: 'silent',
    plugins: [rewriteEngineImports],
  })

  for (const input of Object.keys(result.metafile.inputs)) {
    const abs = path.resolve(repoDir, input)
    // Belt-and-braces: the rewrite plugin should make this unreachable, but an
    // inlined engine file would silently fork class identities — hard error.
    const relToEngine = path.relative(engineSrc, abs)
    if (!relToEngine.startsWith('..') && !path.isAbsolute(relToEngine)) {
      throw new Error(`[artifact] engine source was inlined into the bundle: ${abs}`)
    }
    // Provenance guard: every bundled input must live inside the repo (its
    // commit is what the run row records) — a `../outside.ts` escape would
    // make the artifact silently irreproducible from source_commit.
    // Exempt: any resolved path with a node_modules segment (esbuild resolves
    // symlinks, so a node_modules symlink works only when its TARGET also
    // contains a node_modules segment — an `npm link` to a plain source
    // checkout is deliberately rejected as irreproducible).
    const relToRepo = path.relative(repoDir, abs)
    const inNodeModules = abs.split(path.sep).includes('node_modules')
    if ((relToRepo.startsWith('..') || path.isAbsolute(relToRepo)) && !inNodeModules) {
      throw new Error(
        `[artifact] bundled file lies outside the strategy repo (irreproducible from its commit): ${abs}`,
      )
    }
  }

  const out = result.outputFiles?.[0]
  if (!out) throw new Error('[artifact] esbuild produced no output')
  const bytes = Buffer.from(out.contents)
  return {
    bytes,
    sha256: sha256OfBuffer(bytes),
    banner,
    builtWith: { esbuild: esbuild.version, node: process.version },
  }
}
