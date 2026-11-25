<#
================================================================================
LedgerAI PH — Internal License Key Generator Windows Service Installer
================================================================================
Installs the internal License Authority Engine as a background Windows Service.
Runs headlessly on 127.0.0.1:4000 (Internal Only).
================================================================================
#>

param(
    [string]$InstallDir = "$env:ProgramFiles\LedgerAI Key Generator",
    [int]$Port = 4000
)

$ErrorActionPreference = "Stop"

$ServiceName = "LedgerAIKeyGeneratorService"
$DisplayName = "LedgerAI PH License Key Generator Service"

Write-Host "==========================================================================" -ForegroundColor Cyan
Write-Host "      LEDGERAI PH INTERNAL KEY GENERATOR SERVICE INSTALLER                " -ForegroundColor Cyan
Write-Host "==========================================================================" -ForegroundColor Cyan

# 1. Check Administrator Rights
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "CRITICAL: This script must be executed in an elevated PowerShell session (Run as Administrator)."
}

# 2. Check Service Existence
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "[1/3] Stopping existing $ServiceName..." -ForegroundColor Yellow
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# 3. Configure Logs Directory
$LogsDir = Join-Path $env:APPDATA "LedgerAI-Authority\logs"
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
}

# 4. Service Registration using NSSM or sc.exe
$NssmExe = Join-Path $InstallDir "nssm.exe"
$NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) {
    $NodeExe = "node.exe"
}

$ServerScript = Join-Path $InstallDir "dist-authority\authority-server.cjs"
if (-not (Test-Path $ServerScript)) {
    $ServerScript = Join-Path $InstallDir "authority-server.cjs"
}

Write-Host "[2/3] Registering Windows Service ($ServiceName)..." -ForegroundColor Yellow

if (Test-Path $NssmExe) {
    & $NssmExe install $ServiceName "$NodeExe" """$ServerScript"""
    & $NssmExe set $ServiceName AppDirectory "$InstallDir"
    & $NssmExe set $ServiceName DisplayName "$DisplayName"
    & $NssmExe set $ServiceName Description "LedgerAI PH Internal RSA Signing Authority Engine"
    & $NssmExe set $ServiceName Start SERVICE_AUTO_START
    & $NssmExe set $ServiceName AppEnvironmentExtra "NODE_ENV=production" "AUTHORITY_PORT=$Port" "HOST=127.0.0.1"
    & $NssmExe set $ServiceName AppStdout (Join-Path $LogsDir "authority-stdout.log")
    & $NssmExe set $ServiceName AppStderr (Join-Path $LogsDir "authority-stderr.log")
} else {
    $binPath = "$NodeExe ""$ServerScript"""
    & sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= "$DisplayName"
}

# 5. Start Background Service
Write-Host "[3/3] Starting $ServiceName..." -ForegroundColor Yellow
Start-Service -Name $ServiceName -ErrorAction SilentlyContinue

Write-Host "==========================================================================" -ForegroundColor Green
Write-Host "✔ LedgerAI PH Key Generator Background Service Installed!" -ForegroundColor Green
Write-Host "  Service Name:    $ServiceName" -ForegroundColor White
Write-Host "  Internal URL:    http://127.0.0.1:$Port" -ForegroundColor White
Write-Host "  Status:          Confidential Internal Authority Server" -ForegroundColor White
Write-Host "==========================================================================" -ForegroundColor Green
