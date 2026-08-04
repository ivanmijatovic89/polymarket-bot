import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { lintExternalRepo } from './externalRepoCheck.js'
import { makeFixtureRepo } from './testFixture.js'

// Regression coverage for the lint gate: it must actually EXECUTE ESLint
// against the external files (an earlier guard bug made it a silent no-op),
// and it must not hard-fail merely because external files are outside the
// engine's typed-lint tsconfig projects.

test('lintExternalRepo passes a clean external repo', () => {
  const { repoDir } = makeFixtureRepo()
  try {
    assert.equal(lintExternalRepo({ repoDir }), true)
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('lintExternalRepo fails on a rule violation (proves eslint really runs)', () => {
  const { repoDir } = makeFixtureRepo()
  try {
    // @typescript-eslint/no-unused-vars is an error in the recommended set.
    writeFileSync(path.join(repoDir, 'strategies', 'bad-lint.ts'), `const unused = 1\n`)
    assert.equal(lintExternalRepo({ repoDir }), false)
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})
