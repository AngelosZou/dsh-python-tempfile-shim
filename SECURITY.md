# Security

`dsh-python-tempfile-shim` is a temporary mitigation plugin, kept until an
upstream fix ships. This document states what it does, what it does not do,
and the trade-off accepted by installing it.

## Risk notice

- Temporary mitigation for one specific Windows incompatibility, not a fix.
- Drops CPython's `0o700` directory semantics inside confined runs (see the
  trade-off section below).
- There are no dedicated tools and no escalation surface; nothing in this
  plugin can widen the sandbox.
- The shim must not be installed globally.
- On non-Windows platforms the plugin registers nothing.

## Threat model

The plugin runs inside the DSH host process as a Cordis plugin, like the
shipped tools, and holds no secrets. It does not execute anything itself and
does not inspect or modify command text. Its only runtime effect is adding one
`PYTHONPATH` entry to the environment of commands that the shell executor was
about to run confined anyway; the model can already execute arbitrary
PowerShell inside the sandbox through the pwsh tool, so this adds no execution
capability.

## What it does

1. Patches the mounted shell executor's `resolve()` (the request→spec seam
   every shell consumer uses) so resolved specs for confined calls
   (`read-only` / `workspace-write`) carry
   `env.PYTHONPATH = <plugin assets dir>[;existing]`.
2. Registers a compact always-on system-prompt section and one
   `python-tempfile-shim` skill so the model knows the fix is automatic.
3. The bundled `assets/sitecustomize.py` replaces `os.mkdir`, ignoring the
   `mode` argument: directories created by the injected process inherit the
   parent ACL instead of CPython's `0o700` owner-only DACL.

## What it does not do

- No direct child-process spawn and no command rewriting. Execution paths,
  the sandbox runner, and the escalation surface are exactly the ones the
  mounted executor provides.
- No `sandbox_permissions`/`justification` capability. The plugin cannot
  request a wider sandbox mode for anything.
- No sandbox changes. The token's restricting-SID list, workspace/temp ACEs,
  policy, and escalation surface are unchanged.
- No global installation. `PYTHONPATH` is injected per process tree of
  confined commands only; nothing is written to site-packages, the registry,
  or machine-wide configuration.
- No injection outside confinement. Unconfined compositions (no sandboxing
  executor) and `danger-full-access` calls never receive the shim, so
  CPython's `0o700` default stays intact wherever the sandbox is not the
  problem.

## Trade-off: 0o700 semantics are dropped inside confined processes

`0o700` is CPython's privacy hardening (temp directories readable only by
their owner). With the shim, directories created by that process inherit the
parent ACL, and other local users may read their content.

Why this is accepted: the directories live under the session workspace or the
session's random private temp directory, and the sandbox write boundary is
unchanged — the confined process still creates directories only under the
granted roots.

Rule: do not install `assets/sitecustomize.py` into site-packages or a
machine-wide PYTHONPATH.

## Platform gating

`apply()` registers anything only on Windows. The incompatibility is specific
to the Windows ACL restricted-token backend.

## Residual risks

1. A confined command that explicitly resets `$env:PYTHONPATH` (or a tool
   that spawns Python with a scrubbed environment) drops the shim for its own
   process tree; the failure then re-appears and the skill's guidance is to
   report it, not to escalate.
2. If CPython stops building directory DACLs from `os.mkdir`'s mode on
   Windows, the shim would only change `0o700` semantics.
3. The Windows sandbox backend itself reports `enforcement: partial`
   (Everyone ambient ACEs and similar boundaries); this is unrelated to the
   plugin.
4. Dev-time HMR that reloads the shell executor plugin alone mounts a fresh
   executor instance without this patch until this plugin (or the whole DSH)
   also reloads.

## Retirement

Once an upstream fix ships, remove the plugin from the DSH settings page and
restart DSH.

## Reporting vulnerabilities

Report security issues in this plugin through the repository's GitHub Issues:
https://github.com/AngelosZou/dsh-python-tempfile-shim/issues

Issues in the DSH sandbox itself belong to the DeepSeek Harness repository.
