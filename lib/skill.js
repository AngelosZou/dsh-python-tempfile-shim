/**
 * The `python-tempfile-shim` skill: explains the root cause and — because
 * the fix is now injected automatically at the executor level — mostly what
 * NOT to do, plus how to react if a permission failure still appears.
 * Kept for human invocation and for the rare diagnostic case; day-to-day
 * context comes from the always-on system-prompt section in index.js.
 */

const SKILL = {
  name: 'python-tempfile-shim',
  description:
    'Diagnose and react to the DSH Windows sandbox × CPython 0o700 temp-directory incompatibility; the fix is normally injected automatically.',
  // REQUIRED by the skill loader: ctx.skills.get() validates `source` as a
  // non-empty string (see @deepseek-ai/dsh-skill validateDefinition). Without
  // it the skill lists in the catalog but fails to load with
  // "loaded skill ... source must be a string".
  source: 'custom',
  whenToUse:
    'When a Python/pytest run on Windows DSH fails with [Errno 13] Permission denied / WinError 5 or a "[sandbox: file access denied under workspace-write mode]" marker despite the automatic shim — to verify what went wrong and report it.',
  invocation: { modelInvocable: true, userInvocable: true },
  content: `# python-tempfile-shim

## Root cause (one paragraph)
The DSH Windows sandbox runs commands under a WRITE_RESTRICTED token whose restricting-SID list deliberately excludes your own user SID (that is what keeps confinement meaningful). CPython on Windows builds a directory DACL from \`os.mkdir\`'s mode: 0o700 -> owner-only. \`tempfile.mkdtemp\` hardcodes 0o700 and pytest's basetemp chain defaults to 0o700, so the confined process cannot read, write, or even list inside the temp directories it just created.

## Status: automatic — normally nothing to do
The plugin patches the shell executor so every confined (workspace-write / read-only) command inherits \`PYTHONPATH\` pointing at a bundled sitecustomize that makes \`os.mkdir\` ignore the mode (new directories inherit the parent ACL, which carries the sandbox write ACEs). It propagates to subprocesses via environment inheritance. Run \`python\`, \`pytest\`, \`pip\`, \`tox\`, \`nox\` through pwsh normally — no special tool or wrapper exists anymore.

## If a tempfile permission failure still appears
The shim did not run. Check, then report rather than work around:
1. The run must be confined: the shim is deliberately absent for unsandboxed compositions and \`danger-full-access\` calls (the bug does not exist there, and 0o700 must stay for unconfined runs).
2. The command must not have replaced \`$env:PYTHONPATH\` itself.
3. Report the exact command, failure text, and sandbox mode so the plugin can be fixed.

## Do NOT
- Do NOT escalate with \`sandbox_permissions\` for tempfile permission failures — escalation removes confinement instead of fixing the shim.
- Do NOT install the bundled sitecustomize.py into site-packages or a global PYTHONPATH: 0o700 is CPython's privacy hardening and must stay for unsandboxed runs.
- Do NOT commit a conftest.py/os.mkdir monkeypatch into the repository just to work around this, unless the maintainers want it (it also affects non-DSH environments).
- On Linux/macOS this problem does not exist; the plugin is Windows-only.`,
}

export function registerShimSkill(ctx) {
  ctx.skills.register(SKILL)
}
