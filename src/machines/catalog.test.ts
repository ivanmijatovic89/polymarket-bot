import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  getMachineCatalogEntry,
  listRuntimeMachines,
  machineLabel,
  resolveRuntimeMachine,
} from './catalog.js'

// These tests run against the real dashboard/src/data/machines.json — the
// catalog IS the configuration, so asserting against it also guards the
// file's shape (issue #213: runtimeUrl entries drive Mission Control).

test('listRuntimeMachines returns only machines with a runtimeUrl', () => {
  const machines = listRuntimeMachines()
  assert.ok(machines.length >= 1, 'at least one Global Runtime machine is configured')
  for (const [machineId, entry] of machines) {
    assert.match(machineId, /^[0-9a-f]{12}$/u)
    assert.match(entry.runtimeUrl ?? '', /^http:\/\/100\.\d+\.\d+\.\d+:\d+$/u)
  }
})

test('resolveRuntimeMachine accepts a friendly name or a 12-hex id', () => {
  const [machineId, entry] = listRuntimeMachines()[0]!
  const byName = resolveRuntimeMachine(entry.name)
  assert.equal(byName.machineId, machineId)
  assert.equal(byName.runtimeUrl, entry.runtimeUrl)
  const byId = resolveRuntimeMachine(machineId)
  assert.equal(byId.name, entry.name)
})

test('resolveRuntimeMachine rejects unknown machines and ones without a runtimeUrl', () => {
  assert.throws(
    () => resolveRuntimeMachine('no-such-machine'),
    /unknown machine "no-such-machine"/u,
  )
  const withoutUrl = Object.entries({ PC: 'a5288c4cae5f' }).find(
    ([, machineId]) =>
      getMachineCatalogEntry(machineId) && !getMachineCatalogEntry(machineId)?.runtimeUrl,
  )
  if (withoutUrl) {
    assert.throws(() => resolveRuntimeMachine(withoutUrl[1]), /has no runtimeUrl/u)
  }
})

test('machineLabel falls back to the raw id for unregistered machines', () => {
  assert.equal(machineLabel('ffffffffffff'), 'ffffffffffff')
})
