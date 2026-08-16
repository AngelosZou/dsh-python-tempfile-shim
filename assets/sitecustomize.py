"""DSH sandbox shim for Python on Windows: 0o700 directory creation vs the
WRITE_RESTRICTED token. Bundled by the dsh-python-tempfile-shim plugin;
injected ONLY into sandboxed python runs through PYTHONPATH. Never install
this file globally (site-packages).

Root cause chain (verified):
1. The DSH Windows sandbox (dsh-sandbox-windows-acl) runs shell commands under a
   WRITE_RESTRICTED token whose restricting-SID list is [logon SID, Everyone,
   workspace write SID, temp write SID]. The user's own SID is deliberately NOT
   in the list -- otherwise confinement would be meaningless (a confined process
   could write any file the user owns).
2. CPython on Windows builds a directory DACL from os.mkdir's mode argument
   (the docstring still claims the mode is ignored; empirically it is not, on
   3.11.x and 3.13.x). mode 0o700 -> owner-only DACL.
3. tempfile.mkdtemp hardcodes os.mkdir(file, 0o700); pytest's
   make_numbered_dir defaults to mode 0o700 for the whole basetemp chain.
   -> every such directory gets an owner-only DACL, and the confined process
   cannot write, list, or even delete inside directories it just created:
   [Errno 13] / WinError 5, surfaced by DSH as "[sandbox: file access denied
   under workspace-write mode]".

Fix (this shim): make os.mkdir ignore the mode so new directories inherit the
parent ACL, which carries the sandbox's standing workspace/temp write ACEs.
Confinement stays fully intact: the confined process still can only write
under the granted roots; only the owner-only-DACL clash is removed.

Scope: this is a GENERAL Python fix, not a pytest fix. Everything that creates
0o700 directories routes through the os.mkdir chokepoint:
    tempfile.mkdtemp, tempfile.TemporaryDirectory, os.makedirs(mode=0o700),
    pathlib.Path.mkdir(mode=0o700), pytest, tox/nox (PYTHONPATH propagates to
    subprocesses -- verified). File creation (os.open/mkstemp modes) is NOT
    affected by the underlying CPython behavior and needs no patch.

Verified: python 3.11.15 / 3.13.14, pytest 9.1.1, subprocess propagation.
"""
import os as _os

_mkdir_original = _os.mkdir


def _mkdir_inheriting(path, mode=0o777, *, dir_fd=None):
    return _mkdir_original(path, dir_fd=dir_fd)


_os.mkdir = _mkdir_inheriting
