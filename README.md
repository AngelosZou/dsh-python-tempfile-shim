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

## Scope

- All `0o700` directory creation routes through `os.mkdir`: `tempfile.mkdtemp`,
  `tempfile.TemporaryDirectory`, `os.makedirs(mode=0o700)`,
  `pathlib.Path.mkdir(mode=0o700)`, pytest, tox/nox (the shim propagates to
  subprocesses via `PYTHONPATH`).
- Windows only; on other platforms `apply()` registers nothing.
- File creation (`os.open`/`mkstemp` modes) is not affected and needs no patch.

## Tools

| Tool | Purpose |
| --- | --- |
| `python_shim` | Run any Python command; `args` is the command line after `python`, e.g. `"-m pytest -q tests"`, `"script.py --flag"`, `"-m tox"`. |
| `pytest_run` | Convenience wrapper for `python_shim`, equivalent to `python -m pytest <args>`. |

A `python-tempfile-shim` skill is also registered with usage guidance and
caveats.

Both tools run through `ctx.shell`, the same sandboxed executor the pwsh tool
uses, under workspace-write without escalation. The tools expose no
`sandbox_permissions`/`justification` fields; if the sandbox denies a run for
a different reason, re-run it through the pwsh tool with its escalation
surface.

## How it works

The tools prepend `assets/sitecustomize.py` to `PYTHONPATH`, then run
`python ...`. The shim makes `os.mkdir` ignore the mode argument so new
directories inherit the parent ACL (which carries the sandbox's workspace/temp
write ACEs). The sandbox token, ACEs, policy, and escalation surface are
unchanged.

## Install

```powershell
git clone https://github.com/AngelosZou/dsh-python-tempfile-shim.git
dsh plugin --profile web add link:<local repositry path>
```

Restart DSH afterwards.

Uninstall: remove the plugin from the DSH settings page, then restart DSH.

## Verification

- Environment: Windows, DSH workspace-write sandbox, Python 3.11.15 / 3.13.14,
  pytest 9.1.1.
  - Without shim: `tmp_path` test fails with `PermissionError: [WinError 5]`.
  - With shim: `1 passed`; `mkdtemp`, `TemporaryDirectory`, `mkstemp`, and
    basetemp cleanup work.
- Subprocess propagation: parent Python process to child Python process
  (inherited `PYTHONPATH`) works.
- Smoke test: `npm test` covers tool/skill registration, command construction,
  sandbox-policy passthrough, denial rendering without an escalation hint,
  background jobs, and validation errors.

## Security

See [SECURITY.md](./SECURITY.md). Note: do not install
`assets/sitecustomize.py` into global site-packages or a machine-wide
PYTHONPATH; `0o700` is CPython's privacy hardening and unsandboxed runs should
keep it.

## Upstream status

Uninstall this plugin once an upstream fix ships.

## License

MIT
