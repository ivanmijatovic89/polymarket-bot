import type { MarketManifest } from '../storage/manifest.js'
import type { ResolutionObservation } from '../types.js'
import type { PtbAdmissionEvidence } from '../replay/eligibility.js'

/** Facts about one immutable recording. Never a source of strategy price values. */
export type CatalogRecording = {
  id: string
  bucket: string
  prefix: string
  manifestKey: string
  manifestSha256: string
  manifest: MarketManifest
  referenceEvidence: PtbAdmissionEvidence
  latestResolution: ResolutionObservation | null
  resolutionKeysSha256: string
  verifiedAtMs: number
}
export type CatalogKnownRecording = Pick<
  CatalogRecording,
  'id' | 'manifestKey' | 'resolutionKeysSha256'
>
export type CatalogScope = { bucket: string; prefix: string }
export type CatalogSyncStatus = CatalogScope & {
  startedAtMs: number
  finishedAtMs: number | null
  fullScan: boolean
  discovered: number
  indexed: number
  refreshed: number
  remaining: number
  failures: Array<{ manifestKey: string; message: string }>
}
export interface CatalogRepository {
  listKnown(scope: CatalogScope, fromMs?: number): Promise<CatalogKnownRecording[]>
  get(id: string): Promise<CatalogRecording | null>
  put(recording: CatalogRecording): Promise<void>
  saveStatus(status: CatalogSyncStatus): Promise<void>
}
