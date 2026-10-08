import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { validateCatalogServicePlist } from '../lib/catalog-service-plist.mjs'
const paths = { node: '/node20', release: '/release', envFile: '/config', logDir: '/logs' }
const plist = {
  Label: 'com.polymarket.recorder-v4-catalog',
  UserName: 'worker-2',
  GroupName: 'staff',
  ProgramArguments: [
    '/node20',
    '/release/scripts/recorder-service.mjs',
    '--log-file',
    '/logs/catalog.log',
    '--',
    '--import',
    'tsx',
    '/release/src/cli/recorder-v4-catalog.ts',
    'sync',
    '--watch',
    '--env-file',
    '/config',
  ],
  WorkingDirectory: '/release',
  StandardOutPath: '/dev/null',
  StandardErrorPath: '/dev/null',
  RunAtLoad: true,
  KeepAlive: { SuccessfulExit: false },
  ThrottleInterval: 60,
  ExitTimeOut: 60,
  Nice: 10,
  ProcessType: 'Standard',
}
test('catalog service requires its own exact command, identity and bounded logger', () => {
  validateCatalogServicePlist(plist, paths)
  for (const change of [
    { Label: 'com.polymarket.recorder-v4' },
    { UserName: 'root' },
    { EnvironmentVariables: { WALLET: 'forbidden' } },
    { WorkingDirectory: '/fleet' },
    { ProgramArguments: ['trade:bot'] },
    { StandardOutPath: '/unbounded.log' },
  ])
    assert.throws(() => validateCatalogServicePlist({ ...plist, ...change }, paths), /differs/)
})
test('installer controls only the new catalog label and refuses to replace an existing service', () => {
  const script = readFileSync(
    new URL('../../ops/macos/recorder-v4-catalog/install-service.zsh', import.meta.url),
    'utf8',
  )
  assert.match(script, /Catalog service is already installed/)
  assert.match(script, /Plist checksum differs/)
  assert.doesNotMatch(script, /bootout|kickstart|recorder-v3|spool/)
  assert.match(script, /target=system\/com\.polymarket\.recorder-v4-catalog/)
})
