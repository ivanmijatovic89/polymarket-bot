/** Read-only inventory: artifact bytes are parsed as text and are never imported. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { lstat, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const SHA = /^[0-9a-f]{64}$/u
const REFERENCE = '07245602d6ff9bca0dcdf772134cba3dd227526c'
const MAX_PARSE_BYTES = 2 * 1024 * 1024
const MAX_METADATA_BYTES = 8 * 1024 * 1024
const hash = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex')
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort()

export function sanitizeLocation(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return value.replace(/\/\/[^/@]*@/gu, '//').split(/[?#]/u)[0]!
  }
}

function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const prop of object.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    if ((ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) && prop.name.text === name) {
      return prop.initializer
    }
  }
  return null
}

/** Literal observations do not certify executable definition or parameter semantics. */
export function inspectBundle(text: string) {
  const source = ts.createSourceFile(
    'artifact.mjs',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  const declarations = new Map<string, ts.Expression>()
  const exports = new Map<string, string>()
  const imports = new Set<string>()
  const plugins = new Set<string>()
  let opaqueModuleLoads = 0
  let dynamicModuleLoads = 0
  const walk = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      ts.isVariableStatement(node.parent.parent) &&
      ts.isSourceFile(node.parent.parent.parent)
    ) {
      declarations.set(node.name.text, node.initializer)
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier))
      imports.add(node.moduleSpecifier.text)
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
        imports.add(node.moduleSpecifier.text)
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const item of node.exportClause.elements)
          exports.set(item.name.text, (item.propertyName ?? item.name).text)
      }
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /Plugin$/u.test(node.expression.text)
    )
      plugins.add(node.expression.text)
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      dynamicModuleLoads += 1
      const arg = node.arguments[0]
      if (arg && ts.isStringLiteral(arg)) imports.add(arg.text)
      else opaqueModuleLoads += 1
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
  const resolve = (name: string): ts.Expression | null =>
    declarations.get(exports.get(name) ?? name) ?? null
  const banner = resolve('__pmbArtifact')
  const definition = resolve('definition')
  const idNode =
    definition && ts.isObjectLiteralExpression(definition) ? property(definition, 'id') : null
  const schemaNode =
    definition && ts.isObjectLiteralExpression(definition) ? property(definition, 'schema') : null
  const schema =
    schemaNode && ts.isIdentifier(schemaNode)
      ? (declarations.get(schemaNode.text) ?? schemaNode)
      : schemaNode
  const formatNode =
    banner && ts.isObjectLiteralExpression(banner) ? property(banner, 'formatVersion') : null
  const entryNode =
    banner && ts.isObjectLiteralExpression(banner) ? property(banner, 'entrypoint') : null
  return {
    parseDiagnostics: (
      (source as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? []
    ).map((d) => d.code),
    literalStrategyId: idNode && ts.isStringLiteral(idNode) ? idNode.text : null,
    banner: {
      formatVersion: formatNode && ts.isNumericLiteral(formatNode) ? Number(formatNode.text) : null,
      entrypoint: entryNode && ts.isStringLiteral(entryNode) ? entryNode.text : null,
    },
    imports: sorted(imports),
    plugins: sorted(plugins),
    dynamicModuleLoads,
    opaqueModuleLoads,
    schemaExpressionSha256: schema ? hash(schema.getText(source)) : null,
    validationContractCaptured: false,
    feedContractCaptured: false,
    executionValidated: false,
  }
}

type MetadataRow = {
  sha256: string
  strategyId: string
  entrypoint: string
  sourceRepo: string
  sourceCommit: string
  sourceDirty: boolean
  engineCommit: string
  formatVersion: number
  sizeBytes: number
  r2Url: string
  builtWith?: unknown
}
type MetadataSnapshot = { query: string; limit: number; exhausted: boolean; rows: MetadataRow[] }
type Options = {
  cacheRoots: string[]
  sourceRoots: string[]
  metadataSnapshot?: string
  reference?: string
}

function git(root: string, args: string[]): Buffer {
  return execFileSync('git', ['-C', root, ...args], {
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: MAX_METADATA_BYTES,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}
function repoKey(value: string): string {
  return sanitizeLocation(value)
    .replace(/^git@([^:]+):/u, 'https://$1/')
    .replace(/\.git\/?$/u, '')
    .replace(/\/$/u, '')
}
function safeEntrypoint(value: string): boolean {
  return (
    !path.isAbsolute(value) &&
    !value.split(/[\\/]/u).some((s) => s === '..' || s === '' || s === '.')
  )
}

export async function inventoryArtifacts(options: Options) {
  const caches: Array<Record<string, unknown>> = []
  const bySha = new Map<
    string,
    {
      sha256: string
      metadata: MetadataRow[]
      caches: Array<Record<string, unknown>>
      nativeCompatibility: string
    }
  >()
  const ensure = (sha256: string) => {
    let row = bySha.get(sha256)
    if (!row) {
      row = {
        sha256,
        metadata: [],
        caches: [],
        nativeCompatibility: 'pending-port-and-parity-evidence',
      }
      bySha.set(sha256, row)
    }
    return row
  }
  for (const requestedRoot of sorted(options.cacheRoots.map((p) => path.resolve(p)))) {
    try {
      const root = await realpath(requestedRoot)
      const names = (await readdir(root)).sort()
      const records: Array<Record<string, unknown>> = []
      for (const name of names) {
        if (!/^[0-9a-f]{64}\.mjs$/u.test(name)) {
          records.push({ filename: name, status: 'unrecognized-cache-entry' })
          continue
        }
        const sha256 = name.slice(0, -4)
        const location = path.join(root, name)
        const before = await lstat(location)
        if (!before.isFile() || before.isSymbolicLink()) {
          ensure(sha256).caches.push({ root, status: 'skipped-nonregular-file' })
          continue
        }
        const digest = createHash('sha256')
        for await (const chunk of createReadStream(location)) digest.update(chunk)
        const actualSha256 = digest.digest('hex')
        const bytes = before.size <= MAX_PARSE_BYTES ? await readFile(location) : null
        const after = await stat(location)
        const stable =
          before.size === after.size &&
          before.mtimeMs === after.mtimeMs &&
          before.ino === after.ino &&
          (!bytes || hash(bytes) === actualSha256)
        const record = {
          root,
          sizeBytes: before.size,
          actualSha256,
          hashMatchesFilename: actualSha256 === sha256,
          stable,
          status: !stable
            ? 'changed-during-capture'
            : actualSha256 !== sha256
              ? 'integrity-mismatch'
              : bytes
                ? 'static-inspection-only'
                : 'hash-only-parse-size-limit',
          observation:
            bytes && stable && actualSha256 === sha256
              ? inspectBundle(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
              : null,
        }
        ensure(sha256).caches.push(record)
        records.push({ filename: name, actualSha256, status: record.status })
      }
      caches.push({
        requestedRoot,
        root,
        status: 'observed',
        entryCount: names.length,
        snapshotSha256: hash(JSON.stringify(records)),
        nonArtifactEntries: records.filter((r) => r.status === 'unrecognized-cache-entry'),
      })
    } catch (error) {
      caches.push({
        requestedRoot,
        status: 'unavailable',
        errorCode: (error as NodeJS.ErrnoException).code ?? 'inspection-error',
      })
    }
  }
  let catalog: Record<string, unknown> = { status: 'pending', artifactCount: null }
  if (options.metadataSnapshot) {
    const metadataPath = path.resolve(options.metadataSnapshot)
    if ((await stat(metadataPath)).size > MAX_METADATA_BYTES)
      throw new Error('metadata snapshot exceeds size limit')
    const bytes = await readFile(metadataPath)
    const input = JSON.parse(bytes.toString('utf8')) as MetadataSnapshot
    if (
      !Array.isArray(input.rows) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.rows.length > input.limit ||
      typeof input.exhausted !== 'boolean' ||
      typeof input.query !== 'string'
    )
      throw new Error('invalid metadata snapshot envelope')
    const seen = new Set<string>()
    for (const row of input.rows) {
      if (
        !SHA.test(row.sha256) ||
        !/^[0-9a-f]{40}$/u.test(row.sourceCommit) ||
        !/^[0-9a-f]{40}$/u.test(row.engineCommit) ||
        typeof row.sourceDirty !== 'boolean' ||
        typeof row.strategyId !== 'string' ||
        typeof row.entrypoint !== 'string' ||
        typeof row.sourceRepo !== 'string' ||
        typeof row.r2Url !== 'string' ||
        !Number.isSafeInteger(row.formatVersion) ||
        !Number.isSafeInteger(row.sizeBytes) ||
        row.sizeBytes < 0
      )
        throw new Error('invalid metadata row')
      if (seen.has(row.sha256)) throw new Error('duplicate metadata sha256')
      seen.add(row.sha256)
      ensure(row.sha256).metadata.push({
        sha256: row.sha256,
        strategyId: row.strategyId,
        entrypoint: row.entrypoint,
        sourceRepo: sanitizeLocation(row.sourceRepo),
        sourceCommit: row.sourceCommit,
        sourceDirty: row.sourceDirty,
        engineCommit: row.engineCommit,
        formatVersion: row.formatVersion,
        sizeBytes: row.sizeBytes,
        r2Url: sanitizeLocation(row.r2Url),
        builtWith:
          row.builtWith && typeof row.builtWith === 'object'
            ? {
                esbuild: String((row.builtWith as Record<string, unknown>).esbuild ?? ''),
                node: String((row.builtWith as Record<string, unknown>).node ?? ''),
              }
            : null,
      })
    }
    catalog = {
      status:
        input.exhausted && input.rows.length < input.limit
          ? 'bounded-query-exhausted-at-observation'
          : 'truncated-or-incomplete',
      query: input.query,
      limit: input.limit,
      artifactCount: input.rows.length,
      uniqueStrategyIds: sorted(input.rows.map((r) => r.strategyId)).length,
      snapshotSha256: hash(bytes),
      consistency: 'single-query-not-cross-source-snapshot',
    }
  }
  const sourceRoots: Array<{
    root: string
    head: string
    remote: string | null
    dirtyTrackedPaths: string[]
    documentHashes: Array<{ path: string; sha256: string; pinnedHeadSha256: string | null }>
    trackedStrategySources: Array<Record<string, unknown>>
  }> = []
  for (const requested of sorted(options.sourceRoots.map((p) => path.resolve(p)))) {
    const root = await realpath(requested)
    const head = git(root, ['rev-parse', 'HEAD']).toString().trim()
    let remote: string | null = null
    try {
      remote = sanitizeLocation(git(root, ['remote', 'get-url', 'origin']).toString().trim())
    } catch {
      /* Local repositories can lack an origin. */
    }
    const dirtyTrackedPaths = git(root, ['diff', '--name-only', 'HEAD'])
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .sort()
    const documentHashes = []
    for (const rel of [
      'AGENTS.md',
      'README.md',
      'protocols/README.md',
      '_shared/ENGINE-CONTRACT.md',
      'tsconfig.json',
      'package.json',
    ]) {
      try {
        const bytes = await readFile(path.join(root, rel))
        let pinnedHeadSha256: string | null = null
        try {
          pinnedHeadSha256 = hash(git(root, ['show', `${head}:${rel}`]))
        } catch {
          /* Some tooling files are untracked. */
        }
        documentHashes.push({ path: rel, sha256: hash(bytes), pinnedHeadSha256 })
      } catch {
        /* Explicitly optional structural documents. */
      }
    }
    const trackedStrategySources: Array<Record<string, unknown>> = []
    const trackedPaths = git(root, ['ls-files', '-z', '--', '*.ts', '*.mts'])
      .toString()
      .split('\0')
      .filter(
        (p) =>
          p &&
          (p.startsWith('strategies/') || p.includes('/strategies/')) &&
          !p.split('/').some((part) => part === 'node_modules' || part === 'data'),
      )
      .sort()
    for (const rel of trackedPaths) {
      const pinnedBytes = git(root, ['show', `${head}:${rel}`])
      if (pinnedBytes.length > MAX_PARSE_BYTES) {
        trackedStrategySources.push({
          path: rel,
          pinnedHeadSha256: hash(pinnedBytes),
          status: 'hash-only-size-limit',
        })
        continue
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(pinnedBytes)
      if (!/export\s+(?:const|let|var)\s+definition\b|export\s*\{[^}]*\bdefinition\b/su.test(text))
        continue
      let currentSha256: string | null = null
      try {
        const currentPath = await realpath(path.join(root, rel))
        const relative = path.relative(root, currentPath)
        if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
          const digest = createHash('sha256')
          for await (const chunk of createReadStream(currentPath)) digest.update(chunk)
          currentSha256 = digest.digest('hex')
        }
      } catch {
        /* A removed or inaccessible working-tree source is explicit. */
      }
      trackedStrategySources.push({
        path: rel,
        pinnedHeadSha256: hash(pinnedBytes),
        currentSha256,
        workingTreeMatchesPinnedHead: currentSha256 === hash(pinnedBytes),
        registered: false,
        status: 'static-source-candidate-not-loaded-catalog',
        observation: inspectBundle(text),
      })
    }
    sourceRoots.push({
      root,
      head,
      remote,
      dirtyTrackedPaths,
      documentHashes,
      trackedStrategySources,
    })
  }
  const records = []
  for (const row of [...bySha.values()].sort((a, b) => a.sha256.localeCompare(b.sha256))) {
    const provenance = []
    for (const metadata of row.metadata) {
      const candidates = sourceRoots.filter(
        (r) =>
          repoKey(r.remote ?? r.root) === repoKey(metadata.sourceRepo) ||
          r.root === metadata.sourceRepo,
      )
      const checks = []
      for (const source of candidates) {
        let historicalEntrypointSha256: string | null = null
        let commitObjectLocal = false
        try {
          git(source.root, ['cat-file', '-e', `${metadata.sourceCommit}^{commit}`])
          commitObjectLocal = true
        } catch {
          /* No local object; remote retrieval remains pending. */
        }
        if (safeEntrypoint(metadata.entrypoint)) {
          try {
            historicalEntrypointSha256 = hash(
              git(source.root, ['show', `${metadata.sourceCommit}:${metadata.entrypoint}`]),
            )
          } catch {
            /* Missing local history, alternate publish anchor, or path. No network fetch. */
          }
        }
        checks.push({
          root: source.root,
          commitObjectLocal,
          historicalEntrypointSha256,
          status: historicalEntrypointSha256
            ? metadata.sourceDirty
              ? 'commit-file-found-dirty-publish-not-exact-source'
              : 'commit-file-found-transitive-build-reconstruction-pending'
            : 'historical-entrypoint-unavailable-or-publish-anchor-unresolved',
        })
      }
      provenance.push({
        sourceCommit: metadata.sourceCommit,
        sourceDirty: metadata.sourceDirty,
        checks,
        status: checks.length ? 'partially-inspected' : 'source-location-unmapped',
      })
    }
    records.push({
      ...row,
      sourceProvenance: provenance,
      requiredCoverage: 'pending-reference-reconciliation',
      semanticContracts: {
        schema: 'pending',
        pluginsAndFeeds: 'pending',
        sharedLiveBacktestTrace: 'pending',
      },
    })
  }
  return {
    formatVersion: 1,
    referenceRevision: options.reference ?? REFERENCE,
    inventoryStatus: 'incomplete-run-queue-remote-and-semantic-coverage',
    policy: {
      executesArtifactCode: false,
      importsArtifactCode: false,
      modifiesServices: false,
      downloadsRemoteArtifacts: false,
      parseLimitBytes: MAX_PARSE_BYTES,
      sourceGitLazyFetch: false,
    },
    catalog,
    cacheRoots: caches,
    sourceRoots,
    referenceSets: {
      runRows: { status: 'pending', count: null },
      queueJobs: { status: 'pending', count: null },
      remoteObjects: { status: 'pending', count: null },
      otherFleetCaches: { status: 'pending', count: null },
      activeLiveSelections: { status: 'pending', count: null },
    },
    summary: {
      observedImmutableShas: records.length,
      catalogRows: records.filter((r) => r.metadata.length).length,
      cacheOnlyShas: records.filter((r) => !r.metadata.length).length,
      catalogShasMissingLocalBytes: records.filter(
        (r) =>
          r.metadata.length &&
          !r.caches.some((c) => c.hashMatchesFilename === true && c.stable === true),
      ).length,
      cacheCopies: records.reduce((n, r) => n + r.caches.length, 0),
      integrityFailures: records.reduce(
        (n, r) => n + r.caches.filter((c) => c.hashMatchesFilename === false).length,
        0,
      ),
      nativePortsVerified: 0,
    },
    artifacts: records,
  }
}

async function main(): Promise<void> {
  const options: Options = { cacheRoots: [], sourceRoots: [] }
  let output: string | undefined
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    const value = args[++i]
    if (!value) throw new Error(`missing value for ${flag}`)
    if (flag === '--cache-root') options.cacheRoots.push(value)
    else if (flag === '--source-root') options.sourceRoots.push(value)
    else if (flag === '--metadata-snapshot') options.metadataSnapshot = value
    else if (flag === '--reference') options.reference = value
    else if (flag === '--output') output = value
    else throw new Error(`unknown option ${flag}`)
  }
  if (!options.cacheRoots.length || !output)
    throw new Error('explicit --cache-root and --output required')
  if (!/^[0-9a-f]{40}$/u.test(options.reference ?? REFERENCE))
    throw new Error('reference must be a full revision hash')
  const result = await inventoryArtifacts(options)
  await writeFile(output, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result.summary))
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'inventory failed')
    process.exitCode = 1
  })
}
