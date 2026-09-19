/** Exact dashboard hostnames shared by dev access and Mission Control. */
export function dashboardAllowedHosts(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  for (const entry of (env.ALLOWED_HOSTS ?? '').split(',')) {
    const value = entry.trim()
    if (!value) continue
    // Wildcards are inappropriate for the fleet control API's Host check.
    if (value.includes('*'))
      throw new Error('ALLOWED_HOSTS must contain exact hostnames, not wildcards')
    const url = new URL(value.includes('://') ? value : `http://${value}`)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      throw new Error('ALLOWED_HOSTS must contain HTTP(S) hostnames or IP addresses')
    }
    hosts.add(url.hostname.toLowerCase())
  }
  return [...hosts]
}
