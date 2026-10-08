import { isDeepStrictEqual } from 'node:util'

export function validateCatalogServicePlist(value, { node, release, envFile, logDir }) {
  const expected = {
    Label: 'com.polymarket.recorder-v4-catalog',
    UserName: 'worker-2',
    GroupName: 'staff',
    ProgramArguments: [
      node,
      `${release}/scripts/recorder-service.mjs`,
      '--log-file',
      `${logDir}/catalog.log`,
      '--',
      '--import',
      'tsx',
      `${release}/src/cli/recorder-v4-catalog.ts`,
      'sync',
      '--watch',
      '--env-file',
      envFile,
    ],
    WorkingDirectory: release,
    StandardOutPath: '/dev/null',
    StandardErrorPath: '/dev/null',
    RunAtLoad: true,
    KeepAlive: { SuccessfulExit: false },
    ThrottleInterval: 60,
    ExitTimeOut: 60,
    Nice: 10,
    ProcessType: 'Standard',
  }
  if (!isDeepStrictEqual(value, expected))
    throw new Error('Catalog plist differs from the reviewed service template')
}
