/**
 * Package rules of a Rust strategy package (31 §2.2) and the lock-subset
 * rule (31 §3 item 3), enforced by `strategy:check` gate 1 and by every
 * publish (31 §7.1).
 *
 * Pure module: the caller gathers the manifest text, `cargo metadata`, the
 * lockfiles, the toolchain files, gitignore answers and bin sources.
 */

import path from 'node:path'
import {
  definedPaths,
  lockSubsetViolations,
  scanToml,
  tomlStringValue,
  type LockPackage,
} from './toml.js'

/** The subset of `cargo metadata --format-version 1` the rules read. */
export type CargoMetadataDependency = {
  name: string
  source: string | null
  kind: 'dev' | 'build' | null
  rename: string | null
  optional: boolean
  uses_default_features: boolean
  features: string[]
  target: string | null
  path?: string
}

export type CargoMetadataTarget = {
  name: string
  kind: string[]
  src_path: string
}

export type CargoMetadataPackage = {
  name: string
  version: string
  id: string
  source: string | null
  manifest_path: string
  dependencies: CargoMetadataDependency[]
  targets: CargoMetadataTarget[]
  features: Record<string, string[]>
  links: string | null
  metadata: unknown
}

export type CargoMetadata = {
  packages: CargoMetadataPackage[]
  workspace_members: string[]
  workspace_root: string
}

export type PackageRuleInput = {
  /** Package root (realpath). */
  packageRoot: string
  /** Text of `<package>/Cargo.toml`. */
  manifestText: string
  /** The package's node of `cargo metadata` (the single workspace member). */
  pkg: CargoMetadataPackage
  workspaceRoot: string
  /** Realpath of `<engine>/native/crates/pmb-sdk/Cargo.toml` when the SDK exists, else null (pre-SDK phase). */
  sdkManifest: string | null
  /** Realpath of the manifest cargo resolved for the `pmb-sdk` dependency, if any. */
  resolvedSdkManifest: string | null
  packageToolchain: string | null
  engineToolchain: string
  packageLock: LockPackage[] | null
  engineLock: LockPackage[]
  /** The package `.gitignore` has a `target` rule. */
  packageGitignoresTarget: boolean
  /** Git ignores `<repository root>/target/`. */
  repoRootIgnoresTarget: boolean
  /** Source text of every bin target, by bin name. */
  binSources: Map<string, string>
}

export type RuleReport = {
  violations: string[]
  /** Rules that cannot be checked yet (named with their reason). */
  pending: string[]
}

/** Sections and keys a strategy manifest MUST NOT define (31 §2.2). */
const FORBIDDEN_ROOTS = [
  'profile',
  'patch',
  'replace',
  'target',
  'features',
  'build-dependencies',
  'build_dependencies',
]

/** Count `strategy_main!` invocations, ignoring comments (31 §2.2, 30 §4 rule 1). */
export function countStrategyMain(source: string): number {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const noLine = noBlock.replace(/\/\/[^\n]*/g, '')
  return (noLine.match(/\bstrategy_main!\s*[({[]/g) ?? []).length
}

export function checkPackageRules(input: PackageRuleInput): RuleReport {
  const violations: string[] = []
  const pending: string[] = []
  const { pkg } = input

  // --- manifest structure (31 §2.2 rows 1-3) -------------------------------
  let paths: string[] = []
  try {
    const scan = scanToml(input.manifestText)
    paths = definedPaths(scan)
    const unsafeEntry = scan.entries.find((e) => e.path === 'lints.rust.unsafe_code')
    if (!unsafeEntry || tomlStringValue(unsafeEntry.value) !== 'forbid') {
      violations.push('Cargo.toml: `[lints.rust] unsafe_code = "forbid"` is required (30 §11)')
    }
  } catch (err) {
    violations.push(`Cargo.toml: ${err instanceof Error ? err.message : String(err)}`)
  }
  for (const p of paths) {
    const root = p.split('.')[0]!
    if (FORBIDDEN_ROOTS.includes(root))
      violations.push(
        `Cargo.toml: \`${p}\` is forbidden (no [profile], [patch], [replace], [target], [features] or build-dependencies)`,
      )
    if (
      p === 'package.build' ||
      p === 'package.links' ||
      p === 'lib.proc-macro' ||
      p === 'lib.proc_macro'
    ) {
      violations.push(`Cargo.toml: \`${p}\` is forbidden (no build script, links or proc-macro)`)
    }
  }
  if (path.resolve(input.workspaceRoot) !== path.resolve(input.packageRoot)) {
    violations.push(
      `the package is captured by the workspace at ${input.workspaceRoot}; add an empty [workspace] table`,
    )
  }
  const meta = pkg.metadata as { pmb?: { format?: unknown } } | null
  if (!meta || typeof meta !== 'object' || !meta.pmb || meta.pmb.format !== 1) {
    violations.push('Cargo.toml: `[package.metadata.pmb] format = 1` is required')
  }
  if (Object.keys(pkg.features).length > 0)
    violations.push('Cargo.toml: a [features] section is forbidden')
  if (pkg.links !== null) violations.push('Cargo.toml: `links` is forbidden')

  for (const t of pkg.targets) {
    if (t.kind.includes('custom-build')) violations.push('build.rs is forbidden (no build script)')
    if (t.kind.includes('proc-macro')) violations.push('proc-macro targets are forbidden')
  }

  // --- dependencies (31 §2.2 row 1) ----------------------------------------
  for (const d of pkg.dependencies) {
    const where =
      d.kind === 'dev' ? 'dev-dependency' : d.kind === 'build' ? 'build-dependency' : 'dependency'
    if (d.kind === 'build') {
      violations.push(`${where} ${d.name}: build-dependencies are forbidden`)
      continue
    }
    if (d.name !== 'pmb-sdk' || d.rename !== null) {
      violations.push(
        `${where} ${d.rename ?? d.name}: the only allowed dependency is pmb-sdk (D16)`,
      )
      continue
    }
    if (input.sdkManifest === null) {
      violations.push(
        `${where} pmb-sdk: native/crates/pmb-sdk does not exist in this engine checkout`,
      )
      continue
    }
    if (d.source !== null) violations.push(`${where} pmb-sdk MUST be a path dependency`)
    if (d.optional) violations.push(`${where} pmb-sdk MUST NOT be optional`)
    if (d.target !== null) violations.push(`${where} pmb-sdk MUST NOT be target-specific`)
    if (!d.uses_default_features) violations.push(`${where} pmb-sdk MUST keep default features`)
    const feats = [...d.features].sort()
    if (d.kind === 'dev') {
      if (feats.length !== 1 || feats[0] !== 'testkit') {
        violations.push(
          `${where} pmb-sdk MUST enable exactly the "testkit" feature (got ${JSON.stringify(feats)})`,
        )
      }
    } else if (feats.length !== 0) {
      violations.push(
        `${where} pmb-sdk MUST NOT enable features (got ${JSON.stringify(feats)}; real-orders is built only by strategy:build-live, 31 §5.5)`,
      )
    }
  }
  if (input.sdkManifest !== null) {
    if (!pkg.dependencies.some((d) => d.name === 'pmb-sdk' && d.kind === null)) {
      violations.push('dependency pmb-sdk (path) is required')
    }
    if (input.resolvedSdkManifest !== null && input.resolvedSdkManifest !== input.sdkManifest) {
      // D-PENDING: 31 §2.2 lets the builder resolve the effective engine root
      // from cargo metadata; chose to require that it is the checkout running
      // the builder, so the build policy and the engine are one revision.
      violations.push(
        `pmb-sdk resolves to ${input.resolvedSdkManifest}, not this engine checkout (${input.sdkManifest}); run the builder of that checkout`,
      )
    }
  } else {
    pending.push(
      'pmb-sdk dependency rule (pending pmb-sdk: native/crates/pmb-sdk does not exist yet)',
    )
  }

  // --- bins (31 §2.2 row 6) -------------------------------------------------
  const bins = pkg.targets.filter((t) => t.kind.includes('bin'))
  if (bins.length === 0)
    violations.push(
      'the package has no bin target (one bin per strategy version, src/bin/<name>.rs)',
    )
  for (const b of bins) {
    const expected = path.join(input.packageRoot, 'src', 'bin', `${b.name}.rs`)
    if (path.resolve(b.src_path) !== expected) {
      violations.push(
        `bin ${b.name}: source MUST be src/bin/${b.name}.rs (got ${path.relative(input.packageRoot, b.src_path)})`,
      )
    }
  }
  if (input.sdkManifest !== null) {
    for (const b of bins) {
      const src = input.binSources.get(b.name)
      if (src === undefined) {
        violations.push(`bin ${b.name}: source not readable`)
        continue
      }
      const n = countStrategyMain(src)
      if (n !== 1)
        violations.push(`bin ${b.name}: calls strategy_main! ${n} times, expected exactly once`)
    }
  } else {
    pending.push('strategy_main! exactly once per bin (pending pmb-sdk)')
  }

  // --- toolchain, gitignore, lock (31 §2.2 rows 4-5, §3) -------------------
  if (input.packageToolchain === null)
    violations.push('rust-toolchain.toml is missing (copy native/rust-toolchain.toml)')
  else if (input.packageToolchain !== input.engineToolchain) {
    violations.push("rust-toolchain.toml differs from the engine's native/rust-toolchain.toml")
  }
  if (!input.packageGitignoresTarget) violations.push('the package .gitignore MUST ignore target/')
  if (!input.repoRootIgnoresTarget)
    violations.push('the repository root .gitignore MUST ignore target/')
  if (input.packageLock === null) violations.push('Cargo.lock is missing (run strategy:sync-lock)')
  else {
    for (const v of lockSubsetViolations(input.packageLock, input.engineLock))
      violations.push(`Cargo.lock: ${v}`)
  }
  return { violations, pending }
}

/** True when a `.gitignore` text has a rule ignoring a top-level `target` directory. */
export function gitignoreHasTargetRule(text: string): boolean {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .some(
      (l) =>
        l === 'target' ||
        l === 'target/' ||
        l === '/target' ||
        l === '/target/' ||
        l === '**/target' ||
        l === '**/target/',
    )
}
