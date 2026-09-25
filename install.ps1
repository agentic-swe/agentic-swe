$ErrorActionPreference = "Stop"

$Repo = if ($env:AGENTIC_SWE_REPO) { $env:AGENTIC_SWE_REPO } else { "agentic-swe/agentic-swe" }
$Ref = if ($env:AGENTIC_SWE_REF) { $env:AGENTIC_SWE_REF } else { "main" }
$InstallDir = if ($env:AGENTIC_SWE_HOME) { $env:AGENTIC_SWE_HOME } else { Join-Path $HOME ".local\share\agentic-swe" }
$BinDir = if ($env:AGENTIC_SWE_BIN_DIR) { $env:AGENTIC_SWE_BIN_DIR } else { Join-Path $HOME ".local\bin" }
$ArchiveUrl = if ($env:AGENTIC_SWE_ARCHIVE_URL) {
    $env:AGENTIC_SWE_ARCHIVE_URL
} else {
    "https://github.com/$Repo/archive/$Ref.zip"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Agentic SWE requires Node.js 18 or newer: https://nodejs.org/"
}
$NodeMajor = [int](& node -p 'process.versions.node.split(".")[0]')
if ($NodeMajor -lt 18) {
    throw "Agentic SWE requires Node.js 18 or newer (found $(& node --version))"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm must be available with Node.js"
}

$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("agentic-swe-" + [guid]::NewGuid())
$Archive = Join-Path $TempRoot "agentic-swe.zip"
$Extracted = Join-Path $TempRoot "extracted"

try {
    New-Item -ItemType Directory -Force -Path $Extracted | Out-Null
    Write-Host "Downloading Agentic SWE ($Ref)..."
    Invoke-WebRequest -Uri $ArchiveUrl -OutFile $Archive
    Expand-Archive -Path $Archive -DestinationPath $Extracted
    $Pack = Get-ChildItem -Path $Extracted -Directory | Select-Object -First 1
    if (-not $Pack -or -not (Test-Path (Join-Path $Pack.FullName "bin\agentic-swe.cjs"))) {
        throw "Downloaded archive is not an Agentic SWE tool release"
    }

    Write-Host "Installing runtime dependencies..."
    & npm install --prefix $Pack.FullName --omit=dev --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

    New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir), $BinDir | Out-Null
    $Backup = "$InstallDir.previous"
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Backup
    if (Test-Path $InstallDir) { Move-Item $InstallDir $Backup }
    try {
        Move-Item $Pack.FullName $InstallDir
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Backup
    } catch {
        if (Test-Path $Backup) { Move-Item $Backup $InstallDir }
        throw
    }

    $Launcher = Join-Path $BinDir "agentic-swe.cmd"
    "@echo off`r`nnode `"$InstallDir\bin\agentic-swe.cjs`" %*`r`n" | Set-Content -Encoding Ascii $Launcher
    Write-Host "Installed: $Launcher"

    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $PathEntries = @($UserPath -split ";" | Where-Object { $_ })
    if ($PathEntries -notcontains $BinDir) {
        [Environment]::SetEnvironmentVariable("Path", (($PathEntries + $BinDir) -join ";"), "User")
        Write-Host "Added $BinDir to your user PATH. Open a new terminal before running the tool."
    }
    Write-Host "Next: agentic-swe setup"
} finally {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $TempRoot
}
