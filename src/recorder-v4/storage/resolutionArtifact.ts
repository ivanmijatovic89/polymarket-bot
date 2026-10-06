import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { FileDigest } from './files.js'
import type { RecordedMarket, ResolutionObservation } from '../types.js'

export const RESOLUTION_CONFIRMATION_MS = 86_400_000

/** Validate derived settlement fields before local or downloaded observations are consumed. */
export function validateResolutionObservation(
  value: unknown,
  market: RecordedMarket,
): ResolutionObservation {
  const observation = value as ResolutionObservation | null
  const decimal = (item: unknown) => typeof item === 'string' && /^\d+(?:\.\d+)?$/.test(item)
  if (
    !observation ||
    Array.isArray(observation) ||
    observation.schemaVersion !== 4 ||
    observation.slug !== market.slug ||
    observation.conditionId !== market.conditionId ||
    !Number.isSafeInteger(observation.observedAtMs) ||
    observation.observedAtMs < 0 ||
    !['pending', 'proposed', 'disputed', 'resolved', 'unknown'].includes(observation.status) ||
    typeof observation.source !== 'string' ||
    typeof observation.rawJson !== 'string' ||
    (observation.priceToBeat !== null && !decimal(observation.priceToBeat)) ||
    (observation.finalPrice !== null && !decimal(observation.finalPrice))
  )
    throw new Error('Invalid resolution observation')
  if (observation.status !== 'resolved') {
    if (
      observation.winningOutcome !== null ||
      observation.winningTokenId !== null ||
      observation.payouts !== null
    )
      throw new Error('Unresolved observation contains settlement fields')
    return observation
  }
  const payouts = observation.payouts
  if (
    !payouts ||
    typeof payouts !== 'object' ||
    Array.isArray(payouts) ||
    Object.keys(payouts).length !== market.tokenIds.length ||
    market.tokenIds.some(
      (token) =>
        !Object.hasOwn(payouts, token) ||
        !decimal(payouts[token]) ||
        Number(payouts[token]) < 0 ||
        Number(payouts[token]) > 1,
    ) ||
    Math.abs(market.tokenIds.reduce((sum, token) => sum + Number(payouts[token]), 0) - 1) >= 1e-9
  )
    throw new Error('Invalid resolved payout vector')
  const winner = market.tokenIds.findIndex((token) => Number(payouts[token]) === 1)
  if (winner < 0) {
    if (observation.winningOutcome !== null || observation.winningTokenId !== null)
      throw new Error('Split resolution cannot name a winning token')
  } else if (
    observation.winningTokenId !== market.tokenIds[winner] ||
    typeof observation.winningOutcome !== 'string' ||
    observation.winningOutcome.toLowerCase() !== market.outcomes[winner]!.toLowerCase()
  )
    throw new Error('Resolved winner does not match its market payout')
  return observation
}

export function resolutionFingerprint(observation: ResolutionObservation): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        status: observation.status,
        outcome: observation.winningOutcome,
        token: observation.winningTokenId,
        payouts: observation.payouts
          ? Object.fromEntries(
              Object.entries(observation.payouts).sort(([a], [b]) => a.localeCompare(b)),
            )
          : null,
        priceToBeat: observation.priceToBeat,
        finalPrice: observation.finalPrice,
      }),
    )
    .digest('hex')
}

export function validateResolutionCompletion(
  value: unknown,
  previous: ResolutionObservation | null,
): void {
  const complete = value as { observedAtMs?: number; fingerprint?: string } | null
  if (
    !complete ||
    !Number.isSafeInteger(complete.observedAtMs) ||
    previous?.status !== 'resolved' ||
    !Number.isSafeInteger(previous.observedAtMs) ||
    complete.fingerprint !== resolutionFingerprint(previous) ||
    complete.observedAtMs! - previous.observedAtMs < RESOLUTION_CONFIRMATION_MS
  )
    throw new Error('Invalid resolution completion marker')
}

/** The filename binds both locally queued and downloaded observations to their original bytes. */
export function parseResolutionArtifact(
  body: Buffer,
  name: string,
  market: RecordedMarket,
): { observation: ResolutionObservation; digest: FileDigest } {
  const match = /^(\d+)-([a-f0-9]{64})\.json$/.exec(name)
  const digest = { sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length }
  if (!match || digest.sha256 !== match[2]) throw new Error('Resolution integrity check failed')
  const observation = validateResolutionObservation(JSON.parse(body.toString('utf8')), market)
  if (observation.observedAtMs !== Number(match[1]))
    throw new Error('Invalid resolution observation')
  return { observation, digest }
}

export async function readResolutionArtifact(file: string, market: RecordedMarket) {
  return parseResolutionArtifact(await readFile(file), path.basename(file), market)
}
