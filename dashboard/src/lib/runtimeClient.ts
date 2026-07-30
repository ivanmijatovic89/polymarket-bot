// Browser-side client for the Global Runtime daemon, routed through the
// dashboard's server-side proxy so the browser never talks to :3053 directly.
export async function runtimeFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/mission-control${path}`, { ...init, cache: 'no-store' })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String(payload.error)
        : `Request failed (${response.status})`
    throw new Error(message)
  }
  return payload as T
}
