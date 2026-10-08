import { createHash } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { marketManifestSchema } from '../storage/manifest.js'
import { validateArchivePrefix } from '../storage/namespace.js'
import { validateResolutionObservation } from '../storage/resolutionArtifact.js'
import { captureManifestHash } from '../replay/provenance.js'
import type { CatalogRecording, CatalogScope } from './types.js'

export const referenceEvidenceSchema = z.object({
  websiteObserved: z.boolean(),
  openingReasons: z.array(z.string()),
})
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const recordingSchema = z.object({
  id: hashSchema,
  bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  prefix: z.string().min(1).max(200),
  manifestKey: z.string().min(1).max(1024),
  manifestSha256: hashSchema,
  manifest: marketManifestSchema,
  referenceEvidence: referenceEvidenceSchema,
  latestResolution: z.unknown().nullable(),
  resolutionKeysSha256: hashSchema,
  verifiedAtMs: z.number().int().positive(),
})
export function catalogRecordingId(bucket: string, manifestKey: string): string {
  return createHash('sha256')
    .update(JSON.stringify([bucket, manifestKey]))
    .digest('hex')
}
export function catalogScopeId(scope: CatalogScope): string {
  return createHash('sha256')
    .update(JSON.stringify([scope.bucket, scope.prefix]))
    .digest('hex')
}
export function resolutionKeysHash(keys: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([...keys].sort()))
    .digest('hex')
}

/** Exact depth excludes child namespaces such as validation from the production catalog. */
export function catalogKeyIdentity(key: string, prefix: string) {
  validateArchivePrefix(prefix)
  if (!key.startsWith(prefix + '/')) return null
  const parts = key.slice(prefix.length + 1).split('/')
  if (parts.length !== 5 && parts.length !== 6) return null
  const [symbol, timeframe, slug, recordingId, file, artifact] = parts
  const match = /^btc-updown-(5m|15m)-(\d+)$/.exec(slug ?? '')
  if (symbol !== 'btc' || !match || timeframe !== match[1] || !recordingId) return null
  const kind =
    parts.length === 5 && /^manifest-[a-f0-9]{64}\.json$/.test(file ?? '')
      ? 'manifest'
      : parts.length === 6 &&
          file === 'resolutions' &&
          /^\d+-[a-f0-9]{64}\.json$/.test(artifact ?? '')
        ? 'resolution'
        : null
  if (!kind) return null
  return {
    kind,
    directory: `${prefix}/${parts.slice(0, 4).join('/')}`,
    startMs: Number(match[2]) * 1000,
  }
}

export function validateCatalogRecording(value: unknown): CatalogRecording {
  const parsed = recordingSchema.parse(value)
  const identity = catalogKeyIdentity(parsed.manifestKey, parsed.prefix)
  if (
    !identity ||
    identity.kind !== 'manifest' ||
    parsed.id !== catalogRecordingId(parsed.bucket, parsed.manifestKey) ||
    path.posix.dirname(parsed.manifest.events.key) !== identity.directory ||
    captureManifestHash(parsed.manifest) !== parsed.manifestSha256
  )
    throw new Error('Catalog recording identity or manifest checksum is invalid')
  return {
    ...parsed,
    latestResolution:
      parsed.latestResolution == null
        ? null
        : validateResolutionObservation(parsed.latestResolution, parsed.manifest.market),
  }
}
