/**
 * The `python-tempfile-shim` skill: teaches the agent when and how to use the
 * two shim tools, what the root cause is, and — just as important — what NOT
 * to do (no escalation, no global installation, no repo pollution).
 */

const SKILL = {
  name: 'python-tempfile-shim',
  description:
    'Work around the DSH Windows sandbox × CPython 0o700 temp-directory incompatibility when running Python or pytest.',
  // REQUIRED by the skill loader: ctx.skills.get() validates `source` as a
  // non-empty string (see @deepseek-ai/dsh-skill validateDefinition). Without
  // it the skill lists in the catalog but fails to load with
  // "loaded skill ... source must be a string".
  source: 'custom',
  whenToUse:
    'When Python (especially pytest tmp_path/tmpdir tests) fails on Windows DSH with [Errno 13] Permission denied / WinError 5 or a "[sandbox: file access denied under workspace-write mode]" marker while creating or using tempfile directories.',
  invocation: { modelInvocable: true, userInvocable: true },
  content: `# python-tempfile-shim

## Root cause (one paragraph)
The DSH Windows sandbox runs commands under a WRITE_RESTRICTED token whose restricting-SID list deliberately excludes your own user SID (that is what keeps confinement meaningful). CPython on Windows builds a directory DACL from \`os.mkdir\`'s mode: 0o700 -> owner-only. \`tempfile.mkdtemp\` hardcodes 0o700 and pytest's basetemp chain defaults to 0o700, so the confined process cannot read, write, or even list inside the temp directories it just created.

## Use the tools
- \`python_shim\` — run ANY python command with a per-process shim injected: \`args\` is the command line exactly as after \`python\` in a shell (\`"-m pytest -q tests"\`, \`"script.py --flag"\`, \`"-m tox"\`). The shim prepends a sitecustomize.py to PYTHONPATH that makes \`os.mkdir\` ignore the mode so new directories inherit the parent ACL (which carries the sandbox write ACEs). It propagates to subprocesses via environment inheritance.
- \`pytest_run\` — convenience wrapper: \`python -m pytest <args>\`.

Both run through the SAME sandbox executor as the pwsh tool: workspace-write applies as usual, no escalation is needed, and the run stays fully confined.

## Do NOT
- Do NOT retry with \`sandbox_permissions\` on these tools — they intentionally have no escalation fields. If a run is denied for a DIFFERENT reason, re-run the exact command through the regular pwsh tool with its escalation surface.
- Do NOT install the bundled sitecustomize.py into site-packages or a global PYTHONPATH: 0o700 is CPython's privacy hardening and must stay for unsandboxed runs.
- Do NOT commit a conftest.py/os.mkdir monkeypatch into the repository just to work around this, unless the maintainers want it (it also affects non-DSH environments).
- On Linux/macOS this problem does not exist; these tools are Windows-only.`,
}

export function registerShimSkill(ctx) {
  ctx.skills.register(SKILL)
}
