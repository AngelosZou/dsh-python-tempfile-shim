/**
 * Smoke test for dsh-python-tempfile-shim.
 *
 * Loads the plugin against a plain-object Cordis-like context (no real DSH
 * server needed) and asserts the behavior contract:
 *  1. apply() registers the always-on system-prompt section + the skill, and
 *     patches the mounted shell executor's resolve() (win32 only).
 *  2. Confined calls (workspace-write / read-only) get PYTHONPATH=<shim dir>
 *     added to the resolved spec's env; an existing PYTHONPATH is preserved
 *     with the shim prepended; other env entries are untouched.
 *  3. danger-full-access calls and unsandboxed compositions never get the
 *     shim (0o700 semantics stay intact there); the patch is not even
 *     installed on an executor that never confines.
 *  4. The patch is idempotent across repeated apply() and its disposer
 *     restores the original resolve().
 *  5. withShimEnv never mutates the caller's spec.
 *
 * Run: node test/smoke.mjs
 */

import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { installShellHook, withShimEnv, SHIM_DIR } from '../lib/shell-hook.js'

const registeredSections = []
const registeredSkills = []
const effects = []

function fakeShell(overrides = {}) {
  return {
    sandboxMode: 'workspace-write',
    resolveCalls: 0,
    resolve(req) {
      this.resolveCalls += 1
      return {
        ...req,
        sandboxPolicy:
          req.sandboxPolicy ?? { mode: 'workspace-write', workspaceRoot: 'D:/proj' },
      }
    },
    ...overrides,
  }
}

function makeCtx(shell) {
  const services = new Map()
  if (shell !== null) services.set('shell', shell)
  return {
    get: (name) => services.get(name),
    systemPrompt: { section: (s) => registeredSections.push(s) },
    skills: { register: (s) => registeredSkills.push(s) },
    effect: (fn) => effects.push(fn()),
  }
}

assert.equal(process.platform, 'win32', 'smoke test exercises the win32 path')

// --- 1. apply() wiring on a confined composition. -------------------------
const shell = fakeShell()
const originalResolve = shell.resolve
const ctx = makeCtx(shell)

apply(ctx)

assert.equal(registeredSections.length, 1, 'one system-prompt section registered')
assert.equal(registeredSections[0].name, 'plugin:python-tempfile-shim')
assert.equal(typeof registeredSections[0].order, 'number')
assert.ok(registeredSections[0].text.includes('automatic'), 'section says the fix is automatic')
assert.equal(registeredSkills.length, 1)
assert.equal(registeredSkills[0].name, 'python-tempfile-shim')
assert.equal(typeof registeredSkills[0].source, 'string', 'skill source is required by the loader')
assert.notEqual(shell.resolve, originalResolve, 'resolve() was patched')
assert.equal(effects.length, 1, 'the restore disposer is registered with ctx.effect')

// --- 2. Confined calls get the shim env; existing env is preserved. -------
const spec1 = shell.resolve({ command: 'python -m pytest -q tests' })
assert.ok(spec1.env && typeof spec1.env.PYTHONPATH === 'string', 'PYTHONPATH injected')
assert.ok(spec1.env.PYTHONPATH.startsWith(SHIM_DIR), 'shim dir comes first: ' + spec1.env.PYTHONPATH)
assert.equal(spec1.sandboxPolicy.mode, 'workspace-write')

const spec2 = shell.resolve({
  command: 'python -c 1',
  env: { PYTHONPATH: 'C:/elsewhere', FOO: 'bar' },
})
assert.equal(
  spec2.env.PYTHONPATH,
  `${SHIM_DIR};C:/elsewhere`,
  'existing PYTHONPATH kept, shim prepended: ' + spec2.env.PYTHONPATH,
)
assert.equal(spec2.env.FOO, 'bar', 'other env entries untouched')

const spec3 = shell.resolve({
  command: 'pytest',
  sandboxPolicy: { mode: 'read-only', workspaceRoot: 'D:/proj' },
})
assert.ok(spec3.env && spec3.env.PYTHONPATH.startsWith(SHIM_DIR), 'read-only also injected')

// --- 3. Unconfined paths must stay shim-free. -----------------------------
const spec4 = shell.resolve({
  command: 'python -c 1',
  sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: 'D:/proj' },
})
assert.equal(spec4.env, undefined, 'danger-full-access gets no shim env')

const bare = { sandboxMode: undefined }
const bareSpec = withShimEnv({ command: 'python -c 1', sandboxPolicy: undefined }, bare)
assert.equal(bareSpec.env, undefined, 'no sandbox mode -> no injection')

// Unsandboxed composition: the hook is not installed at all.
const unconfinedShell = fakeShell({ sandboxMode: undefined })
const unconfinedOriginal = unconfinedShell.resolve
const unconfinedCtx = makeCtx(unconfinedShell)
apply(unconfinedCtx)
assert.equal(unconfinedShell.resolve, unconfinedOriginal, 'unsandboxed executor untouched')
const unconfinedSpec = unconfinedShell.resolve({ command: 'python -c 1' })
assert.equal(unconfinedSpec.env, undefined, 'unsandboxed executor untouched')

// --- 4. Idempotency + disposal. -------------------------------------------
const patchedResolve = shell.resolve
apply(ctx) // re-apply (plugin reload race): must not double-wrap
assert.equal(shell.resolve, patchedResolve, 'repeat apply keeps one wrapper')
assert.equal(shell.resolveCalls, 4, 'original resolve called exactly once per wrapped call')

effects[0]() // dispose the first registration's restore
assert.equal(shell.resolve, originalResolve, 'disposer restored the original resolve')

// Re-installing after disposal works (fresh patch, single wrapper again).
const restore2 = installShellHook(ctx)
assert.notEqual(shell.resolve, originalResolve)
const spec5 = shell.resolve({ command: 'python -c 1' })
assert.ok(spec5.env.PYTHONPATH.startsWith(SHIM_DIR))
restore2()
assert.equal(shell.resolve, originalResolve, 'restore2 clean')

// --- 5. withShimEnv never mutates the caller's spec. ----------------------
const input = {
  command: 'python -c 1',
  sandboxPolicy: { mode: 'workspace-write', workspaceRoot: 'D:/proj' },
  env: { A: '1' },
}
const output = withShimEnv(input, { sandboxMode: 'workspace-write' })
assert.notEqual(output, input, 'returns a copy')
assert.equal(input.env.PYTHONPATH, undefined, 'input env untouched')
assert.deepEqual(input.env, { A: '1' })
assert.equal(output.env.A, '1')

console.log(
  `smoke OK: sections=${registeredSections.length} skills=${registeredSkills.length} ` +
    `patched=${patchedResolve !== originalResolve}`,
)
