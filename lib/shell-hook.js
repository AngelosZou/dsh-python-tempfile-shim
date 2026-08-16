/**
 * Executor-level injection hook — the "fundamental" half of the plugin.
 *
 * Instead of wrapping every Python invocation in a dedicated tool, this
 * patches the ONE mounted shell executor's `resolve()` — the request→spec
 * chokepoint every shell consumer passes through (the pwsh/bash tools,
 * background jobs, in-process plugin bridges) — so that every CONFINED
 * command inherits `PYTHONPATH=<shim dir>`. The bundled sitecustomize then
 * fixes the 0o700 temp-directory clash for ANY `python`/`py`/`pytest`/`pip`/
 * `tox`/`nox` run, including subprocesses, without extra tools, without
 * per-command wrapping, and without spending model context on workarounds.
 *
 * Why `resolve()` and why the instance patch:
 * - `ctx.shell` is a single long-lived executor instance (a second provider
 *   throws on duplicate service registration), so an instance-level patch
 *   reaches every consumer at once.
 * - `resolve()` runs AFTER the sandboxing executor stamps the per-call
 *   policy (`request.sandboxPolicy ?? ctx.sandboxPolicy.resolve()`), so the
 *   effective mode is known exactly there: the pwsh sandbox subclass calls
 *   `super.resolve` first, then runs `danger-full-access` unconfined and the
 *   confined modes through `ctx.sandbox.confine`. Injecting earlier (on the
 *   raw request) could not see that decision.
 * - The patched function composes with whatever executor is mounted
 *   (pwsh-local, pwsh-sandbox, future providers): it only reads the resolved
 *   spec and adds one `env` entry, the documented `ShellExecRequest.env`
 *   seam that subprocess-local merges after the credential scrub and the
 *   windows-acl runner inherits into the restricted-token child.
 *
 * Gating keeps the shim strictly inside confinement:
 * - Executors that never sandbox (`sandboxMode === undefined`) are left
 *   untouched — the incompatibility cannot occur there.
 * - `danger-full-access` calls are unconfined: CPython's 0o700 privacy
 *   default stays intact for them.
 * - Only `read-only`/`workspace-write` calls get the entry. `PYTHONPATH` is
 *   inert for non-Python commands, so adding it to every confined command is
 *   safe; a command that sets `$env:PYTHONPATH` itself still overrides it.
 *
 * Idempotency/disposal: the wrapper is tagged with a symbol on the executor
 * instance so plugin reloads never double-wrap, and the returned disposer
 * restores the original method (registered through `ctx.effect` by the
 * caller, so composition teardown unwinds it).
 *
 * Known limitation: if the shell EXECUTOR plugin itself is hot-reloaded
 * (dev-time HMR) it mounts a fresh instance without this patch until this
 * plugin also reloads. A DSH restart is the standard remedy.
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
/** Absolute path of the bundled shim directory (assets/sitecustomize.py). */
export const SHIM_DIR = join(here, '..', 'assets')

/** Symbol keyed on the executor instance; holds the patch record (reload-safe). */
const PATCHED = Symbol.for('dsh-python-tempfile-shim.resolve-patch')

/** The confined modes this plugin exists to fix. */
const CONFINED = new Set(['read-only', 'workspace-write'])

/** Windows PYTHONPATH separator (the plugin only loads on win32). */
const PATH_SEP = ';'

/**
 * Add the shim to one resolved spec's env when the run is confined.
 * Returns the spec unchanged otherwise; never mutates the caller's spec.
 *
 * @param spec - the resolved ShellExecSpec from the original resolve().
 * @param shell - the executor, for the default-mode fallback.
 */
export function withShimEnv(spec, shell) {
  if (spec === undefined || spec === null) return spec
  const policy = spec.sandboxPolicy
  const mode =
    policy !== undefined
      ? policy.mode
      : typeof shell.sandboxMode === 'string'
        ? shell.sandboxMode
        : undefined
  if (mode === undefined || !CONFINED.has(mode)) return spec
  const env = spec.env || {}
  const existing =
    typeof env.PYTHONPATH === 'string' && env.PYTHONPATH.length > 0
      ? env.PYTHONPATH
      : undefined
  const value = existing !== undefined ? `${SHIM_DIR}${PATH_SEP}${existing}` : SHIM_DIR
  return { ...spec, env: { ...env, PYTHONPATH: value } }
}

/**
 * Patch the mounted shell executor so every confined command inherits the
 * shim PYTHONPATH. Safe no-op when no shell is mounted or the composition
 * never confines. Returns a disposer that restores the original resolve, or
 * `undefined` when nothing was patched.
 *
 * @param ctx - the Cordis context (shell resolved via ctx.get at call time).
 */
export function installShellHook(ctx) {
  const shell = ctx.get('shell')
  if (shell === undefined || shell === null) {
    ctx.logger?.warn?.(
      '[python-tempfile-shim] no shell executor mounted; automatic PYTHONPATH injection unavailable',
    )
    return undefined
  }
  if (typeof shell.resolve !== 'function') return undefined
  // Unsandboxed composition: the incompatibility does not exist here, and
  // patching would only risk altering 0o700 semantics without a fix.
  if (shell.sandboxMode === undefined) return undefined
  // Already patched (plugin reload raced a live executor): reuse the record.
  if (shell[PATCHED] !== undefined) return shell[PATCHED].dispose

  const original = shell.resolve
  const wrapped = function resolve(request) {
    const spec = original.call(this, request)
    return withShimEnv(spec, this)
  }
  const record = {
    wrapped,
    dispose() {
      if (shell[PATCHED] !== record) return
      if (shell.resolve === wrapped) shell.resolve = original
      delete shell[PATCHED]
    },
  }
  shell[PATCHED] = record
  shell.resolve = wrapped
  return record.dispose
}
