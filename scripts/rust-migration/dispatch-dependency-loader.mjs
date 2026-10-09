/** Evidence-only loader: observe the files actually loaded by the Node oracle. */
import { appendFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context)
  if (url.startsWith('file:')) {
    appendFileSync(
      process.env.PMB_DISPATCH_DEPENDENCY_TRACE,
      `${JSON.stringify(realpathSync(fileURLToPath(url)))}\n`,
    )
  }
  return result
}
