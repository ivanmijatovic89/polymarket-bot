/**
 * Canonical build policy of native (Rust) strategy artifacts: constants and
 * the renderer of `native/build/artifact-build.toml` (31 §4.1, §4.2).
 *
 * Pure module: no process spawning and no filesystem access.
 */

/** v1 targets aarch64-apple-darwin only (20 §1, D12). */
export const NATIVE_TARGET = 'aarch64-apple-darwin'

/** `MACOSX_DEPLOYMENT_TARGET` of 31 §4.2; recorded as `deploymentTarget` in the source hash (31 §5.2). */
export const DEPLOYMENT_TARGET = '11.0'

/** Build profiles of 31 §4.1. Only `artifact` is published or accepted downstream. */
export const BUILD_PROFILES = ['iterate', 'artifact', 'parity-check', 'profiling'] as const
export type BuildProfile = (typeof BUILD_PROFILES)[number]

export function isBuildProfile(x: string): x is BuildProfile {
  return (BUILD_PROFILES as readonly string[]).includes(x)
}

/** Native artifact format version (31 §6.2 `format_version`), independent of the JS one. */
export const NATIVE_ARTIFACT_FORMAT_VERSION = 1

/** Build manifest format version (31 §5.4). */
export const BUILD_MANIFEST_VERSION = 1

/** Engine-relative locations of the build policy (31 §2.1). */
export const BUILD_CONFIG_REL = 'native/build/artifact-build.toml'
export const CLIPPY_CONF_DIR_REL = 'native/build/clippy'
export const DYLIB_ALLOWLIST_REL = 'native/build/dylib-allowlist.txt'
export const ENGINE_TOOLCHAIN_REL = 'native/rust-toolchain.toml'
export const ENGINE_LOCK_REL = 'native/Cargo.lock'
export const PMB_SDK_MANIFEST_REL = 'native/crates/pmb-sdk/Cargo.toml'

/** Local cache directory, relative to the engine checkout (31 §6.1). */
export const NATIVE_LOCAL_CACHE_REL = 'data/strategy-artifacts/native'

/**
 * Determinism lints passed with `-F` so in-source `#[allow]` cannot weaken
 * them (30 §11, 31 §7.1 gate 3).
 */
export const DETERMINISM_LINTS = [
  'clippy::disallowed_types',
  'clippy::disallowed_methods',
  'clippy::disallowed_macros',
  'clippy::print_stdout',
  'clippy::print_stderr',
  'clippy::dbg_macro',
] as const

/** Strategy id grammar (30 §4 rule 2). */
export const STRATEGY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** Host values substituted into the build-config template (31 §4.1). */
export type BuildConfigValues = {
  CARGO_HOME: string
  RUSTUP_HOME: string
  ENGINE_ROOT: string
  ENGINE_ROOT_REALPATH: string
  TARGET_DIR: string
  PMB_ENGINE_SOURCE_HASH: string
  PMB_ENGINE_COMMIT: string
  PMB_ENGINE_DIRTY: 'true' | 'false'
  PMB_RUSTC: string
}

const PLACEHOLDER_RE = /\{\{([A-Z_]+)\}\}/g

/**
 * Render the build-config template (31 §4.1): replace every `{{NAME}}`
 * placeholder by its host value. Fails loud (00 R14) on an unknown
 * placeholder, on a value that cannot be embedded in a TOML basic string, and
 * when a value is never used. Comment lines are dropped from the rendered file
 * (they would otherwise repeat placeholder names); the unrendered template is
 * what the source hash records (31 §5.2 `buildConfig`).
 */
export function renderBuildConfig(template: string, values: BuildConfigValues): string {
  const known = new Map<string, string>(Object.entries(values))
  for (const [name, value] of known) {
    if (value === '' || /["\\\n\r\t]/.test(value) || /[\u0000-\u001f]/.test(value)) {
      throw new Error(
        `build config value ${name} cannot be embedded in TOML: ${JSON.stringify(value)}`,
      )
    }
  }
  const used = new Set<string>()
  const lines: string[] = []
  for (const raw of template.split('\n')) {
    const commentStart = findTomlCommentStart(raw)
    const code = (commentStart === -1 ? raw : raw.slice(0, commentStart)).trimEnd()
    if (code.trim() === '') continue
    lines.push(
      code.replace(PLACEHOLDER_RE, (_m, name: string) => {
        const v = known.get(name)
        if (v === undefined) throw new Error(`unknown placeholder {{${name}}} in the build config`)
        used.add(name)
        return v
      }),
    )
  }
  for (const name of known.keys()) {
    if (!used.has(name))
      throw new Error(`build config placeholder {{${name}}} is not used by the template`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Index of the `#` that starts a comment on a TOML line, or -1. Respects
 * basic ("...") and literal ('...') strings on that line.
 */
export function findTomlCommentStart(line: string): number {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote === '"') {
      if (c === '\\') i++
      else if (c === '"') quote = null
    } else if (quote === "'") {
      if (c === "'") quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === '#') return i
  }
  return -1
}

/**
 * Replace host paths by their remap targets (31 §5.4: the manifest records
 * the rendered flags "with host paths replaced by their remap targets").
 * Longest host path first, so nested prefixes map correctly.
 */
export function remapHostPaths(
  text: string,
  remaps: ReadonlyArray<readonly [string, string]>,
): string {
  const ordered = [...remaps]
    .filter(([from]) => from !== '')
    .sort((a, b) => b[0].length - a[0].length)
  let out = text
  for (const [from, to] of ordered) out = out.split(from).join(to)
  return out
}

/** The remap pairs of 31 §4.2 (plus the target-directory remap, see the template). */
export function remapPairs(values: BuildConfigValues): Array<[string, string]> {
  return [
    [values.CARGO_HOME, '/cargo'],
    [values.RUSTUP_HOME, '/rustup'],
    [values.ENGINE_ROOT, '/pmb/engine'],
    [values.ENGINE_ROOT_REALPATH, '/pmb/engine'],
    [values.TARGET_DIR, '/pmb/target'],
  ]
}
