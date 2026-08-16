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
 * 1. Registers `python_shim` (generic) and `pytest_run` (convenience) tools.
 * 2. Each tool prepends the bundled `assets/sitecustomize.py` to PYTHONPATH
 *    and runs `python ...` THROUGH `ctx.shell` — the same sandboxed executor
 *    the pwsh/bash tools use — so every run stays confined (workspace-write),
 *    needs NO `sandbox_permissions`, and the shim propagates to subprocesses
 *    (tox/nox/pytest-in-subprocess) via environment inheritance.
 * 3. The shim makes `os.mkdir` ignore the mode so new directories inherit the
 *    parent ACL (which carries the sandbox's standing workspace/temp write
 *    ACEs). The sandbox boundary is untouched: token restricting list, ACEs,
 *    policy, and escalation surface are all left alone.
 *
 * Deliberate limitations (see SECURITY.md):
 * - Windows-only: on any other platform apply() registers nothing, because
 *   the incompatibility does not exist there and dropping 0o700 semantics
 *   would change behavior without fixing anything.
 * - The tools expose NO `sandbox_permissions`/`justification` fields. If a
 *   run is denied for a DIFFERENT reason, the sanctioned path is the regular
 *   pwsh tool with its escalation surface.
 * - The shim must never be installed globally (site-packages): the 0o700
 *   default is CPython's privacy hardening for unsandboxed runs.
 */

import { registerShimSkill } from './skill.js'
import { registerPythonShimTool } from './tools/python-shim.js'
import { registerPytestTool } from './tools/pytest.js'

export const name = 'dsh-python-tempfile-shim'
export const inject = ['tools', 'skills']

export function apply(ctx) {
  if (process.platform !== 'win32') return
  registerShimSkill(ctx)
  registerPythonShimTool(ctx)
  registerPytestTool(ctx)
}
