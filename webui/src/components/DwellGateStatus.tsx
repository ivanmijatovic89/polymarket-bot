type DwellGateSide = {
  inRange?: unknown
  elapsedInRangeMs?: unknown
  remainingMs?: unknown
}

type DwellGateSnapshot = {
  from?: unknown
  to?: unknown
  requiredMs?: unknown
  up?: DwellGateSide
  down?: DwellGateSide
}

function fmtSide(side: 'UP' | 'DOWN', s: DwellGateSide | undefined): string {
  const elapsedMs = typeof s?.elapsedInRangeMs === 'number' && Number.isFinite(s.elapsedInRangeMs) ? s.elapsedInRangeMs : null
  const remainingMs = typeof s?.remainingMs === 'number' && Number.isFinite(s.remainingMs) ? s.remainingMs : null
  if (elapsedMs === null || remainingMs === null) return `${side} n/a`
  const inSec = Math.floor(elapsedMs / 1000)
  const remainingSec = Math.ceil(remainingMs / 1000)
  return `${side} ${inSec}s in range | ${remainingSec}s`
}

function buildTitle(d: DwellGateSnapshot | undefined): string {
  const from = typeof d?.from === 'number' && Number.isFinite(d.from) ? d.from : null
  const to = typeof d?.to === 'number' && Number.isFinite(d.to) ? d.to : null
  const requiredMs = typeof d?.requiredMs === 'number' && Number.isFinite(d.requiredMs) ? d.requiredMs : null
  if (from === null || to === null || requiredMs === null) return ''
  return `range: ${from.toFixed(2)} - ${to.toFixed(2)}\nrequiredMs: ${requiredMs}`
}

function buildText(d: DwellGateSnapshot | undefined): string {
  const upInRange = d?.up && (d.up.inRange === true)
  const downInRange = d?.down && (d.down.inRange === true)
  if (upInRange) return fmtSide('UP', d?.up)
  if (downInRange) return fmtSide('DOWN', d?.down)
  return ''
}

export function DwellGateStatus(props: { dwellGate?: unknown }) {
  const d = props.dwellGate as DwellGateSnapshot | undefined
  const text = buildText(d)
  if (!text) return null
  const title = buildTitle(d)
  return (
    <span className="ml-3 font-mono cursor-help" title={title}>
      {text}
    </span>
  )
}

