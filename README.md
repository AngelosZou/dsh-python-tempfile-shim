# dsh-python-tempfile-shim

[简体中文](./README.zh.md)

Temporary plugin that works around one Windows sandbox incompatibility until
DeepSeek Harness ships an upstream fix. It is not published to npm; install it
from a local clone. Read [SECURITY.md](./SECURITY.md) before installing.

The plugin lets Python (including pytest) use temporary directories inside the
DSH Windows sandbox. Background: CPython on Windows builds a directory DACL
from `os.mkdir`'s mode argument; `0o700` produces an owner-only directory.
`tempfile.mkdtemp` and pytest's basetemp chain both use `0o700`. The DSH
Windows sandbox runs commands under a `WRITE_RESTRICTED` token whose
restricting-SID list excludes the user's own SID, so the confined process
cannot read or write the directories it just created. pytest `tmp_path`/
`tmpdir` tests fail with `[Errno 13]` / `WinError 5` and the
`[sandbox: file access denied under workspace-write mode]` marker.

## How it works — fully automatic, no extra tools

The plugin patches the mounted shell executor's `resolve()` — the single
chokepoint every shell consumer passes through (the pwsh tool, background
jobs, in-process plugin bridges) — so that **every confined command**
(`workspace-write` / `read-only`) inherits `PYTHONPATH=<plugin assets dir>`.
The bundled `assets/sitecustomize.py` then makes `os.mkdir` ignore the mode
argument, so new directories inherit the parent ACL (which carries the
sandbox's workspace/temp write ACEs) instead of CPython's owner-only DACL.

Because the injection happens at the executor level:

- **No extra tools to remember** — `python`, `pytest`, `pip`, `tox`, `nox`,
  venvs, and any child Python process all get the fix automatically.
- **No extra model context** — the agent just runs Python normally through
  pwsh. A compact always-on system-prompt section tells it the fix is
  automatic so it never reaches for workarounds.
- **Zero escalation** — the sandbox boundary is untouched: token, ACEs,
  policy, and escalation surface are all left alone.

`PYTHONPATH` is inert for non-Python commands, so adding it to every confined
command is safe; a command that sets `$env:PYTHONPATH` itself still overrides
it. The shim is deliberately **not** injected for unsandboxed compositions or
`danger-full-access` runs (the bug does not exist there, and `0o700` is
CPython's privacy hardening that unconfined runs should keep).

A `python-tempfile-shim` skill is also registered for humans and for the rare
case where a failure still appears (diagnose + report).

## Scope

- All `0o700` directory creation routes through `os.mkdir`: `tempfile.mkdtemp`,
  `tempfile.TemporaryDirectory`, `os.makedirs(mode=0o700)`,
  `pathlib.Path.mkdir(mode=0o700)`, pytest, tox/nox (the shim propagates to
  subprocesses via `PYTHONPATH`).
- Windows only; on other platforms `apply()` registers nothing.
- File creation (`os.open`/`mkstemp` modes) is not affected and needs no patch.

## Install

```powershell
git clone https://github.com/AngelosZou/dsh-python-tempfile-shim.git
dsh plugin --profile web add link:<local repository path>
```

Restart DSH afterwards.

Uninstall: remove the plugin from the DSH settings page, then restart DSH.

## Verification

- Environment: Windows, DSH workspace-write sandbox, Python 3.11.15 / 3.13.14,
  pytest 9.1.1.
  - Without the plugin: `tmp_path` test fails with `PermissionError: [WinError 5]`.
  - With the plugin: `1 passed`; `mkdtemp`, `TemporaryDirectory`, `mkstemp`,
    and basetemp cleanup work — run through the ordinary pwsh tool, no
    special arguments.
- Subprocess propagation: parent Python process to child Python process
  (inherited `PYTHONPATH`) works.
- Smoke test: `npm test` covers the resolve-patch contract (confined modes
  injected, `danger-full-access`/unsandboxed left alone, idempotency,
  disposal, no spec mutation) plus prompt-section and skill registration.

## Security

See [SECURITY.md](./SECURITY.md). Note: do not install
`assets/sitecustomize.py` into global site-packages or a machine-wide
PYTHONPATH; `0o700` is CPython's privacy hardening and unsandboxed runs should
keep it.

## Upstream status

Uninstall this plugin once an upstream fix ships.

## License

MIT
