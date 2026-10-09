import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

export const REFERENCE_REVISION = '07245602d6ff9bca0dcdf772134cba3dd227526c'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

function sourceAt(file: string): string {
  return git(['show', `${REFERENCE_REVISION}:${file}`])
}

export function inspectStrategy(source: string, file: string) {
  // Match the source registry's cheap check, including its fail-loud treatment of bad definitions.
  if (!/^export\s+const\s+definition\b/m.test(source)) return null
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const declarations = new Map<string, ts.VariableDeclaration>()
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration)
    }
  }
  const declaration = declarations.get('definition')
  const initializer = declaration?.initializer
  const definition = initializer && ts.isObjectLiteralExpression(initializer) ? initializer : null
  const property = (name: string): ts.Expression | null => {
    const node = definition?.properties.find(
      (p) => ts.isPropertyAssignment(p) && p.name.getText(ast).replace(/^['"]|['"]$/g, '') === name,
    )
    return node && ts.isPropertyAssignment(node) ? node.initializer : null
  }
  const id = property('id')
  const schema = property('schema')
  const schemaDeclaration = schema && ts.isIdentifier(schema) ? declarations.get(schema.text) : null
  const schemaSource = schemaDeclaration?.initializer ?? schema
  const imports = ast.statements.filter(ts.isImportDeclaration).map((node) => ({
    module: ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '<nonliteral>',
    typeOnly: node.importClause?.isTypeOnly === true,
    importedNames:
      node.importClause?.namedBindings?.getText(ast) ?? node.importClause?.name?.text ?? null,
  }))
  const schemaFields = new Set<string>()
  if (schemaSource) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        if (['strictObject', 'object'].includes(node.expression.name.text)) {
          const shape = node.arguments[0]
          if (shape && ts.isObjectLiteralExpression(shape)) {
            for (const field of shape.properties) {
              if (ts.isPropertyAssignment(field)) schemaFields.add(field.name.getText(ast))
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(schemaSource)
  }
  const category = file.startsWith('protocols/')
    ? 'protocol'
    : file.includes('/research/')
      ? 'research'
      : file.includes('/templates/')
        ? 'template'
        : file.includes('/experiments/')
          ? 'experiment'
          : 'core'
  return {
    file,
    sourceSha256: hash(source),
    sourceBytes: Buffer.byteLength(source),
    definitionLine: declaration
      ? ast.getLineAndCharacterOfPosition(declaration.getStart(ast)).line + 1
      : null,
    literalId: id && ts.isStringLiteral(id) ? id.text : null,
    staticDefinitionStatus: definition ? 'object-found' : 'requires-runtime-validation',
    category,
    schema: {
      binding: schema?.getText(ast) ?? null,
      sourceSha256: schemaSource ? hash(schemaSource.getText(ast)) : null,
      fieldNames: [...schemaFields].sort(compare),
      validationContractCaptured: false,
    },
    imports,
    pluginImports: imports.filter((entry) => entry.module.includes('/plugins/')),
    runtimeCatalogStatus: 'not-captured' as string,
  }
}

// The pinned strategy initializers were reviewed: only Zod schema construction and Set allocation
// execute at module scope; factories and callbacks are not called. Plugin dependency modules define
// their transports as functions, not import-time connections. This is a reviewed baseline probe,
// not a security sandbox for arbitrary future strategy sources or external artifacts.
const REGISTRY_PROBE = String.raw`
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import childProcess from 'node:child_process';
const deny = () => { throw new Error('inventory probe prohibits network and child process effects'); };
net.Socket.prototype.connect = deny;
net.Server.prototype.listen = deny;
tls.connect = deny;
http.request = http.get = https.request = https.get = deny;
dgram.createSocket = deny;
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[key] = deny;
globalThis.fetch = deny;
syncBuiltinESMExports();
const warnings = [];
const errors = [];
const format = (args) => args.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join(' ');
console.warn = (...args) => warnings.push(format(args));
console.error = (...args) => errors.push(format(args));
console.log = (...args) => warnings.push('unexpected console.log: ' + format(args));
try {
  const { listStrategies } = await import(process.argv[1]);
  const entries = listStrategies().map((definition) => ({
    id: definition.id,
    title: definition.title ?? null,
    hasSchemaSafeParse: typeof definition.schema?.safeParse === 'function',
    hasCreate: typeof definition.create === 'function',
  })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  process.stdout.write(JSON.stringify({ status: 'captured', entries, warnings, errors }));
} catch (error) {
  process.stdout.write(JSON.stringify({ status: 'failed', entries: [], warnings, errors: [...errors, String(error)] }));
  process.exitCode = 1;
}
`

function captureRegistry() {
  if (process.versions.node.split('.')[0] !== '20')
    throw new Error('Registry capture requires Node 20')
  // Materialize the immutable pin; the user's checkout and benchmark worktree can differ or evolve.
  const snapshotRoot = mkdtempSync(path.join(tmpdir(), 'pmb-strategy-reference-'))
  const archive = execFileSync(
    'git',
    ['archive', REFERENCE_REVISION, 'src', 'protocols', 'package.json', 'package-lock.json'],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 },
  )
  try {
    execFileSync('tar', ['-xf', '-', '-C', snapshotRoot], { input: archive })
    symlinkSync(path.join(ROOT, 'node_modules'), path.join(snapshotRoot, 'node_modules'), 'dir')
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        REGISTRY_PROBE,
        pathToFileURL(path.join(snapshotRoot, 'src/strategy/strategyRegistry.ts')).href,
      ],
      {
        cwd: snapshotRoot,
        env: {
          PATH: path.dirname(process.execPath),
          NODE_ENV: 'test',
          TSX_DISABLE_CACHE: '1',
        },
        timeout: 30_000,
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
      },
    )
    const normalize = (value: string): string =>
      value.split(snapshotRoot).join('<reference-snapshot>').split(ROOT).join('<repository>')
    if (child.error || !child.stdout) {
      return {
        status: 'failed',
        nodeVersion: process.versions.node,
        entries: [],
        warnings: [],
        errors: [normalize(String(child.error ?? child.stderr))],
        processExitCode: child.status,
        referenceArchiveSha256: hash(archive),
      }
    }
    const result = JSON.parse(child.stdout) as {
      status: string
      entries: {
        id: string
        title: string | null
        hasSchemaSafeParse: boolean
        hasCreate: boolean
      }[]
      warnings: string[]
      errors: string[]
    }
    return {
      ...result,
      warnings: result.warnings.map(normalize),
      errors: result.errors.map(normalize),
      nodeVersion: process.versions.node,
      processExitCode: child.status,
      referenceArchiveSha256: hash(archive),
    }
  } finally {
    rmSync(snapshotRoot, { recursive: true, force: true })
  }
}

export function buildInventory(capture: boolean) {
  const tracked = git([
    'ls-tree',
    '-r',
    '--name-only',
    REFERENCE_REVISION,
    '--',
    'src/strategies',
    'protocols',
  ])
    .trim()
    .split('\n')
    .filter((file) => file.endsWith('.ts'))
    .sort(compare)
  const candidates = tracked.flatMap((file) => {
    const entry = inspectStrategy(sourceAt(file), file)
    return entry ? [entry] : []
  })
  const registry = capture
    ? captureRegistry()
    : {
        status: 'not-captured',
        entries: [],
        warnings: [],
        errors: [],
        nodeVersion: null,
        processExitCode: null,
      }
  const loaded = new Set(registry.entries.map((entry) => entry.id))
  for (const candidate of candidates) {
    candidate.runtimeCatalogStatus =
      registry.status === 'captured'
        ? candidate.literalId && loaded.has(candidate.literalId)
          ? 'id-present-in-loaded-catalog'
          : 'not-in-loaded-catalog'
        : registry.status
  }
  const grouped = Object.fromEntries(
    ['core', 'research', 'template', 'experiment', 'protocol'].map((category) => [
      category,
      candidates.filter((entry) => entry.category === category).length,
    ]),
  )
  const consumerPaths = git([
    'grep',
    '-l',
    '-E',
    'strategyRegistry|artifacts/(loader|publish|bundle)|strategy-artifact|strategy-file',
    REFERENCE_REVISION,
    '--',
    'src',
    'scripts',
    'protocols',
  ])
    .trim()
    .split('\n')
    .map((file) => file.slice(REFERENCE_REVISION.length + 1))
    .sort(compare)
  const loadedWithoutStaticId = registry.entries.filter(
    (entry) => !candidates.some((candidate) => candidate.literalId === entry.id),
  )
  const duplicateLiteralIds = candidates
    .filter(
      (entry, index) =>
        entry.literalId !== null &&
        candidates.findIndex((candidate) => candidate.literalId === entry.literalId) !== index,
    )
    .map((entry) => entry.literalId)
  const staticSnapshotSha256 = hash(
    JSON.stringify(candidates.map(({ runtimeCatalogStatus: _, ...entry }) => entry)),
  )
  const registrySnapshotSha256 = hash(JSON.stringify(registry))
  return {
    formatVersion: 1,
    referenceRevision: REFERENCE_REVISION,
    referenceTree: git(['rev-parse', `${REFERENCE_REVISION}^{tree}`]).trim(),
    packageLockSha256: hash(sourceAt('package-lock.json')),
    staticSnapshotSha256,
    registrySnapshotSha256,
    inventoryStatus: 'incomplete-external-artifacts-and-validation-contracts',
    method:
      'Pinned tracked sources parsed with TypeScript AST without executing strategy factories. Loaded catalog is a separate optional reviewed Node 20 probe.',
    limitations: [
      'Static candidates are not proof of runtime registration or native implementation.',
      'An ID present in the catalog does not prove which duplicate candidate won; preserve discovery warnings.',
      'Schema field names and source identity are not a complete defaults/coercions/refinement compatibility contract.',
      'Only tracked baseline candidates are inventoried; subsequent strategy additions require reconciliation.',
      'External immutable .mjs artifacts and external strategy repositories remain a required pending inventory; zero coverage is not assumed.',
    ],
    counts: {
      trackedCandidateFiles: candidates.length,
      categories: grouped,
      loadedCatalogEntries: registry.entries.length,
    },
    candidates,
    loadedCatalog: registry,
    comparison: { loadedWithoutStaticId, duplicateLiteralIds },
    consumerPaths,
    externalArtifacts: {
      status: 'pending',
      references: null,
      sourceAvailability: null,
      nextAction:
        'Enumerate immutable references from queued/historical runs and structurally inspect local/R2 artifact catalogs; identify required external sources and native equivalents.',
    },
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const capture = args.includes('--capture-registry')
  const outputIndex = args.indexOf('--output')
  const output = outputIndex >= 0 ? args[outputIndex + 1] : undefined
  if (outputIndex >= 0 && !output) throw new Error('--output requires a path')
  const inventory = buildInventory(capture)
  const json = `${JSON.stringify(inventory, null, 2)}\n`
  if (output) writeFileSync(path.resolve(ROOT, output), json)
  else process.stdout.write(json)
  if (capture && inventory.loadedCatalog.status !== 'captured') process.exitCode = 1
}
