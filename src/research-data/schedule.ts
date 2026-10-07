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
