import path from 'node:path'

const xml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

export function launchAgentPlist(options: {
  label: string
  node: string
  runner: string
  log: string
  output: string
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(options.label)}</string>
<key>ProgramArguments</key><array><string>${xml(options.node)}</string><string>${xml(options.runner)}</string></array>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
<key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Background</string>
<key>StandardErrorPath</key><string>${xml(options.log)}</string>
<key>StandardOutPath</key><string>${xml(options.output)}</string>
</dict></plist>
`
}

/** Recognize the installed runner layout, including releases created before root metadata. */
export function installedDatasetRoot(value: unknown, label: string): string {
  const plist = value as Record<string, unknown> | null
  const args = plist?.ProgramArguments
  const runner = Array.isArray(args) && args.length === 2 ? args[1] : undefined
  if (
    plist?.Label !== label ||
    typeof runner !== 'string' ||
    !path.isAbsolute(runner) ||
    path.basename(runner) !== 'nightly.mjs'
  )
    throw new Error('Unrecognized installed research job; inspect its plist before replacement')
  const runtime = path.dirname(path.dirname(runner))
  const root = path.dirname(runtime)
  if (
    path.basename(runtime) !== 'runtime' ||
    plist.StandardErrorPath !== path.join(root, 'logs', 'nightly', 'latest.log') ||
    plist.StandardOutPath !== path.join(root, 'logs', 'nightly', 'latest.json')
  )
    throw new Error('Cannot establish installed research dataset root; inspect its plist')
  return root
}
