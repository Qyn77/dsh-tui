@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem CMD installation entry; TUI usage still requires a supported terminal.
node --version >nul 2>&1
if errorlevel 1 goto missing_node
if exist "%~dp0scripts\install.mjs" goto local_installer

curl.exe --version >nul 2>&1
if errorlevel 1 goto missing_curl
set "dsh_setup_dir=%TEMP%\dsh-tui-bootstrap-%RANDOM%-%RANDOM%"
mkdir "%dsh_setup_dir%" >nul 2>&1
if errorlevel 1 goto temp_failed
curl.exe --fail --show-error --silent --location --connect-timeout 15 --max-time 120 "https://raw.githubusercontent.com/Qyn77/dsh-tui/main/scripts/install.mjs" -o "%dsh_setup_dir%\install.mjs"
if errorlevel 1 goto download_failed
node "%dsh_setup_dir%\install.mjs" %*
set "dsh_setup_exit=%errorlevel%"
goto cleanup

:local_installer
node "%~dp0scripts\install.mjs" %*
exit /b %errorlevel%

:download_failed
set "dsh_setup_exit=1"
echo Failed to download the installer. Check your network and retry. >&2
:cleanup
del /q "%dsh_setup_dir%\install.mjs" >nul 2>&1
rmdir "%dsh_setup_dir%" >nul 2>&1
exit /b %dsh_setup_exit%

:missing_node
echo Install Node 22.19 or newer with npm from https://nodejs.org/ and reopen CMD. >&2
exit /b 1
:missing_curl
echo curl.exe is required. Use a current Windows installation or clone the repository and run node scripts/install.mjs. >&2
exit /b 1
:temp_failed
echo Cannot create a temporary installer directory. Check TEMP and retry. >&2
exit /b 1
