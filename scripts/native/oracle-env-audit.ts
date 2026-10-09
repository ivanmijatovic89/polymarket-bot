/**
 * `npm run native:oracle:env-audit` — native/spec/60-verification.md §2.3 OR-7, §14.1.
 *
 * Lists every `process.env` read under the OR-2 engine paths and fails when a
 * variable is neither a pinned OR-7 knob (set explicitly for every TS oracle
 * child) nor listed in `native/parity/oracle-env-allowlist.txt` (variables that
 * provably do not affect backtest results, one per line with a reason). It runs
 * at every sync so a knob added on main cannot silently diverge the oracle.
 *
 * Recognized read forms (TypeScript AST, not a regex):
 *   process.env.X, process.env?.X, process.env['X'], process['env'].X,
 *   const { X, Y: y, Z = 'd' } = process.env, 'X' in process.env,
 *   aliases (`const env = process.env; env.X`), and helpers that read
 *   `process.env[param]` (`function envInt(name) {...}`; every call site with a
 *   string literal counts as a read of that name at the call line; helper
 *   chains are followed within the file).
 * Anything else that touches `process.env` (a dynamic key that cannot be
 * resolved, a `...rest` binding, passing the whole object on) is an opaque use
 * and fails the audit (R14), because its variable names cannot be known.
 *
 * Known limit: reads in modules OUTSIDE the engine paths that an engine-path
 * file imports are not followed (60 OR-7 scopes the grep to the OR-2 paths).
 *
 * Usage: npm run native:oracle:env-audit [-- --json] [-- --root <repo>]
 * Exit: 0 clean, 1 unlisted variables or opaque uses, 2 usage/config error.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/** 60 §2.3 OR-7 knob table, verbatim (cell values are the ts-compat defaults, 21 §6). */
export const OR7_KNOBS: ReadonlyArray<{ name: string; readAt: string; cellValue: string }> = [
  {
    name: 'BACKTEST_BINANCE_FEED_LATENCY_MS',
    readAt: 'src/backtest/feeds/wireBacktestExternalFeeds.ts',
    cellValue: '110',
  },
  {
    name: 'BACKTEST_BINANCE_FEED_LOOKBACK_MS',
    readAt: 'src/backtest/feeds/wireBacktestExternalFeeds.ts',
    cellValue: '300000',
  },
  {
    name: 'BACKTEST_RTDS_CHAINLINK_LATENCY_MS',
    readAt: 'src/backtest/feeds/wireBacktestExternalFeeds.ts',
    cellValue: '320',
  },
  {
    name: 'BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS',
    readAt: 'src/backtest/feeds/wireBacktestExternalFeeds.ts',
    cellValue: '300000',
  },
  {
    name: 'BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS',
    readAt: 'src/backtest/feeds/chainlinkCryptoPricesSource.ts',
    cellValue: '300000',
  },
  {
    name: 'BACKTEST_PRICE_TO_BEAT_LATENCY_MS',
    readAt: 'src/backtest/feeds/wireBacktestExternalFeeds.ts',
    cellValue: '2700',
  },
  { name: 'MAX_EVENTS_PER_DRAIN', readAt: 'src/trading/runnerConfig.ts', cellValue: '4200' },
  { name: 'WEB_UI_ORDERBOOK_LEVELS', readAt: 'src/market/orderbook/utils.ts', cellValue: '10' },
  {
    name: 'BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS',
    readAt: 'src/trading/StrategyRunner.ts',
    cellValue: '1 only in the TA cell',
  },
  {
    name: 'BACKTEST_TECH_IND_TIMEOUT_MS',
    readAt: 'src/trading/StrategyRunner.ts',
    cellValue: 'TA cell only',
  },
  {
    name: 'BACKTEST_TECH_IND_POLL_MS',
    readAt: 'src/trading/StrategyRunner.ts',
    cellValue: 'TA cell only',
  },
]

/** 60 §2.3 OR-7 base environment of every oracle child (data-root variables are not named by the spec). */
export const OR7_BASE_ENV: readonly string[] = ['PATH', 'HOME', 'TZ']

/**
 * 60 §2.2 OR-2 engine-semantics paths. Used only when native/parity/engine-paths.txt
 * does not exist on the branch; that file is the single source once it lands.
 */
export const OR2_FALLBACK_ENGINE_PATHS: readonly string[] = [
  'src/trading',
  'src/strategy',
  'src/market',
  'src/backtest',
  'src/parquet',
  'src/polymarket/upDownSlugWindow.ts',
  'src/polymarket/gammaMarketMeta.ts',
]

export const ENGINE_PATHS_FILE = 'native/parity/engine-paths.txt'
export const ALLOWLIST_FILE = 'native/parity/oracle-env-allowlist.txt'

export type EnvReadKind = 'property' | 'element' | 'destructure' | 'in' | 'helper-call'

export interface EnvRead {
  name: string
  file: string
  line: number
  kind: EnvReadKind
  /** Helper function name for `helper-call` reads. */
  via?: string
}

export interface OpaqueEnvUse {
  file: string
  line: number
  reason: string
  text: string
}

export interface ExtractResult {
  reads: EnvRead[]
  opaque: OpaqueEnvUse[]
}

type FunctionLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration

function unwrap(node: ts.Expression): ts.Expression {
  let n = node
  while (
    ts.isParenthesizedExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isSatisfiesExpression(n) ||
    ts.isTypeAssertionExpression(n)
  ) {
    n = n.expression
  }
  return n
}

function literalText(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined
  const n = unwrap(node)
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text
  return undefined
}

function isProcessIdentifier(node: ts.Expression): boolean {
  const n = unwrap(node)
  if (ts.isIdentifier(n)) return n.text === 'process'
  // globalThis.process
  return (
    ts.isPropertyAccessExpression(n) &&
    ts.isIdentifier(n.expression) &&
    n.expression.text === 'globalThis' &&
    n.name.text === 'process'
  )
}

/** `process.env` / `process['env']` / `globalThis.process.env`. */
function isProcessEnvExpression(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node))
    return node.name.text === 'env' && isProcessIdentifier(node.expression)
  if (ts.isElementAccessExpression(node))
    return literalText(node.argumentExpression) === 'env' && isProcessIdentifier(node.expression)
  return false
}

/** Identifier in a reference (expression) position, not a declaration name or property key. */
function isReferenceIdentifier(node: ts.Identifier): boolean {
  const p = node.parent
  if (ts.isPropertyAccessExpression(p) && p.name === node) return false
  if (ts.isPropertyAssignment(p) && p.name === node) return false
  if (ts.isVariableDeclaration(p) && p.name === node) return false
  if (ts.isParameter(p) && p.name === node) return false
  if (ts.isBindingElement(p) && (p.name === node || p.propertyName === node)) return false
  if ((ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)) && p.name === node) return false
  if (ts.isMethodDeclaration(p) && p.name === node) return false
  if (ts.isPropertyDeclaration(p) && p.name === node) return false
  if ((ts.isPropertySignature(p) || ts.isMethodSignature(p)) && p.name === node) return false
  if ((ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p)) && p.name === node)
    return false
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p)) return false
  if (ts.isNamespaceImport(p)) return false
  if (ts.isTypeReferenceNode(p) || ts.isQualifiedName(p)) return false
  return true
}

function enclosingFunction(node: ts.Node): FunctionLike | undefined {
  let n: ts.Node | undefined = node.parent
  while (n) {
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isMethodDeclaration(n)
    )
      return n
    n = n.parent
  }
  return undefined
}

function functionName(fn: FunctionLike): string | undefined {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name)
    return ts.isIdentifier(fn.name) ? fn.name.text : undefined
  if (ts.isFunctionExpression(fn) && fn.name) return fn.name.text
  const p = fn.parent
  if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text
  if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text
  if (ts.isPropertyDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text
  return undefined
}

function isExported(fn: FunctionLike): boolean {
  const target: ts.Node = ts.isVariableDeclaration(fn.parent) ? fn.parent.parent.parent : fn
  const mods = ts.canHaveModifiers(target) ? ts.getModifiers(target) : undefined
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

/** If `expr` is a parameter identifier of its enclosing named function: that helper. */
function parameterHelper(
  expr: ts.Expression,
): { name: string; index: number; exported: boolean } | undefined {
  const n = unwrap(expr)
  if (!ts.isIdentifier(n)) return undefined
  const fn = enclosingFunction(n)
  if (!fn) return undefined
  const index = fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === n.text)
  if (index < 0) return undefined
  const name = functionName(fn)
  if (!name) return undefined
  return { name, index, exported: isExported(fn) }
}

function calleeName(call: ts.CallExpression): string | undefined {
  const c = unwrap(call.expression)
  if (ts.isIdentifier(c)) return c.text
  if (ts.isPropertyAccessExpression(c) && c.expression.kind === ts.SyntaxKind.ThisKeyword)
    return c.name.text
  return undefined
}

/** Extracts every `process.env` read from one TypeScript/JavaScript source text. */
export function extractEnvReads(source: string, file: string): ExtractResult {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file))
  const reads: EnvRead[] = []
  const opaque: OpaqueEnvUse[] = []
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const textOf = (node: ts.Node) => node.getText(sf).replace(/\s+/g, ' ').slice(0, 120)
  const addOpaque = (node: ts.Node, reason: string) =>
    opaque.push({ file, line: lineOf(node), reason, text: textOf(node) })

  // Pass 1: aliases `const env = process.env` (file-scoped; a name collision fails loud as opaque).
  const aliases = new Set<string>()
  const collectAliases = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isProcessEnvExpression(unwrap(node.initializer))
    )
      aliases.add(node.name.text)
    ts.forEachChild(node, collectAliases)
  }
  collectAliases(sf)

  // helper name -> { param index, exported }
  const helpers = new Map<string, { index: number; exported: boolean; line: number }>()

  const classify = (envNode: ts.Expression): void => {
    // Climb wrappers so `(process.env as X).Y` and `process.env!.Y` classify like `process.env.Y`.
    let node: ts.Node = envNode
    while (
      ts.isParenthesizedExpression(node.parent) ||
      ts.isNonNullExpression(node.parent) ||
      ts.isAsExpression(node.parent) ||
      ts.isSatisfiesExpression(node.parent)
    )
      node = node.parent
    const p = node.parent
    if (ts.isPropertyAccessExpression(p) && p.expression === node) {
      reads.push({ name: p.name.text, file, line: lineOf(p), kind: 'property' })
      return
    }
    if (ts.isElementAccessExpression(p) && p.expression === node) {
      const lit = literalText(p.argumentExpression)
      if (lit !== undefined) {
        reads.push({ name: lit, file, line: lineOf(p), kind: 'element' })
        return
      }
      const helper = parameterHelper(p.argumentExpression)
      if (helper) {
        if (!helpers.has(helper.name))
          helpers.set(helper.name, {
            index: helper.index,
            exported: helper.exported,
            line: lineOf(p),
          })
        return
      }
      addOpaque(p, 'dynamic key that is not a parameter of a named helper')
      return
    }
    if (
      ts.isVariableDeclaration(p) &&
      p.initializer &&
      unwrap(p.initializer) === unwrap(node as ts.Expression)
    ) {
      if (ts.isIdentifier(p.name)) return // alias, handled via pass 1
      if (ts.isObjectBindingPattern(p.name)) {
        for (const el of p.name.elements) {
          if (el.dotDotDotToken) {
            addOpaque(el, 'rest binding captures unnamed variables')
            continue
          }
          const key = el.propertyName ?? el.name
          const name = ts.isIdentifier(key)
            ? key.text
            : ts.isStringLiteral(key)
              ? key.text
              : ts.isComputedPropertyName(key)
                ? literalText(key.expression)
                : undefined
          if (name === undefined) addOpaque(el, 'computed destructuring key')
          else reads.push({ name, file, line: lineOf(el), kind: 'destructure' })
        }
        return
      }
    }
    if (
      ts.isBinaryExpression(p) &&
      p.operatorToken.kind === ts.SyntaxKind.InKeyword &&
      p.right === node
    ) {
      const lit = literalText(p.left)
      if (lit !== undefined) reads.push({ name: lit, file, line: lineOf(p), kind: 'in' })
      else addOpaque(p, 'dynamic `in` check')
      return
    }
    addOpaque(p, 'process.env used as a whole object')
  }

  const visit = (node: ts.Node): void => {
    if (isProcessEnvExpression(node)) {
      // Skip `process.env` that is itself the object of an outer `process.env` match (none) and
      // the alias declaration initializer (classified as alias).
      const p = node.parent
      const isAliasInit =
        ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && aliases.has(p.name.text)
      if (!isAliasInit) classify(node as ts.Expression)
    } else if (ts.isIdentifier(node) && aliases.has(node.text) && isReferenceIdentifier(node)) {
      classify(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  // Resolve helper call sites; follow helper chains (`function a(n) { return envInt(n, 0) }`).
  const calls: ts.CallExpression[] = []
  const collectCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) calls.push(node)
    ts.forEachChild(node, collectCalls)
  }
  collectCalls(sf)
  const resolved = new Set<ts.CallExpression>()
  const callCount = new Map<string, number>()
  let changed = true
  while (changed) {
    changed = false
    for (const call of calls) {
      if (resolved.has(call)) continue
      const name = calleeName(call)
      const helper = name ? helpers.get(name) : undefined
      if (!name || !helper) continue
      resolved.add(call)
      changed = true
      callCount.set(name, (callCount.get(name) ?? 0) + 1)
      const arg = call.arguments[helper.index]
      const lit = literalText(arg)
      if (lit !== undefined) {
        reads.push({ name: lit, file, line: lineOf(call), kind: 'helper-call', via: name })
        continue
      }
      const chained = arg ? parameterHelper(arg) : undefined
      if (chained && chained.name !== name) {
        if (!helpers.has(chained.name))
          helpers.set(chained.name, {
            index: chained.index,
            exported: chained.exported,
            line: lineOf(call),
          })
        continue
      }
      addOpaque(call, `env helper \`${name}\` called with a non-literal variable name`)
    }
  }
  for (const [name, helper] of helpers) {
    if (helper.exported)
      opaque.push({
        file,
        line: helper.line,
        reason: `exported env helper \`${name}\`: call sites outside this file are not resolved`,
        text: name,
      })
  }

  reads.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name))
  opaque.sort((a, b) => a.line - b.line)
  return { reads, opaque }
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (/\.(m|c)?js$/.test(file)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/**
 * Parses native/parity/engine-paths.txt: one path per line, `#` comments. A header line
 * (`[section]` or a comment) that mentions "input format" starts the input-format section
 * (OR-2, the `src/telonex/` converters), which is excluded: converters run at conversion
 * time, not inside an oracle child.
 */
export function parseEnginePathsFile(text: string): string[] {
  const out: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (/^(#|\[)/.test(trimmed) && /input[\s_-]*format/i.test(trimmed)) break
    const line = trimmed.replace(/#.*$/, '').replace(/^-\s+/, '').trim()
    if (!line || line.startsWith('[')) continue
    out.push(line.replace(/\/+$/, ''))
  }
  return out
}

export interface AllowlistEntry {
  name: string
  reason: string
  line: number
}

/** Parses the allowlist: `NAME  # reason`; the reason is mandatory. Throws on malformed lines. */
export function parseAllowlist(text: string): AllowlistEntry[] {
  const out: AllowlistEntry[] = []
  const seen = new Set<string>()
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) return
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s+#\s*(\S.*)$/.exec(line)
    if (!m) throw new Error(`${ALLOWLIST_FILE}:${i + 1}: expected "NAME  # reason", got "${line}"`)
    if (seen.has(m[1])) throw new Error(`${ALLOWLIST_FILE}:${i + 1}: duplicate entry ${m[1]}`)
    seen.add(m[1])
    out.push({ name: m[1], reason: m[2].trim(), line: i + 1 })
  })
  return out
}

const SOURCE_RE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/
const EXCLUDED_RE = /(\.test\.|\.spec\.|\.d\.ts$|(^|\/)__tests__\/|(^|\/)fixtures?\/)/

export function listSourceFiles(root: string, relPaths: readonly string[]): string[] {
  const files: string[] = []
  const walk = (rel: string): void => {
    const abs = path.join(root, rel)
    if (!existsSync(abs)) throw new Error(`engine path does not exist: ${rel}`)
    const st = statSync(abs)
    if (st.isDirectory()) {
      for (const entry of readdirSync(abs).sort()) {
        if (entry === 'node_modules') continue
        walk(path.posix.join(rel, entry))
      }
    } else if (SOURCE_RE.test(rel) && !EXCLUDED_RE.test(rel)) {
      files.push(rel)
    }
  }
  for (const rel of relPaths) walk(rel)
  return [...new Set(files)].sort()
}

export type VariableStatus = 'or7' | 'or7-base' | 'allowlisted' | 'unlisted'

export interface AuditReport {
  enginePathsSource: string
  enginePaths: string[]
  filesScanned: number
  variables: Array<{ name: string; status: VariableStatus; reason?: string; locations: string[] }>
  opaque: OpaqueEnvUse[]
  staleAllowlist: string[]
  allowlistOverlapsOr7: string[]
  ok: boolean
}

export function audit(root: string): AuditReport {
  const pathsFile = path.join(root, ENGINE_PATHS_FILE)
  const fromFile = existsSync(pathsFile)
  const enginePaths = fromFile
    ? parseEnginePathsFile(readFileSync(pathsFile, 'utf8'))
    : [...OR2_FALLBACK_ENGINE_PATHS]
  if (enginePaths.length === 0) throw new Error(`${ENGINE_PATHS_FILE} lists no engine paths`)
  const allowPath = path.join(root, ALLOWLIST_FILE)
  if (!existsSync(allowPath)) throw new Error(`missing ${ALLOWLIST_FILE}`)
  const allowlist = parseAllowlist(readFileSync(allowPath, 'utf8'))
  const allowByName = new Map(allowlist.map((e) => [e.name, e]))
  const or7 = new Set(OR7_KNOBS.map((k) => k.name))
  const base = new Set(OR7_BASE_ENV)

  const files = listSourceFiles(root, enginePaths)
  const byName = new Map<string, string[]>()
  const opaque: OpaqueEnvUse[] = []
  for (const file of files) {
    const res = extractEnvReads(readFileSync(path.join(root, file), 'utf8'), file)
    for (const r of res.reads) {
      const loc = `${r.file}:${r.line}${r.via ? ` (via ${r.via})` : ''}`
      byName.set(r.name, [...(byName.get(r.name) ?? []), loc])
    }
    opaque.push(...res.opaque)
  }

  const variables = [...byName.keys()].sort().map((name) => {
    const locations = byName.get(name) ?? []
    if (or7.has(name)) return { name, status: 'or7' as const, locations }
    if (base.has(name)) return { name, status: 'or7-base' as const, locations }
    const allowed = allowByName.get(name)
    if (allowed) return { name, status: 'allowlisted' as const, reason: allowed.reason, locations }
    return { name, status: 'unlisted' as const, locations }
  })
  const staleAllowlist = allowlist.filter((e) => !byName.has(e.name)).map((e) => e.name)
  const allowlistOverlapsOr7 = allowlist
    .filter((e) => or7.has(e.name) || base.has(e.name))
    .map((e) => e.name)
  const ok =
    opaque.length === 0 &&
    allowlistOverlapsOr7.length === 0 &&
    variables.every((v) => v.status !== 'unlisted')
  return {
    enginePathsSource: fromFile ? ENGINE_PATHS_FILE : 'built-in OR-2 fallback (60 §2.2)',
    enginePaths,
    filesScanned: files.length,
    variables,
    opaque,
    staleAllowlist,
    allowlistOverlapsOr7,
    ok,
  }
}

export function formatReport(r: AuditReport): string {
  const lines: string[] = []
  lines.push(`oracle env audit (60 §2.3 OR-7)`)
  lines.push(`engine paths: ${r.enginePathsSource}: ${r.enginePaths.join(', ')}`)
  lines.push(`files scanned: ${r.filesScanned}; variables read: ${r.variables.length}`)
  const label: Record<VariableStatus, string> = {
    or7: 'OR-7 knob',
    'or7-base': 'OR-7 base env',
    allowlisted: 'allowlisted',
    unlisted: 'UNLISTED',
  }
  for (const v of r.variables) {
    lines.push(`  ${label[v.status].padEnd(13)} ${v.name}${v.reason ? `  — ${v.reason}` : ''}`)
    for (const loc of v.locations) lines.push(`                  ${loc}`)
  }
  const unlisted = r.variables.filter((v) => v.status === 'unlisted')
  if (unlisted.length > 0) {
    lines.push('')
    lines.push(
      `FAIL: ${unlisted.length} variable(s) neither in the OR-7 table nor in ${ALLOWLIST_FILE}:`,
    )
    for (const v of unlisted) for (const loc of v.locations) lines.push(`  ${v.name}  ${loc}`)
  }
  if (r.opaque.length > 0) {
    lines.push('')
    lines.push(
      `FAIL: ${r.opaque.length} opaque process.env use(s) (variable names cannot be resolved):`,
    )
    for (const o of r.opaque) lines.push(`  ${o.file}:${o.line}  ${o.reason}: ${o.text}`)
  }
  if (r.allowlistOverlapsOr7.length > 0) {
    lines.push('')
    lines.push(
      `FAIL: allowlist entries that are OR-7 variables (remove them): ${r.allowlistOverlapsOr7.join(', ')}`,
    )
  }
  if (r.staleAllowlist.length > 0) {
    lines.push('')
    lines.push(
      `note: allowlist entries no longer read under the engine paths: ${r.staleAllowlist.join(', ')}`,
    )
  }
  lines.push('')
  lines.push(r.ok ? 'PASS' : 'FAIL')
  return lines.join('\n')
}

function main(argv: string[]): number {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') json = true
    else if (a === '--root' && argv[i + 1]) root = path.resolve(argv[++i])
    else {
      process.stderr.write(
        `unknown argument: ${a}\nusage: oracle-env-audit [--json] [--root <repo>]\n`,
      )
      return 2
    }
  }
  let report: AuditReport
  try {
    report = audit(root)
  } catch (err) {
    process.stderr.write(`oracle env audit: ${err instanceof Error ? err.message : String(err)}\n`)
    return 2
  }
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatReport(report)}\n`)
  return report.ok ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
