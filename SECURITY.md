# Security

`dsh-python-tempfile-shim` 是官方修复前的临时缓解插件。本文说明它做什么、
不做什么，以及安装后需要接受的取舍。

## 威胁模型

插件在 DSH 宿主进程内作为 Cordis 插件运行，与内置工具相同，不持有任何密钥。
模型通过工具提交的命令与 pwsh 工具的 `command` 参数同等对待：模型本就可以在
沙箱内执行任意 PowerShell，这些工具只前置一个环境变量，不新增执行能力。

## 做什么

1. 注册 `python_shim`、`pytest_run` 两个工具与一个 skill。
2. 每次运行构造命令
   `$env:PYTHONPATH = '<插件 assets 目录>' + $(if ($env:PYTHONPATH) { ';' + $env:PYTHONPATH }); python <args>`，
   通过 `ctx.shell` 执行（与 pwsh 工具相同的沙箱执行器）。
3. 随附的 `assets/sitecustomize.py` 替换 `os.mkdir`，忽略 mode 参数：被注入进程
   创建的目录继承父目录 ACL，而非 CPython 的 `0o700` 仅所有者 DACL。

## 不做什么

- 不直接 spawn 子进程。执行始终经过 `ctx.shell`，由沙箱 runner 约束；直接 spawn
  会以完整令牌运行。
- 不提供 `sandbox_permissions`/`justification` 字段。工具无法请求更宽的沙箱模式；
  因其他原因被拒时，通过 pwsh 工具重跑。
- 不修改沙箱。令牌 restricting 列表、工作区/临时目录 ACE、策略与升权面均不改变。
- 不全局安装 shim。`PYTHONPATH` 按进程树注入，不写 site-packages、注册表或机器级
  配置。

## 取舍：注入进程内不再保留 0o700 语义

`0o700` 是 CPython 的隐私加固（临时目录仅所有者可读）。注入 shim 后，该进程创建的
目录继承父目录 ACL，本机其他用户可能读到其中的内容。

可接受的原因：目录位于会话工作区或会话随机私有临时目录内；沙箱写边界不变，受限
进程仍只能在授权根内创建目录。

规则：不要把 `assets/sitecustomize.py` 装进 site-packages 或机器级 PYTHONPATH。

## 平台限制

`apply()` 仅在 Windows 注册任何内容。该不兼容是 Windows ACL 受限令牌后端特有的。

## 残余风险

1. 模型提供的 `args` 会拼进 PowerShell 命令并由 pwsh 解释，与 pwsh 工具的
   `command` 参数风险相同。
2. 若 CPython 未来在 Windows 上停止按 mode 构造目录 DACL，shim 只剩改变 `0o700`
   语义的效果。
3. Windows 沙箱后端本身声明 `enforcement: partial`（Everyone 环境 ACE 等边界），
   与本插件无关。

## 退役

官方修复后，在 DSH 设置页移除插件并重启即可。
