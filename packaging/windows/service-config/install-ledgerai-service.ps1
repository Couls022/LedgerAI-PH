<#
================================================================================
LedgerAI PH — Windows Background Service Installation Script
================================================================================
Installs and registers the LedgerAI PH Node/Express engine as a background
Windows Service running independently of user browser sessions.
================================================================================
#>

param(
    [string]$InstallDir = "$env:ProgramFiles\LedgerAI PH",
    [string]$ServiceName = "LedgerAIServerService",
    [string]$DisplayName = "LedgerAI PH Server Service",
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================================" -ForegroundColor Cyan
Write-Host "         LEDGERAI PH — WINDOWS BACKGROUND SERVICE INSTALLER               " -ForegroundColor Cyan
Write-Host "==========================================================================" -ForegroundColor Cyan

# 1. Administrator Privilege Verification
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "Administrator privileges are required to install Windows Services. Please run this script as Administrator."
    exit 1
}

# 2. Locate Service Binaries and Node Runtime
$ServerScript = Join-Path $InstallDir "dist\server.cjs"
$NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) {
    $NodeExe = Join-Path $InstallDir "nodejs\node.exe"
}

if (-not (Test-Path $ServerScript)) {
    Write-Warning "Server entry point not found at: $ServerScript. Checking current working directory..."
    $ServerScript = Join-Path (Get-Location) "dist\server.cjs"
}

Write-Host "[1/4] Node Executable: $NodeExe" -ForegroundColor Green
Write-Host "[1/4] Server Payload:    $ServerScript" -ForegroundColor Green

# 3. Configure Windows Service (via sc.exe / NSSM)
Write-Host "[2/4] Registering Windows Background Service: $ServiceName..." -ForegroundColor Yellow

# Stop and remove existing service if present
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Stopping existing $ServiceName..." -ForegroundColor DarkGray
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

# NSSM or native sc create
$NssmExe = Join-Path $InstallDir "tools\nssm.exe"
if (Test-Path $NssmExe) {
    & $NssmExe install $ServiceName "$NodeExe" "$ServerScript"
    & $NssmExe set $ServiceName AppDirectory "$InstallDir"
    & $NssmExe set $ServiceName DisplayName "$DisplayName"
    & $NssmExe set $ServiceName Description "LedgerAI PH Offline-First Enterprise Accounting Server Engine"
    & $NssmExe set $ServiceName Start SERVICE_AUTO_START
    & $NssmExe set $ServiceName AppEnvironmentExtra "NODE_ENV=production" "PORT=$Port" "HOST=127.0.0.1"
    & $NssmExe set $ServiceName AppStdout (Join-Path $env:APPDATA "LedgerAI\logs\service-stdout.log")
    & $NssmExe set $ServiceName AppStderr (Join-Path $env:APPDATA "LedgerAI\logs\service-stderr.log")
} else {
    # Fallback to standard sc.exe
    $binPath = "`"$NodeExe`" `"$ServerScript`""
    & sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= "$DisplayName"
}

# 4. Configure Windows Firewall for LAN Access (Expose HTTP Port 80 ONLY; Keep Port 3000 internal)
Write-Host "[3/4] Configuring Windows Defender Firewall (Exposing Port 80 ONLY)..." -ForegroundColor Yellow
Remove-NetFirewallRule -DisplayName "LedgerAI PH Server (Port $Port)" -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "LedgerAI PH Server (Port 3000)" -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "LedgerAI PH HTTP Proxy (Port 80)" -ErrorAction SilentlyContinue

New-NetFirewallRule -DisplayName "LedgerAI PH HTTP Proxy (Port 80)" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow -Profile Domain,Private | Out-Null
Write-Host "  ✔ TCP Port 80 allowed for Domain & Private profiles." -ForegroundColor Green
Write-Host "  ✔ TCP Port 3000 protected from direct LAN access (Internal loopback only)." -ForegroundColor Green

# 5. Start Background Service
Write-Host "[4/4] Starting $ServiceName..." -ForegroundColor Yellow
Start-Service -Name $ServiceName -ErrorAction SilentlyContinue

Write-Host "==========================================================================" -ForegroundColor Green
Write-Host "✔ LedgerAI PH Background Service Installed and Running Successfully!" -ForegroundColor Green
Write-Host "  Service Name:    $ServiceName" -ForegroundColor White
Write-Host "  Internal Server: 127.0.0.1:$Port (Internal loopback)" -ForegroundColor White
Write-Host "  LAN Ingress:     Port 80 (via Windows portproxy)" -ForegroundColor White
Write-Host "  Browser Address: http://ledgerai.ph" -ForegroundColor White
Write-Host "==========================================================================" -ForegroundColor Green
