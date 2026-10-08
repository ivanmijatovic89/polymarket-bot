import { validateCatalogRecording } from './identity.js'
import type { CatalogRecording } from './types.js'
import {
  captureMarketMetadata,
  captureMarketResolution,
  type ResolvedCapturePackage,
} from '../replay/package.js'

export function catalogCapturePackage(value: CatalogRecording): ResolvedCapturePackage {
  const recording = validateCatalogRecording(value)
  const { manifest } = recording
  const manifestUrl = `r2://${recording.bucket}/${recording.manifestKey}`
  return {
    manifest,
    manifestUrl,
    filePath: manifestUrl,
    marketMeta: captureMarketMetadata(manifest),
    marketResolution: captureMarketResolution(
      manifest,
      recording.latestResolution ? [recording.latestResolution] : [],
    ),
    catalogEvidence: {
      manifestSha256: recording.manifestSha256,
      reference: recording.referenceEvidence,
    },
  }
}
