# Security

`dsh-python-tempfile-shim` is a temporary mitigation plugin, kept until an
upstream fix ships. This document states what it does, what it does not do,
and the trade-off accepted by installing it.

## Risk notice

- Temporary mitigation for one specific Windows incompatibility, not a fix.
- Drops CPython's `0o700` directory semantics inside injected runs (see the
  trade-off section below).
- The tools have no escalation surface; runs denied for other reasons must be
  re-run through the pwsh tool.
- The shim must not be installed globally.
- On non-Windows platforms the plugin registers nothing.

## Threat model

The plugin runs inside the DSH host process as a Cordis plugin, like the
shipped tools, and holds no secrets. Commands submitted by the model through
these tools are treated like the pwsh tool's `command` parameter: the model
can already execute arbitrary PowerShell inside the sandbox. These tools only
prepend an environment variable and add no execution capability.

## What it does

1. Registers the `python_shim` and `pytest_run` tools and one skill.
2. For each run, builds
   `$env:PYTHONPATH = '<plugin assets dir>' + $(if ($env:PYTHONPATH) { ';' + $env:PYTHONPATH }); python <args>`
   and executes it through `ctx.shell`, the same sandboxed executor the pwsh
   tool uses.
3. The bundled `assets/sitecustomize.py` replaces `os.mkdir`, ignoring the
   `mode` argument: directories created by the injected process inherit the
   parent ACL instead of CPython's `0o700` owner-only DACL.

## What it does not do

- No direct child-process spawn. Execution always goes through `ctx.shell`,
  where the sandbox runner confines it; a direct spawn would run under the
  full token.
- No `sandbox_permissions`/`justification` fields. The tools cannot request a
  wider sandbox mode; if a run is denied for another reason, re-run it through
  the pwsh tool.
- No sandbox changes. The token's restricting-SID list, workspace/temp ACEs,
  policy, and escalation surface are unchanged.
- No global installation. `PYTHONPATH` is injected per process tree; nothing
  is written to site-packages, the registry, or machine-wide configuration.

## Trade-off: 0o700 semantics are dropped inside injected processes

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

1. The model-supplied `args` is appended to a PowerShell command and
   interpreted by pwsh, with the same risk as the pwsh tool's `command`
   parameter.
2. If CPython stops building directory DACLs from `os.mkdir`'s mode on
   Windows, the shim would only change `0o700` semantics.
3. The Windows sandbox backend itself reports `enforcement: partial`
   (Everyone ambient ACEs and similar boundaries); this is unrelated to the
   plugin.

## Retirement

Once an upstream fix ships, remove the plugin from the DSH settings page and
restart DSH.

## Reporting vulnerabilities

Report security issues in this plugin through the repository's GitHub Issues:
https://github.com/AngelosZou/dsh-python-tempfile-shim/issues

Issues in the DSH sandbox itself belong to the DeepSeek Harness repository.
