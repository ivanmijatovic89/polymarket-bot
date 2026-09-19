/** Prefer the nested directory as a unit; never mix old and new state files. */
export async function protocolStatePath(
  git: (args: string[]) => Promise<string>,
  ref: string,
  protocol: string,
): Promise<string> {
  const nested = `protocols/${protocol}`
  try {
    if ((await git(['cat-file', '-t', `${ref}:${nested}`])).trim() === 'tree') {
      return `${nested}/state`
    }
  } catch {
    // Older protocol checkouts still have the workspace at the root.
  }
  return `${protocol}/state`
}
