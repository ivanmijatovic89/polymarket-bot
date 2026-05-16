export type R2Ref = { bucket: string; key: string }

export function isR2Url(p: string): boolean {
  return p.startsWith('r2://')
}

export function parseR2Url(url: string): R2Ref {
  if (!isR2Url(url)) {
    throw new Error(`[r2] not an r2:// url: ${url}`)
  }
  const rest = url.slice('r2://'.length)
  const slash = rest.indexOf('/')
  if (slash <= 0 || slash === rest.length - 1) {
    throw new Error(`[r2] malformed r2 url (expected r2://bucket/key): ${url}`)
  }
  return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) }
}

export function formatR2Url(bucket: string, key: string): string {
  return `r2://${bucket}/${key}`
}
