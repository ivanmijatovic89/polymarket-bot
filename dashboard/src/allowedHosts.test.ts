import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dashboardAllowedHosts } from './allowedHosts'

test('loopback is always allowed and legacy dev origins do not grant access', () => {
  assert.deepEqual(dashboardAllowedHosts({}), ['localhost', '127.0.0.1', '[::1]'])
  assert.deepEqual(
    dashboardAllowedHosts({ DASHBOARD_ALLOWED_DEV_ORIGINS: 'remote.test' }),
    dashboardAllowedHosts({}),
  )
})

test('configured hosts are normalized and deduplicated', () => {
  assert.deepEqual(
    dashboardAllowedHosts({
      ALLOWED_HOSTS:
        ' ,100.100.49.80,192.168.0.12:3051,https://DASHBOARD.test:443,localhost,http://[fd7a:115c:a1e0::1]:3051,100.100.49.80,',
    }),
    [
      'localhost',
      '127.0.0.1',
      '[::1]',
      '100.100.49.80',
      '192.168.0.12',
      'dashboard.test',
      '[fd7a:115c:a1e0::1]',
    ],
  )
})

test('wildcards and invalid configuration fail closed', () => {
  for (const value of [
    '*',
    '*.example.com',
    'not a host',
    'ftp://example.com',
    'http://user:password@example.com',
  ]) {
    assert.throws(() => dashboardAllowedHosts({ ALLOWED_HOSTS: value }))
  }
})
