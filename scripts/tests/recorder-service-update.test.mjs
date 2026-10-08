import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const zsh = ['/bin/zsh', '/usr/bin/zsh'].find(existsSync)

for (const catalog of [false, true]) {
  const kind = catalog ? 'recorder-v4-catalog' : 'recorder-v4'
  const updater = path.join(repo, `ops/macos/${kind}/update-service.zsh`)
  const label = `com.polymarket.${kind}`
  const cli = catalog ? 'recorder-v4-catalog.ts' : 'record-v4.ts'
  const logName = catalog ? 'catalog.log' : 'recorder.log'
  const serviceTest = (name, options, run) => test(`${name} (${kind})`, options, run)

  function fixture(t, mode = 'success') {
    const root = mkdtempSync(path.join(os.tmpdir(), 'recorder-service-update-test-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const serviceRoot = path.join(root, 'service')
    const commit = 'a'.repeat(40)
    const release = path.join(serviceRoot, 'releases', commit)
    const oldRelease = path.join(serviceRoot, 'releases', 'b'.repeat(40))
    const logDir = path.join(root, 'logs')
    const envFile = path.join(root, 'production.env')
    const installed = path.join(root, 'installed.plist')
    const candidate = path.join(root, 'candidate.plist')
    const stateFile = path.join(root, 'state.json')
    const mockDir = path.join(root, 'bin')
    const node = path.join(root, 'nvm/v20.20.2/bin/node')
    for (const dir of [release, oldRelease, logDir, mockDir, path.dirname(node)])
      mkdirSync(dir, { recursive: true })
    for (const name of [
      'scripts/recorder-service.mjs',
      'scripts/lib/bounded-log.mjs',
      `src/cli/${cli}`,
      'node_modules/tsx/package.json',
    ]) {
      mkdirSync(path.dirname(path.join(release, name)), { recursive: true })
      writeFileSync(path.join(release, name), '{}')
    }
    writeFileSync(envFile, 'no secrets')
    writeFileSync(path.join(logDir, logName), 'keep diagnostic data')
    writeFileSync(
      node,
      `#!/bin/sh\nif [ "$1" = --version ]; then echo v20.20.2; else exec '${process.execPath}' "$@"; fi\n`,
    )
    chmodSync(node, 0o755)
    const plist = {
      Label: label,
      UserName: 'worker-2',
      GroupName: 'staff',
      ProgramArguments: [
        node,
        `${release}/scripts/recorder-service.mjs`,
        '--log-file',
        `${logDir}/${logName}`,
        '--',
        '--import',
        'tsx',
        `${release}/src/cli/${cli}`,
        ...(catalog ? ['sync', '--watch'] : []),
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
      ...(catalog ? { Nice: 10 } : {}),
      ProcessType: 'Standard',
    }
    const old = {
      ...plist,
      WorkingDirectory: oldRelease,
      ProgramArguments: [
        node,
        '--import',
        'tsx',
        `${oldRelease}/src/cli/${cli}`,
        '--env-file',
        envFile,
      ],
    }
    writeFileSync(candidate, JSON.stringify(plist))
    writeFileSync(installed, JSON.stringify(old))
    writeFileSync(
      stateFile,
      JSON.stringify({ loaded: true, pid: 111, alive: [111], calls: [], mode }),
    )
    const mock = path.join(root, 'mock.cjs')
    writeFileSync(
      mock,
      `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const file = ${JSON.stringify(stateFile)}, installed = ${JSON.stringify(installed)}, release = ${JSON.stringify(release)};
const state = JSON.parse(fs.readFileSync(file));
const name = path.basename(process.argv[1]), args = process.argv.slice(2);
const save = () => fs.writeFileSync(file, JSON.stringify(state));
if (name === 'launchctl') {
  state.calls.push(args); save();
  if (args[0] === 'print') { if (!state.loaded) process.exit(113); console.log('state = running\\npid = ' + state.pid); }
  else if (args[0] === 'disable' || args[0] === 'enable') {
    if (args[0] === 'disable' && state.mode === 'restart-stuck') {
      state.pid = 112; state.alive = [112]; state.mode = 'old-stuck'; save();
    }
  }
  else if (args[0] === 'bootout') {
    state.loaded = false;
    if (state.mode !== 'old-stuck') state.alive = state.alive.filter(p => p !== state.pid);
    save();
    if (state.mode === 'signal-stop') { state.mode = 'success'; save(); process.kill(process.ppid, 'SIGTERM'); }
  } else if (args[0] === 'bootstrap') {
    const next = JSON.parse(fs.readFileSync(installed)).WorkingDirectory === release;
    if (next && state.mode === 'fail-bootstrap') process.exit(1);
    state.loaded = true; state.pid = next ? 222 : 333; state.alive.push(state.pid); save();
    if (next && state.mode === 'signal-new') { state.mode = 'success'; save(); process.kill(process.ppid, 'SIGTERM'); }
  } else process.exit(2);
} else if (name === 'ps') { process.exit(state.alive.includes(Number(args[1])) ? 0 : 1); }
else if (name === 'git') { if (args.includes('rev-parse')) console.log(${JSON.stringify(commit)}); else if (state.mode === 'dirty') console.log(' M tracked.ts'); }
else if (name === 'stat') {
  const target = args.at(-1), format = args[1];
  if (format === '%z') console.log(state.mode === 'oversized' ? 8388609 : fs.statSync(target).size);
  else if (format === '%Su:%Lp') console.log(target === installed ? 'root:644' : 'worker-2:600');
  else console.log('worker-2');
} else if (name === 'install') {
  const from = args.at(-2), to = args.at(-1);
  if (state.mode === 'fail-install' && from.endsWith('reviewed.plist') && to === installed) process.exit(1);
  fs.copyFileSync(from, to);
} else if (name === 'plutil') { if (args.includes('-convert')) process.stdout.write(fs.readFileSync(args.at(-1))); }
else if (name === 'PlistBuddy') {
  let value = JSON.parse(fs.readFileSync(args.at(-1)));
  for (const key of args[1].slice('Print :'.length).split(':')) value = value[key];
  if (value === undefined) process.exit(1); console.log(value);
} else if (name === 'uname') console.log('Darwin');
else if (name !== 'sleep') process.exit(2);
`,
    )
    chmodSync(mock, 0o755)
    for (const name of [
      'launchctl',
      'plutil',
      'PlistBuddy',
      'git',
      'stat',
      'install',
      'ps',
      'sleep',
      'uname',
    ])
      symlinkSync(mock, path.join(mockDir, name))
    let source = readFileSync(updater, 'utf8')
      .replace(
        /^readonly service_root=.*$/m,
        `readonly service_root=${JSON.stringify(serviceRoot)}`,
      )
      .replace(
        /^readonly installed_plist=.*$/m,
        `readonly installed_plist=${JSON.stringify(installed)}`,
      )
      .replace(/^readonly env_file=.*$/m, `readonly env_file=${JSON.stringify(envFile)}`)
      .replace(/^readonly log_dir=.*$/m, `readonly log_dir=${JSON.stringify(logDir)}`)
      .replace(/^readonly required_uid=.*$/m, `readonly required_uid=${process.getuid()}`)
      .replace(/^readonly stop_wait_seconds=.*$/m, 'readonly stop_wait_seconds=2')
      .replace('/Users/worker-2/.nvm/versions/node/v20.*/bin/node', `${root}/nvm/v20.*/bin/node`)
      .replaceAll('/usr/bin/uname', path.join(mockDir, 'uname'))
    for (const [variable, name] of Object.entries({
      launchctl_bin: 'launchctl',
      plutil_bin: 'plutil',
      plist_buddy: 'PlistBuddy',
      git_bin: 'git',
      stat_bin: 'stat',
      install_bin: 'install',
      ps_bin: 'ps',
      sleep_bin: 'sleep',
    }))
      source = source.replace(
        new RegExp(`^readonly ${variable}=.*$`, 'm'),
        `readonly ${variable}=${JSON.stringify(path.join(mockDir, name))}`,
      )
    const script = path.join(root, 'update-service.zsh')
    writeFileSync(script, source)
    return {
      root,
      installed,
      candidate,
      plist,
      old,
      logDir,
      run(extra = {}) {
        const hash =
          extra.hash ?? createHash('sha256').update(readFileSync(candidate)).digest('hex')
        const result = spawnSync(zsh, [script, candidate, commit, hash], {
          encoding: 'utf8',
          timeout: 15_000,
        })
        return {
          ...result,
          state: JSON.parse(readFileSync(stateFile)),
          installed: JSON.parse(readFileSync(installed)),
        }
      },
    }
  }

  serviceTest(
    'V4 service update installs the exact reviewed template and preserves diagnostics',
    { skip: !zsh },
    (t) => {
      const f = fixture(t)
      const result = f.run()
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(result.installed, f.plist)
      assert.equal(result.state.pid, 222)
      assert.equal(readFileSync(path.join(f.logDir, logName), 'utf8'), 'keep diagnostic data')
      assert.ok(
        result.state.calls.every((args) =>
          args[0] === 'bootstrap'
            ? args[1] === 'system' && args[2] === f.installed
            : args[1] === `system/${label}`,
        ),
      )
    },
  )

  serviceTest(
    'V4 service update rejects checksum, template, dirty release and oversized log before stopping',
    { skip: !zsh },
    async (t) => {
      for (const mode of ['checksum', 'template', 'dirty', 'oversized'])
        await t.test(mode, (t) => {
          const f = fixture(t, mode)
          if (mode === 'template')
            writeFileSync(
              f.candidate,
              JSON.stringify({ ...f.plist, EnvironmentVariables: { UNSAFE: '1' } }),
            )
          const result = f.run(mode === 'checksum' ? { hash: '0'.repeat(64) } : {})
          assert.notEqual(result.status, 0)
          assert.ok(result.state.calls.every((args) => args[0] === 'print'))
          assert.deepEqual(result.installed, f.old)
        })
    },
  )

  serviceTest(
    'V4 service update restores only the previous V4 plist after installation/start failures and signals',
    { skip: !zsh },
    async (t) => {
      for (const mode of ['fail-install', 'fail-bootstrap', 'signal-stop', 'signal-new'])
        await t.test(mode, (t) => {
          const f = fixture(t, mode)
          const result = f.run()
          assert.notEqual(result.status, 0)
          assert.deepEqual(result.installed, f.old)
          assert.equal(result.state.loaded, true)
          assert.equal(result.state.pid, 333)
          assert.match(result.stderr, /Previous V4(?: catalog)? service restored/)
        })
    },
  )

  serviceTest(
    'V4 service update never bootstraps another writer while the stopped PID is alive',
    { skip: !zsh },
    async (t) => {
      for (const mode of ['old-stuck', 'restart-stuck'])
        await t.test(mode, (t) => {
          const f = fixture(t, mode)
          const result = f.run()
          assert.notEqual(result.status, 0)
          assert.equal(result.state.calls.filter((args) => args[0] === 'bootstrap').length, 0)
          assert.deepEqual(result.installed, f.old)
          assert.match(result.stderr, /remains disabled to prevent overlapping writers/)
        })
    },
  )
}
