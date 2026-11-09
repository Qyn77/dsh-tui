# One-command installation / 一键安装

## Users / 普通用户

Prerequisites: Node **>= 22.19** with npm, Git, and network access to GitHub and
npm. Windows installation supports **CMD or PowerShell 7**; running the TUI
still requires **PowerShell 7 + Windows Terminal**. PowerShell 7 must be installed
even when starting installation from CMD. The installer checks tools, directories,
disk and network before downloading dependencies, then configures the user command
and PATH after success. It does not install system software or request administrator
privileges. Install Node from <https://nodejs.org/> if missing, then reopen the
terminal. Git for Windows: <https://git-scm.com/downloads/win>.

前置条件：Node **>= 22.19**（包含 npm）、Git，以及能访问 GitHub/npm 的网络。
Windows 安装支持 **CMD 或 PowerShell 7**；运行 TUI 仍使用
**PowerShell 7 + Windows Terminal**，不新增旧式 conhost 的运行兼容承诺。脚本不会自动修改系统软件、
申请管理员权限；缺少前置工具时会停止并提示。Windows 即使从 CMD 开始安装，
也需预装 PowerShell 7。成功后会备份并更新用户 shell/PATH 配置，支持 `--no-path` 跳过。

Direct download / 直接下载安装：

On a clean computer, install these prerequisites first; the script does not
bootstrap Node, Git or your terminal. The download commands below also need
`curl` (`curl.exe` on Windows). Neither Harness Desktop, global `dsh`, nor global
pnpm is required. Installing Desktop alone does not put Node/npm/Git on your
terminal's PATH. **Opening the TUI and successfully chatting are separate checks:**
chatting requires valid credentials and a matching provider/model configuration.

干净电脑需先装好上述前置工具，下载命令还需要 `curl`（Windows 为 `curl.exe`）。
无需预装 Harness 桌面版、全局 `dsh` 或 pnpm；仅安装桌面版不代表终端里已有
Node/npm/Git。**能启动界面不等于已经能对话**：对话还需要有效凭据及匹配的模型配置。

macOS / Linux:

```sh
curl -fsSL --connect-timeout 15 --max-time 120 https://raw.githubusercontent.com/Qyn77/dsh-tui/main/install.sh | bash
```

Windows PowerShell 7, one-line curl download / 一行下载安装：

```powershell
curl.exe -fsSL --connect-timeout 15 --max-time 120 https://raw.githubusercontent.com/Qyn77/dsh-tui/main/scripts/install.mjs -o "$env:TEMP\dsh-tui-install.mjs" && node "$env:TEMP\dsh-tui-install.mjs"
```

Windows CMD, one-line curl download / 一行下载安装：

```bat
curl.exe -fsSL --connect-timeout 15 --max-time 120 https://raw.githubusercontent.com/Qyn77/dsh-tui/main/scripts/install.mjs -o "%TEMP%\dsh-tui-install.mjs" && node "%TEMP%\dsh-tui-install.mjs"
```

These Windows commands require `curl.exe` and only execute Node after a successful
download (`&&`). They download the same standalone installer, without requiring
a Git checkout or changing PowerShell execution policy. The small downloaded
`dsh-tui-install.mjs` file remains in TEMP and may be removed after installation.
The PowerShell form requires version 7; the CMD form uses `%TEMP%`, not `$env:TEMP`.

这两条 Windows 命令需要 `curl.exe`，仅在下载成功后才启动安装器；不需要先克隆
仓库，也不修改 PowerShell 执行策略。下载的 `dsh-tui-install.mjs` 会留在临时目录，
安装结束后可删除。下面继续保留本地 CMD 脚本及 PowerShell 下载入口的用法。

Windows CMD, from a checkout / 已下载源码，在 CMD 的项目目录运行：

```bat
install.cmd
```

Options / 参数示例：

```bat
install.cmd --home "C:\dsh home" --profile tui
```

Without a checkout, download `install.cmd` from this repository's `main` branch
to an empty folder, then run it in CMD. It downloads the Node installer using
`curl.exe`; a checkout uses its adjacent `scripts/install.mjs`. Both paths build
remote `main` by default. The Node installer calls PowerShell 7 to check the Windows
runtime prerequisite and configure user PATH; it does not change execution policy.
A failed download is never executed, temporary
downloads are cleaned up, and installer failures return a nonzero exit code.

没有源码时，将本仓库 `main` 的 `install.cmd` 下载到空目录，再在 CMD 中运行。
独立脚本需要 `curl.exe` 下载 Node 安装器；源码目录下直接使用旁边的
`scripts/install.mjs`。两种入口默认都构建远程 `main`。
Node 安装器会调用 PowerShell 7 检查 Windows 前置环境并配置用户 PATH，不修改执行策略；下载失败不会执行，临时下载文件
会清理，安装失败会返回非零退出码。安装完成后，按提示切到 Windows Terminal
中的 PowerShell 7 启动 TUI。CMD 参数中的路径使用双引号。

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

1. Checks Node/npm, platform/architecture (macOS/Linux/Windows, x64/arm64),
   Git for source builds, writable install/temp/config directories and at least
   **1 GiB available on both install and temporary volumes**. Checks npm registry
   reachability via the user's npm/proxy settings and GitHub reachability for
   source builds; native compatibility is verified later, not inferred from CPU.
   Then prepares private npm **10.9.4** and pnpm **11.10.0**.
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
6. Creates the user-level `dsh-tui` command and updates user PATH, with backups
   and duplicate prevention. `--no-path` skips this step and related config checks.

环境不满足时，在下载构建依赖之前终止并输出具体修复提示；网络预检只证明当前
连接可达，安装时仍可能遇到下载中断或平台原生依赖问题。磁盘预检底线为 1 GiB，
源码编译或已有 profile 备份可能需要更多空间。`--package` 模式不要求 Git 或 GitHub
源代码访问，但运行依赖仍需要 npm 网络。安装进程可以是非交互管道；TUI 启动仍要求真实终端。

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

After a successful install, open a new terminal and run:

```sh
dsh-tui
dsh-tui --resume SESSION_ID
```

The child installer cannot rewrite an already running parent shell's environment.
On Windows, completely exit and restart Windows Terminal, then open PowerShell 7.
If command setup was skipped or reported a warning, use the **exact explicit start
command printed by the installer**. With defaults:

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

## API Key / 配置 API Key

For the official DeepSeek API, edit `$DSH_HOME/.env` (default `~/.dsh/.env`).
After installation the home directory exists. Use an editor, preserve other
entries, and add or update this line with your own key **locally**:

使用 DeepSeek 官方 API 时，编辑 `$DSH_HOME/.env`（默认 `~/.dsh/.env`），
保留其他配置，在本地新增或更新下面这一行。示例只是占位符，不是可用密钥：

```dotenv
DEEPSEEK_API_KEY=YOUR_DEEPSEEK_API_KEY
```

| Terminal / 终端 | Edit the default file / 编辑默认文件 |
| --- | --- |
| macOS / Linux | `nano "$HOME/.dsh/.env"` |
| Windows PowerShell 7 | `notepad "$env:USERPROFILE\.dsh\.env"` |
| Windows CMD | `notepad "%USERPROFILE%\.dsh\.env"` |

On macOS/Linux, save the file and restrict access:

```sh
chmod 600 "$HOME/.dsh/.env"
```

Save as exactly `.env`, not `.env.txt` in Notepad. If you installed with `--home`
or `DSH_HOME`, use that home instead of the default paths above. Restart the TUI
after editing, then select the intended provider/model with `/provider` and
`/model`. Never paste a real key into a chat, issue, repository or screenshot.

macOS/Linux 保存后执行上面的 `chmod`。Windows 记事本保存时确认文件名为 `.env`，
不是 `.env.txt`。使用自定义 `--home` / `DSH_HOME` 时，将示例路径换成实际 home。
修改后重启 TUI，并通过 `/provider`、`/model` 选择对应提供方和模型。
不要把真实密钥发到聊天、issue、仓库或截图里。

### If a new key does not take effect / 改了 Key 却没生效

In the pinned rc.5 runtime, the same named credential is resolved in this order:

1. Managed credential store: `$DSH_HOME/.credentials.yaml`.
2. Inherited process environment.
3. `.env` in the launch working directory.
4. `$DSH_HOME/.env`.

同名凭据按以上顺序读取。因此在桌面版已管理该凭据时，修改 home 下的 `.env`
不会覆盖它；请从桌面版相应凭据设置更新或移除旧值，不要直接清空整个凭据文件。
启动终端的环境变量、项目目录的 `.env` 也可能覆盖 home 下的值。

Update an existing managed credential through the desktop credential settings;
do not erase the whole credential store. Also check inherited environment and
project `.env` overrides. A third-party API additionally needs its provider URL,
model and credential mapping configured in the TUI profile; setting
`DEEPSEEK_API_KEY` alone only covers the official DeepSeek API. An account login
and an API key are distinct authentication methods, not interchangeable secrets.

第三方兼容 API 还需在 TUI profile 配置对应的服务地址、模型和凭据映射，
不能只填 `DEEPSEEK_API_KEY`。账号登录与 API Key 是不同认证方式，不能互相替代。

## Harness Desktop / 与桌面版一起使用

The TUI uses the Harness agent and tools through `dsh-base`, but the installer
creates its own pinned launcher/base/TUI runtime. It does not reuse Desktop's
bundled Node or globally installed `dsh` packages.

TUI 通过 `dsh-base` 复用 Harness 的 Agent 和工具能力；安装器仍会独立安装固定版本的
launcher/base/TUI，不复用桌面版内置 Node，也不依赖全局 `dsh` 包。

| Item / 项目 | Sharing boundary / 共享范围 |
| --- | --- |
| Credentials / 凭据 | Same `DSH_HOME` shares `.credentials.yaml` and home `.env`; a custom home is separate. / 相同 home 共用凭据存储，自定义 home 需单独配置。 |
| Root configuration / 根配置 | Home `cordis.patch.yml` applies across profiles. / home 根覆盖层会影响各 profile。 |
| Models and plugins / 模型与插件 | Desktop's `profiles/desktop/cordis.patch.yml` is profile-local; it is not automatically imported into `profiles/tui`. / 桌面版专属模型、默认模型和插件配置不自动复制。 |
| Runtime tools / 运行工具 | Desktop's private Node/pnpm do not satisfy the installer's terminal PATH prerequisites. / 桌面版自带运行时不等于终端具备安装前置工具。 |

Checked on 2026-11-09 against Desktop **0.2.2-rc.1** and TUI runtime
**0.2.1-rc.5**: credential-related implementations match, and rc.5 can parse the
shared credential document. This establishes storage compatibility, **not**
account-token validity or a successful model request. It is not a guarantee for
other version pairs. Automatic desktop detection, selective model import and
credential-readiness checks remain planned work in [TUI-ROADMAP.md](TUI-ROADMAP.md).

2026-11-09 核对上述版本的凭据实现和 rc.5 解析兼容性；没有发起真实模型请求，
不据此保证账号令牌有效、任意版本兼容，或“装完两个就一定直接能聊”。
桌面版检测、模型配置按需导入与凭据就绪检查仍是路线图待办。

## User command / 用户命令和环境变量

- macOS/Linux: executable `~/.local/bin/dsh-tui`; managed PATH block in the
  detected login shell's config: zsh `$ZDOTDIR/.zshrc` (default `~/.zshrc`),
  bash `~/.bashrc` plus the first existing `.bash_profile` / `.bash_login` /
  `.profile` (creates `.profile` if none exists), or fish
  `$XDG_CONFIG_HOME/fish/conf.d/dsh-tui.fish` (default `~/.config`).
- Windows: `%USERPROFILE%\.dsh\bin\dsh-tui.cmd`, adding only its directory to
  **user PATH**, never system PATH. Existing entries are retained; no `setx`
  truncation. Raw `%VARIABLE%` references and the registry value type are retained.
  PATH backup JSON (value and type) is saved in that bin directory before changes.
- The wrapper uses the installing Node executable and the chosen profile's
  `launch.mjs`, preserves arguments and the working directory, and does not use
  global `dsh`. The most recently successful command setup chooses the profile
  for `dsh-tui`; other installed profiles keep their explicit launch commands.
- Changed existing files get adjacent `.dsh-tui-backup-*` copies. Repeated
  configuration adds no duplicate block or PATH entry. Foreign `dsh-tui` files,
  linked config files and malformed managed blocks are refused before package
  installation; use `--no-path` for manually maintained dotfiles or other shells.
- If permissions change after preflight and command setup fails, the verified
  profile remains installed. The installer explicitly reports incomplete PATH
  setup and prints the working Node command; fix permissions and rerun.

自动配置的是用户 PATH，不是 API Key。不会覆盖全局 `dsh`、系统 PATH 或其他环境变量。
安装进程无法修改已经打开的父终端环境，需要新开终端；Windows 应完全退出再打开终端应用。
更新已安装的 profile 前仍应先退出 TUI。要撤销自动配置，删除生成的命令及相应 PATH
标记块／Windows 用户 PATH 中新增的目录；备份只用于核对恢复，避免覆盖备份后新增的个人设置。
如卸载或更换了安装时使用的 Node，重新运行安装器更新命令中固定的 Node 路径。

## Options / 参数

```sh
node scripts/install.mjs --help
node scripts/install.mjs --check
node scripts/install.mjs --no-path
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
  the temporary-directory path short. The installer does not change system
  long-path policy; its only registry write is the optional current-user PATH update.
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
installed koffi/node-pty probe succeeded. Focused transaction tests include a
native-probe failure that preserves the old installation.

The CLI resolves its entry path before deciding whether to run, including macOS
`/var` → `/private/var` temporary-directory aliases. A regression test verifies
that invoking the downloaded entry through a symlink prints help instead of
silently returning success without running the installer.

CMD regression cases run only on the Windows CI runner: real installer help,
quoted paths containing spaces, `&` and `!`, argument forwarding without
PowerShell on PATH, installer failure exit codes, missing Node, missing curl,
and cleanup after a failed standalone download (using a closed local proxy).
These cases are explicitly skipped on macOS/Linux; a local pass there is not
Windows execution evidence. CMD quote/expansion rules follow Microsoft's
[cmd](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd)
and [setlocal](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/setlocal) documentation.

Environment/PATH acceptance (2026-11-09): the real `--check --no-path` CLI passed
Node/npm/Git, write/disk and npm/GitHub connectivity checks against a temporary
installation path, without installing packages or changing personal shell files.
Real bash and fresh interactive zsh sessions launched the generated `dsh-tui`
fixture command, preserving arguments/cwd and avoiding duplicate PATH entries.
Preflight failures, config backups, idempotency, foreign-file protection, and
post-install PATH failure reporting are covered by tests. Windows CI additionally
runs the generated CMD launcher and registry-update logic against a disposable
HKCU test key, checking raw expandable entries and duplicate prevention without
changing actual user PATH. Windows execution results remain pending until that
runner passes; macOS tests do not certify Windows or Linux native installation.
