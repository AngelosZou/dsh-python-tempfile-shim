/**
 * dsh-python-tempfile-shim — host half.
 *
 * TEMPORARY plugin (pre-upstream-fix) for one verified incompatibility: the
 * DSH Windows sandbox (`@deepseek-ai/dsh-sandbox-windows-acl`) runs commands
 * under a WRITE_RESTRICTED token whose restricting-SID list deliberately
 * excludes the user's own SID, while CPython on Windows builds a directory
 * DACL from `os.mkdir`'s mode (0o700 -> owner-only). `tempfile.mkdtemp`
 * hardcodes 0o700 and pytest's `make_numbered_dir` defaults to 0o700, so a
 * confined process cannot read/write/list inside the temp directories it just
 * created — pytest `tmp_path`/`tmpdir` tests die with [Errno 13] / WinError 5
 * surfaced as "[sandbox: file access denied under workspace-write mode]".
 *
 * What this plugin does (mitigation, NOT a sandbox change):
 * 1. Executor-level injection (lib/shell-hook.js): patches the mounted shell
 *    executor's `resolve()` so every CONFINED command (workspace-write /
 *    read-only) inherits `PYTHONPATH=<plugin assets dir>`. The bundled
 *    sitecustomize makes `os.mkdir` ignore the mode so new directories
 *    inherit the parent ACL (which carries the sandbox write ACEs), and the
 *    variable propagates to subprocesses (tox/nox/pytest-in-subprocess) via
 *    environment inheritance. Every python/pytest/pip run through the pwsh
 *    tool is fixed automatically — no dedicated tools, no per-command
 *    wrapping, no escalation. The sandbox boundary is untouched.
 * 2. Context injection (no model action needed): registers a compact,
 *    always-present system-prompt section telling the model the shim is
 *    automatic, so it never reaches for workarounds; plus the
 *    `python-tempfile-shim` skill with the full guidance for humans and for
 *    the rare case where a failure still appears.
 *
 * Deliberate limitations (see SECURITY.md):
 * - Windows-only: on any other platform apply() registers nothing, because
 *   the incompatibility does not exist there and dropping 0o700 semantics
 *   would change behavior without fixing anything.
 * - The injection is confined-only: `danger-full-access` and unsandboxed
 *   compositions never get the shim, so CPython's 0o700 privacy default
 *   stays intact wherever the sandbox is not the problem.
 * - The shim must never be installed globally (site-packages).
 */

import { registerShimSkill } from './skill.js'
import { installShellHook } from './shell-hook.js'

export const name = 'dsh-python-tempfile-shim'
export const inject = ['shell', 'skills', 'systemPrompt']

/**
 * Auto-injected system-prompt section. The skill catalog alone was not
 * enough in practice (models often never call the `skill` tool, so the full
 * guidance stayed out of context); this section makes the essential facts
 * part of EVERY turn's context at a fixed, small token cost.
 */
const PROMPT_SECTION = {
  name: 'plugin:python-tempfile-shim',
  order: 104,
  text:
    '# Python tempfile shim on this Windows sandbox (automatic)\n' +
    'Every confined (workspace-write / read-only) Python, pytest, pip, tox, or nox command run through pwsh ' +
    'already has the CPython 0o700 temp-directory shim injected automatically (PYTHONPATH points at a bundled ' +
    'sitecustomize that makes os.mkdir inherit the parent ACL). Run Python normally — no special tool, workaround, ' +
    'or escalation is needed for [Errno 13]/WinError 5 tempfile failures. If a tmp_path/tmpdir test still fails ' +
    'with a permission marker, the shim did not run: report the exact command and failure to the user instead of ' +
    'retrying with sandbox_permissions. The shim is never active for unsandboxed or danger-full-access runs (the ' +
    'bug does not exist there), and it must never be installed globally.',
}

export function apply(ctx) {
  if (process.platform !== 'win32') return
  ctx.systemPrompt.section(PROMPT_SECTION)
  registerShimSkill(ctx)
  const restore = installShellHook(ctx)
  if (restore !== undefined) {
    ctx.effect(() => restore, 'python-tempfile-shim: shell resolve hook')
  }
}
