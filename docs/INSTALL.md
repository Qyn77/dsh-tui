# One-command installation / 一键安装

## Users / 普通用户

Prerequisites: Node **>= 22.19** with npm, Git, and network access to GitHub and
npm. On Windows use **PowerShell 7 + Windows Terminal**. The installer checks
Node/npm and Git; it does not install system software or request administrator
privileges. Install Node from <https://nodejs.org/> if missing, then reopen the
terminal. Git for Windows: <https://git-scm.com/downloads/win>.

前置条件：Node **>= 22.19**（包含 npm）、Git，以及能访问 GitHub/npm 的网络。
Windows 使用 **PowerShell 7 + Windows Terminal**。脚本不会自动修改系统软件、
申请管理员权限或编辑 shell 启动文件；缺少前置工具时会停止并提示。

Direct download / 直接下载安装：

macOS / Linux:

```sh
curl -fsSL --connect-timeout 15 --max-time 120 https://raw.githubusercontent.com/Qyn77/dsh-tui/main/install.sh | bash
```

Windows PowerShell 7 (download first; failures do not execute partial content):

```powershell
$p = Join-Path $env:TEMP ('dsh-tui-' + [guid]::NewGuid() + '.ps1'); Invoke-WebRequest https://raw.githubusercontent.com/Qyn77/dsh-tui/main/install.ps1 -OutFile $p -ErrorAction Stop; try { & $p } finally { Remove-Item -LiteralPath $p -ErrorAction SilentlyContinue }
```

If your PowerShell policy prevents running downloaded scripts, do not change
system policy; download the standalone `scripts/install.mjs` and run it with Node:

```powershell
$p = Join-Path $env:TEMP ('dsh-tui-' + [guid]::NewGuid() + '.mjs'); Invoke-WebRequest https://raw.githubusercontent.com/Qyn77/dsh-tui/main/scripts/install.mjs -OutFile $p -ErrorAction Stop; try { node $p; if ($LASTEXITCODE -ne 0) { throw 'Installation failed' } } finally { Remove-Item -LiteralPath $p -ErrorAction SilentlyContinue }
```

Windows 执行策略限制 `.ps1` 时，用上面的 Node 入口，不需要修改系统执行策略。

From a checkout / 已有源码时（无需先手动 build）：

```sh
node scripts/install.mjs
```

This builds the selected **remote** revision, not uncommitted local source.
For an already built local package, use `--package /absolute/path/package.tgz`.

默认构建远程 `main`，不包含工作区未提交修改。要安装本地构建产物，用
`--package /absolute/path/package.tgz`。

## What it does / 自动完成什么

1. Checks prerequisites; prepares private npm **10.9.4** and pnpm **11.10.0**.
   It does not depend on a globally installed pnpm or Corepack activation.
2. Fetches the requested Git revision; installs source dependencies from the
   frozen pnpm lockfile with lifecycle scripts disabled, builds declarations and
   runtime, and produces a tarball. Source build tools need native prebuilt
   optional packages for your platform.
3. Installs **dsh launcher + dsh-base + dsh-tui at 0.2.1-rc.5** in a separate
   staging profile. Runtime dependency install scripts are enabled for native
   modules. Network/build errors stop installation; no `--force` or
   `--legacy-peer-deps` hides incompatibilities.
4. Checks installed versions, imports the built TUI, loads koffi, starts a short Node process through native
   node-pty, and composes the profile
   with the real launcher without sending a model request.
5. Activates only after verification. An existing installer-managed profile is
   backed up; its extra dependencies/bundles and user configuration are retained.
   An existing unmanaged profile is refused; choose a different name instead.

自动拉源码 → 按锁文件装构建依赖 → 构建打包 → 安装匹配运行时 → 自检 → 激活。
**不会覆盖全局 `dsh`、现有 `tui-rc5` profile、API Key 或会话记录。**
默认创建 `$DSH_HOME/profiles/tui`（`DSH_HOME` 默认 `~/.dsh`）。
新 profile 仍会读取该 home 的已有环境配置和覆盖层；它不会绕过用户配置。

The npm registry currently only has the older TUI 0.1.0 prereleases (checked
2026-11-09). The source-build path avoids installing that incompatible line.
Do not replace the pinned versions with `latest` or `next`.

目前 npm 上的 TUI 仍只有旧的 0.1.0 预发布包（2026-11-09 核对），因此脚本从
源码构建当前版本；不要把固定版本改成 `latest` / `next`。

## Start / 启动

Run the **exact start command printed by the installer**. With defaults:

```sh
node "$HOME/.dsh/profiles/tui/launch.mjs"
```

```powershell
node "$env:USERPROFILE\.dsh\profiles\tui\launch.mjs"
```

The generated launcher chooses the installed runtime and home explicitly;
whatever version of global `dsh` happens to be on PATH cannot take precedence.
Your current working directory and additional arguments are preserved:

```sh
node "$HOME/.dsh/profiles/tui/launch.mjs" --resume SESSION_ID
```

启动器使用 profile 内固定版本的 `dsh`，避免全局命令抢先加载错误版本。
安装后仍需在 `$DSH_HOME/.env` 配置 `DEEPSEEK_API_KEY`（POSIX 权限设为 `600`），
或使用已有凭据。脚本不会向命令行索取密钥，也不自动启动模型请求。
在 TUI 中运行 `/terminal` 可检查实际加载路径、构建提交和指纹。

## Options / 参数

```sh
node scripts/install.mjs --help
node scripts/install.mjs --profile tui-new --home /absolute/path/to/dsh-home
node scripts/install.mjs --ref FULL_COMMIT_SHA
node scripts/install.mjs --package /absolute/path/to/built-package.tgz
```

`--ref` accepts a branch, tag or commit; it selects the source revision, not the
bootstrap script. For a fully pinned installer, download `scripts/install.mjs`
from that same commit URL and pass `--ref` with the full commit. `--package`
skips Git/source builds but still installs and verifies the pinned runtime.
A tarball must be a trusted built `@qiao-qyn/dsh-tui@0.2.1-rc.5` package.
No registry/mirror is silently substituted; npm/Git honor your environment and
configuration. Proxy or private registry credentials must not be posted in logs.

## Updates, recovery and failures / 更新、恢复和排障

- **Stop the running TUI before updating.** Rerun the same installer command.
  Existing sessions remain in the same home; a new running process is required.
- Previous managed profile: `$DSH_HOME/profiles/tui-backup-<id>`. Keep it until
  acceptance. To roll back, stop dsh, move the new `tui` directory aside, then
  rename the backup to `tui`. Its original `launch.mjs` works again. Do not run
  the backup in place: its launcher still targets the original profile name.
- Unmanaged profile: use `--profile tui-new`. The installer never adopts a
  directory just because it contains a `package.json`.
- Network/certificate failures: check GitHub/npm access and your proxy/CA
  configuration. Do not disable TLS checks. Rerun after fixing connectivity.
- Native dependency failure: review the visible package build output. If a
  prebuilt binary is unavailable, install the platform's compiler/Python tools
  (macOS Command Line Tools; Linux build tools; Windows C++ Build Tools) and retry.
- Windows `ENAMETOOLONG`: choose a short `--home`, e.g. `C:\dsh-home`, and keep
  the temporary-directory path short. The installer does not change the registry.
- Interrupted process: `.tui-install.lock` prevents a second installation.
  Confirm no installer is still running before removing that lock. Incomplete
  `tui-setup-*` folders are not activated; after inspecting them, they can be
  removed. If interruption happened between backup and activation, restore the
  backup as above. Credentials/sessions are never part of this cleanup.
- Successful installation proves package/build/config compatibility. A real
  terminal, a configured provider and account access are still required for chat.

更新前先退出 TUI；失败时原 profile 不会在校验前被替换。旧安装有完整备份，
恢复时需要先把备份目录改回原 profile 名。网络、编译环境或 API 账号问题会保留
明确边界，不把安装成功当成模型请求或所有终端 GUI 都验收通过。

## Maintainer acceptance

`tests/installer.spec.ts` exercises prerequisites, paths with spaces, child
argument forwarding, unmanaged profiles, preserved configuration, backup,
failed dependency/version/bundle checks and concurrent installer locks.
Use a fresh temporary `--home` for the real install smoke test; never use a
personal profile to test failure recovery. Run the generated launcher in a PTY
and exit without a model prompt. Native Windows and Linux checks should also
be run on their respective hosts before claiming those platforms certified.

Automated local evidence (2026-11-09): the default source path built commit
`aa0c43d` and installed 704 runtime packages in an isolated macOS home. The
installed launcher displayed the prompt and `/exit` returned code 0 without an
API key or model request. Installer failure/upgrade tests use fixture packages.
The `Installer checks` workflow runs those transaction/launcher tests on macOS,
Linux and Windows; its remote results and native Windows/Linux installs are not
claimed as passed by this local run.

A second real installation from the built tarball also passed: the previous
profile was backed up, the updated launcher again exited with code 0, and the
installed koffi/node-pty probe succeeded. The latest focused installer suite has
13 tests, including a native-probe failure that preserves the old installation.
