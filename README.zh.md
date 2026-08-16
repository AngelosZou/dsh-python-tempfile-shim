# dsh-python-tempfile-shim

[English](./README.md)

临时插件，用于在 DeepSeek Harness 官方修复前规避一个 Windows 沙箱不兼容问题。
仅通过本地克隆目录安装。安装前请阅读 [SECURITY.md](./SECURITY.md)。

该插件让 Python（含 pytest）能在 DSH Windows 沙箱内使用临时目录。
背景：CPython 在 Windows 上按 `os.mkdir` 的 mode 参数构造目录 DACL，`0o700`
生成仅所有者可访问的目录；`tempfile.mkdtemp` 与 pytest 的 basetemp 目录链都使用
`0o700`。DSH Windows 沙箱用 `WRITE_RESTRICTED` 受限令牌运行命令，restricting-SID
列表不含用户自身 SID，因此受限进程无法读写自己创建的这些目录。pytest 的
`tmp_path`/`tmpdir` 测试表现为 `[Errno 13]` / `WinError 5`，并带有
`[sandbox: file access denied under workspace-write mode]` 标记。

## 范围

- 所有以 `0o700` 建目录的路径都经过 `os.mkdir`：`tempfile.mkdtemp`、
  `tempfile.TemporaryDirectory`、`os.makedirs(mode=0o700)`、
  `pathlib.Path.mkdir(mode=0o700)`、pytest、tox/nox（shim 随 `PYTHONPATH`
  传播到子进程）。
- 仅 Windows 生效；其他平台 `apply()` 不注册任何内容。
- 文件创建（`os.open`/`mkstemp` 的 mode）不受影响，无需处理。

## 工具

| 工具 | 用途 |
| --- | --- |
| `python_shim` | 运行任意 Python 命令，`args` 为 `python` 之后的命令行，如 `"-m pytest -q tests"`、`"script.py --flag"`、`"-m tox"`。 |
| `pytest_run` | `python_shim` 的便捷封装，等价于 `python -m pytest <args>`。 |

同时注册 `python-tempfile-shim` skill，说明工具的适用场景与注意事项。

两个工具通过 `ctx.shell` 执行，与 pwsh 工具使用相同的沙箱执行器，在
workspace-write 下运行，不需要升权。工具不提供 `sandbox_permissions`/
`justification` 字段；若因其他原因被沙箱拒绝，请通过 pwsh 工具的升权面重跑。

## 原理

工具把 `assets/sitecustomize.py` 前置到 `PYTHONPATH` 后运行 `python ...`。
该 shim 使 `os.mkdir` 忽略 mode 参数，新目录继承父目录 ACL（其中含沙箱授予的
工作区/临时目录写 ACE）。沙箱本身的令牌、ACE、策略与升权面均不改变。

## 安装

```powershell
git clone https://github.com/AngelosZou/dsh-python-tempfile-shim.git
dsh plugin --profile web add link:<clone 目录的绝对路径>
```

安装后重启 DSH 生效。

卸载：在 DSH 设置页移除该插件，然后重启 DSH。

## 验证

- 环境：Windows、DSH workspace-write 沙箱、Python 3.11.15 / 3.13.14、pytest 9.1.1。
  - 不注入 shim：`tmp_path` 测试 `PermissionError: [WinError 5]`。
  - 注入 shim：`1 passed`；`mkdtemp`、`TemporaryDirectory`、`mkstemp`、basetemp
    清理正常。
- 子进程传播：父 Python 进程到子 Python 进程（继承 `PYTHONPATH`）正常。
- 冒烟测试：`npm test`，覆盖工具/skill 注册、命令构造、沙箱策略透传、拒绝渲染
  （不含升权提示）、后台任务、校验错误面。

## 安全

见 [SECURITY.md](./SECURITY.md)。注意：不要将 `assets/sitecustomize.py` 安装到
全局 site-packages 或机器级 PYTHONPATH；`0o700` 是 CPython 的隐私加固，未沙箱
运行时需要保留。

## 上游状态

官方修复该异常后，卸载本插件即可。

## License

MIT
