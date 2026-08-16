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

## 原理——全自动注入，无需任何额外工具

插件包装挂载的 shell 执行器的 `resolve()`——所有 shell 消费方（pwsh 工具、
后台任务、进程内插件桥接）共同经过的唯一收口点——使**每一条受限命令**
（`workspace-write` / `read-only`）都继承 `PYTHONPATH=<插件 assets 目录>`。
随附的 `assets/sitecustomize.py` 让 `os.mkdir` 忽略 mode 参数，新目录继承父目录
ACL（其中含沙箱授予的工作区/临时目录写 ACE），而不是 CPython 的仅所有者 DACL。

由于注入发生在执行器层面：

- **无需记忆额外工具**——`python`、`pytest`、`pip`、`tox`、`nox`、虚拟环境以及
  任何子 Python 进程都会自动获得修复。
- **不增加模型上下文**——agent 照常通过 pwsh 运行 Python；插件注册了一段
  常驻系统提示词说明修复是自动的，agent 无需任何特殊动作。
- **零升权**——沙箱边界完全不动：令牌、ACE、策略与升权面均不变。

`PYTHONPATH` 对非 Python 命令无副作用，因此给每条受限命令附加它是安全的；
命令自行设置 `$env:PYTHONPATH` 时仍可覆盖。对于未沙箱的组合与
`danger-full-access` 运行，插件**刻意不注入**（那里不存在该 bug，且 `0o700`
是 CPython 的隐私加固，未沙箱运行应保留）。

同时注册 `python-tempfile-shim` skill，供人类查阅以及在罕见的仍然失败时
进行诊断与上报。

## 范围

- 所有以 `0o700` 建目录的路径都经过 `os.mkdir`：`tempfile.mkdtemp`、
  `tempfile.TemporaryDirectory`、`os.makedirs(mode=0o700)`、
  `pathlib.Path.mkdir(mode=0o700)`、pytest、tox/nox（shim 随 `PYTHONPATH`
  传播到子进程）。
- 仅 Windows 生效；其他平台 `apply()` 不注册任何内容。
- 文件创建（`os.open`/`mkstemp` 的 mode）不受影响，无需处理。

## 安装

```powershell
git clone https://github.com/AngelosZou/dsh-python-tempfile-shim.git
dsh plugin --profile web add link:<clone 目录的绝对路径>
```

安装后重启 DSH 生效。

卸载：在 DSH 设置页移除该插件，然后重启 DSH。

## 验证

- 环境：Windows、DSH workspace-write 沙箱、Python 3.11.15 / 3.13.14、pytest 9.1.1。
  - 未装插件：`tmp_path` 测试 `PermissionError: [WinError 5]`。
  - 装插件后：通过普通 pwsh 工具直接运行即可 `1 passed`；`mkdtemp`、
    `TemporaryDirectory`、`mkstemp`、basetemp 清理正常。
- 子进程传播：父 Python 进程到子 Python 进程（继承 `PYTHONPATH`）正常。
- 冒烟测试：`npm test`，覆盖 resolve 包装契约（受限模式注入、
  `danger-full-access`/未沙箱不注入、幂等、恢复、不改动入参）以及
  提示词段落与 skill 注册。

## 安全

见 [SECURITY.md](./SECURITY.md)。注意：不要将 `assets/sitecustomize.py` 安装到
全局 site-packages 或机器级 PYTHONPATH；`0o700` 是 CPython 的隐私加固，未沙箱
运行时需要保留。

## 上游状态

官方修复该异常后，卸载本插件即可。

## License

MIT
