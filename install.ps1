# Requires PowerShell 7. Run in Windows Terminal for the TUI.
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Use PowerShell 7 in Windows Terminal.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node >= 22.19 (with npm): https://nodejs.org/ , then reopen your terminal.' }
$setupDir = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-tui-bootstrap-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $setupDir | Out-Null
try {
    $installer = Join-Path $setupDir 'install.mjs'
    Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/Qyn77/dsh-tui/main/scripts/install.mjs' -OutFile $installer -TimeoutSec 120
    & node $installer @args
    if ($LASTEXITCODE -ne 0) { throw "dsh-tui installation failed (exit $LASTEXITCODE)." }
} finally {
    Remove-Item -LiteralPath $setupDir -Recurse -Force
}
