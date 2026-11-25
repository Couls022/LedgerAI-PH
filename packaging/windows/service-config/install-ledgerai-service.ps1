<#
================================================================================
LedgerAI PH — Windows Background Service Installation Script
================================================================================
Supports Enterprise Deployment Modes:
  - Server            : Central multi-company LAN server (background service only)
  - ServerAndDesktop  : Central LAN server + local desktop workspace on PC 1
  - SinglePC          : Standalone single-PC local-only mode (127.0.0.1 only)

Features:
  - Installs LedgerAI PH as an automatic Windows Service (starts on boot before login)
  - Configures automatic crash recovery (sc.exe failure restart policy)
  - Scopes Windows Defender Firewall rules to Private & Domain profiles ONLY
  - Enforces single-instance database ownership on the central server
================================================================================
#>

param(
    [ValidateSet("Server", "ServerAndDesktop", "SinglePC")]
    [string]$InstallMode = "ServerAndDesktop",

    [string]$InstallDir = "$env:ProgramFiles\LedgerAI PH",
    [string]$DataDir = "$env:ProgramData\LedgerAI\data",
    [string]$ServiceName = "LedgerAIServerService",
    [string]$DisplayName = "LedgerAI PH Server Service",
    [string]$LanHostname = "ledgerai.local",
    [int]$Port = 3000,
    [switch]$EnablePort80Proxy
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

# 2. Ensure central data & log directories exist with restricted NTFS ACLs
$LogDir = Join-Path $env:ProgramData "LedgerAI\logs"
New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

# Restrict central database & log directories to SYSTEM and Administrators (deny unprivileged local Users)
try {
    & icacls "$DataDir" /inheritance:r /grant:r "NT AUTHORITY\SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" | Out-Null
    & icacls "$LogDir" /inheritance:r /grant:r "NT AUTHORITY\SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" | Out-Null
    Write-Host "[0/5] Applied strict NTFS ACLs (SYSTEM & Administrators only) to $DataDir and $LogDir" -ForegroundColor Green
} catch {
    Write-Warning "Could not apply icacls restrictions automatically: $_"
}

# 3. Map InstallMode to runtime environment variables
$DeploymentModeEnv = switch ($InstallMode) {
    "Server"           { "SERVER" }
    "SinglePC"         { "SINGLE_PC" }
    default            { "SERVER_AND_DESKTOP" }
}
# Bind strictly to internal loopback 127.0.0.1 when SinglePC OR behind Windows Port 80 netsh portproxy;
# otherwise bind 0.0.0.0 for direct LAN port access.
$UseLoopbackBind = ($InstallMode -eq "SinglePC") -or [bool]$EnablePort80Proxy
$BindHost = if ($UseLoopbackBind) { "127.0.0.1" } else { "0.0.0.0" }
$HostEnvArg = if ($UseLoopbackBind) { "HOST=127.0.0.1" } else { "HOST=0.0.0.0" }

# 4. Locate Service Binaries and Node Runtime
$ServerScript = Join-Path $InstallDir "dist\server.cjs"
$NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) {
    $NodeExe = Join-Path $InstallDir "nodejs\node.exe"
}
if (-not (Test-Path $ServerScript)) {
    Write-Warning "Server entry point not found at: $ServerScript. Checking current working directory..."
    $ServerScript = Join-Path (Get-Location) "dist\server.cjs"
}

Write-Host "[1/5] Install Mode:      $InstallMode ($DeploymentModeEnv)" -ForegroundColor Green
Write-Host "[1/5] Data Directory:    $DataDir" -ForegroundColor Green
Write-Host "[1/5] Bind Address:      ${BindHost}:${Port}" -ForegroundColor Green
Write-Host "[1/5] Node Executable:   $NodeExe" -ForegroundColor Green
Write-Host "[1/5] Server Payload:    $ServerScript" -ForegroundColor Green

# 5. Stop and remove existing service cleanly if present
Write-Host "[2/5] Registering Windows Background Service: $ServiceName..." -ForegroundColor Yellow
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Stopping existing $ServiceName..." -ForegroundColor DarkGray
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

$NssmExe = Join-Path $InstallDir "tools\nssm.exe"
if (-not (Test-Path $NssmExe)) {
    $pathNssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
    if ($pathNssm) { $NssmExe = $pathNssm }
}

if (Test-Path $NssmExe) {
    & $NssmExe install $ServiceName "$NodeExe" "$ServerScript"
    & $NssmExe set $ServiceName AppDirectory "$InstallDir"
    & $NssmExe set $ServiceName DisplayName "$DisplayName"
    & $NssmExe set $ServiceName Description "LedgerAI PH Centralized Multi-Company Accounting & BIR Compliance Server"
    & $NssmExe set $ServiceName Start SERVICE_AUTO_START
    & $NssmExe set $ServiceName AppEnvironmentExtra `
        "NODE_ENV=production" `
        "PORT=$Port" `
        $HostEnvArg `
        "LEDGERAI_DEPLOYMENT_MODE=$DeploymentModeEnv" `
        "LEDGERAI_DATA_DIR=$DataDir" `
        "LEDGERAI_LAN_HOSTNAME=$LanHostname"
    & $NssmExe set $ServiceName AppStdout (Join-Path $LogDir "service-stdout.log")
    & $NssmExe set $ServiceName AppStderr (Join-Path $LogDir "service-stderr.log")
    & $NssmExe set $ServiceName AppRotateFiles 1
    & $NssmExe set $ServiceName AppRotateBytes 10485760
} else {
    Write-Error "PREREQUISITE MISSING: NSSM (nssm.exe) was not found at '$InstallDir\tools\nssm.exe' or in PATH. Plain node.exe cannot respond to Windows SCM control signals directly (Error 1053). Place nssm.exe (64-bit) in '$InstallDir\tools\nssm.exe' or install NSSM and re-run this script."
    exit 2
}

# 6. Configure Automatic Windows Service Failure Recovery (5s -> 15s -> 60s)
Write-Host "[3/5] Configuring automatic Windows Service recovery..." -ForegroundColor Yellow
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
& sc.exe failureflag $ServiceName 1 | Out-Null
Write-Host "  Automatic restart on failure enabled." -ForegroundColor Green

# 7. Configure Windows Defender Firewall (Private & Domain Profiles ONLY; Never Public)
Write-Host "[4/5] Configuring Windows Defender Firewall..." -ForegroundColor Yellow
Remove-NetFirewallRule -DisplayName "LedgerAI PH Server (Port $Port)" -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "LedgerAI PH Server (Port 3000)" -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "LedgerAI PH HTTP Proxy (Port 80)" -ErrorAction SilentlyContinue

if ($InstallMode -eq "SinglePC") {
    Write-Host "  Single-PC Mode: Inbound LAN firewall rules skipped (127.0.0.1 loopback only)." -ForegroundColor Green
} else {
    if ($EnablePort80Proxy) {
        New-NetFirewallRule -DisplayName "LedgerAI PH HTTP Proxy (Port 80)" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow -Profile Domain,Private | Out-Null
        Write-Host "  TCP Port 80 allowed on Domain & Private networks only (Port $Port stays internal; Public blocked)." -ForegroundColor Green
    } else {
        New-NetFirewallRule -DisplayName "LedgerAI PH Server (Port $Port)" -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow -Profile Domain,Private | Out-Null
        Write-Host "  TCP Port $Port allowed on Domain & Private networks only (Public blocked)." -ForegroundColor Green
    }
}

# 8. Start Background Service & Verify Live Health Endpoint
Write-Host "[5/5] Starting $ServiceName and verifying /api/health..." -ForegroundColor Yellow
Start-Service -Name $ServiceName
Start-Sleep -Seconds 3

$svcState = (Get-Service -Name $ServiceName).Status
if ($svcState -ne "Running") {
    Write-Error "Service $ServiceName failed to reach Running state (Current: $svcState). Inspect logs in $LogDir."
    exit 3
}

$healthOk = $false
for ($attempt = 1; $attempt -le 10; $attempt++) {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2 -ErrorAction Stop
        if ($resp.status -eq "healthy") {
            $healthOk = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 1
    }
}

if (-not $healthOk) {
    Write-Warning "Service is Running, but http://127.0.0.1:$Port/api/health did not respond healthy within 10s. Check $LogDir\service-stderr.log."
} else {
    Write-Host "  Health check verified: http://127.0.0.1:$Port/api/health -> healthy" -ForegroundColor Green
}

Write-Host "==========================================================================" -ForegroundColor Green
Write-Host "LedgerAI PH Background Service Installation Complete" -ForegroundColor Green
Write-Host "  Service Name:     $ServiceName ($svcState)" -ForegroundColor White
Write-Host "  Deployment Mode:  $InstallMode ($DeploymentModeEnv)" -ForegroundColor White
Write-Host "  Central Data Dir: $DataDir" -ForegroundColor White
Write-Host "  Local URL:        http://127.0.0.1:$Port" -ForegroundColor White
if ($InstallMode -ne "SinglePC") {
    $lanUrl = if ($EnablePort80Proxy) { "http://$LanHostname" } else { "http://${LanHostname}:$Port" }
    Write-Host "  LAN Browser URL:  $lanUrl" -ForegroundColor White
}
Write-Host "==========================================================================" -ForegroundColor Green
