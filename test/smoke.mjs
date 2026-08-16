/**
 * Smoke test for dsh-python-tempfile-shim.
 *
 * Loads the plugin against a plain-object Cordis-like context (no real DSH
 * server needed) and asserts the behavior contract:
 *  1. apply() registers python_shim + pytest_run + the skill on win32.
 *  2. Commands carry the PYTHONPATH shim injection and run through ctx.shell
 *     with the standing sandbox policy passed through (never a direct spawn).
 *  3. Denial rendering keeps the [sandbox: ...] marker but NEVER appends an
 *     escalation hint (the tools have no escalation surface by design).
 *  4. Background runs register with the jobs runtime.
 *  5. Semantic validation failures surface as {error}.
 *
 * Run: node test/smoke.mjs
 */

import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

const registeredTools = []
const registeredSkills = []
const services = new Map()
const requests = []

function fakeForeground(overrides = {}) {
  return {
    aborted: false,
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: { text: 'hello\n', truncated: false },
    stderr: { text: '', truncated: false },
    ...overrides,
  }
}

services.set('shell', {
  sandboxMode: 'workspace-write',
  resolve(req) {
    requests.push(req)
    return req
  },
  async run() {
    return fakeForeground()
  },
  start() {
    return { kill() {}, done: Promise.resolve(), readOutput: () => ({ delta: '' }) }
  },
})
services.set('shellEnv', { collect: () => ({}) })
services.set('sandboxPolicy', {
  resolve: () => ({ mode: 'workspace-write', workspaceRoot: 'D:/proj' }),
})
services.set('jobs', {
  start(spec) {
    services.set('lastJobSpec', spec)
    return 'job-1'
  },
})

const ctx = {
  tools: { register: (t) => registeredTools.push(t) },
  skills: { register: (s) => registeredSkills.push(s) },
  get: (name) => services.get(name),
}

apply(ctx)

assert.equal(process.platform, 'win32', 'smoke test exercises the win32 path')
const byName = Object.fromEntries(registeredTools.map((t) => [t.name, t]))
assert.deepEqual(Object.keys(byName).sort(), ['pytest_run', 'python_shim'])
assert.equal(registeredSkills.length, 1)
assert.equal(registeredSkills[0].name, 'python-tempfile-shim')
assert.equal(typeof registeredSkills[0].source, 'string', 'skill source is required by the loader')

const exec = {
  agent: { session: { header: { cwd: 'D:/proj' } } },
  signal: new AbortController().signal,
  callId: 't1',
}

// 1. python_shim foreground: shim injection + sandbox policy + workdir.
requests.length = 0
const out1 = await byName.python_shim.execute(
  { args: '-m pytest -q tests', description: 'Run tests' },
  exec,
)
assert.equal(out1.kind, 'foreground')
assert.equal(requests.length, 1)
const req1 = requests[0]
assert.ok(req1.command.startsWith(`$env:PYTHONPATH = '`), 'shim injection present: ' + req1.command)
assert.ok(req1.command.includes('assets'), 'shim dir path in command: ' + req1.command)
assert.ok(req1.command.endsWith('python -m pytest -q tests'), 'argv appended: ' + req1.command)
assert.deepEqual(req1.sandboxPolicy, { mode: 'workspace-write', workspaceRoot: 'D:/proj' })
assert.equal(req1.workdir, 'D:/proj')

// 2. pytest_run defaults to `python -m pytest`.
requests.length = 0
const out2 = await byName.pytest_run.execute({ description: 'Run pytest' }, exec)
assert.equal(out2.kind, 'foreground')
assert.equal(requests.length, 1)
assert.ok(requests[0].command.endsWith('python -m pytest'), requests[0].command)

// 3. Denial rendering: marker present, escalation hint ABSENT by design.
const denied = {
  ...fakeForeground({ exitCode: 1 }),
  sandbox: { mode: 'workspace-write', denied: true },
}
const rendered = byName.python_shim.output.render({}, denied)[0].text
assert.ok(rendered.includes('[sandbox: file access denied under workspace-write mode]'))
assert.ok(!rendered.includes('escalation available'), 'escalation hint must be absent by design')

// 4. Background path registers with jobs.
requests.length = 0
const out3 = await byName.pytest_run.execute(
  { description: 'Run pytest bg', run_in_background: true },
  exec,
)
assert.deepEqual(out3, { kind: 'background', jobId: 'job-1' })
assert.equal(services.get('lastJobSpec').kind, 'pytest-run')

// 5. Validation failures surface as {error}, never as a thrown crash.
const out4 = await byName.python_shim.execute({ args: '   ', description: 'x' }, exec)
assert.equal(typeof out4.error, 'string')
assert.ok(out4.error.length > 0)

console.log(
  `smoke OK: tools=${Object.keys(byName).join(',')} skills=${registeredSkills.length} requests=${requests.length}`,
)
