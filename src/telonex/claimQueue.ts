// -----------------------------------------------------------------------------
// Shared work-queue claim primitives for the Telonex pipeline.
//
// telonex:download and telonex:convert both pull work from a shared MySQL queue
// under heavy multi-machine fan-out (many panes across Tailscale, one DB on the
// MacBook). They used to each reimplement the same claim loop — and repeat the
// same bug: a worker that merely lost a few claim races would conclude the queue
// was empty and quit (`done`) while thousands of rows were still pending.
//
// This module is the ONE correct implementation so every caller behaves the
// same. Add new queue consumers here rather than hand-rolling another loop.
// -----------------------------------------------------------------------------

// In-place Fisher–Yates shuffle so concurrent workers don't all attempt the same
// oldest candidate first — spreading claims across the batch cuts lost races
// under heavy fan-out.
export function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
}

// Sleep that resolves (never rejects) early when the abort signal fires.
export function sleepUntil(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const onAbort = (): void => {
      clearTimeout(t)
      resolve()
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// Claim ONE item from a batch of candidates: shuffle them, then race to claim
// each. `tryClaim` performs the atomic, single-row claim and returns the claimed
// value, or null if another worker won it / it no longer qualifies. Returns the
// first successful claim, or null if the whole batch was already taken.
export async function claimFromCandidates<C, T>(
  candidates: C[],
  tryClaim: (candidate: C) => Promise<T | null>,
): Promise<T | null> {
  shuffleInPlace(candidates)
  for (const candidate of candidates) {
    const claimed = await tryClaim(candidate)
    if (claimed != null) return claimed
  }
  return null
}

// Get a worker's next item so that DONE means DONE. Attempt a claim; if nothing
// was claimable, do NOT assume the queue is empty — an empty claim is almost
// always just contention with peers. Confirm with a real count and stop ONLY
// when zero remain. Returns the claimed item, or null only when the queue is
// genuinely drained (or aborted).
export async function claimNextOrConfirmEmpty<T>(opts: {
  claim: () => Promise<T | null>
  countRemaining: () => Promise<number>
  backoffMs: number
  signal: AbortSignal
}): Promise<T | null> {
  for (;;) {
    if (opts.signal.aborted) return null
    const item = await opts.claim()
    if (item != null) return item
    if ((await opts.countRemaining()) === 0) return null
    await sleepUntil(opts.backoffMs, opts.signal)
  }
}
