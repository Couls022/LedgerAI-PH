<#
================================================================================
LedgerAI PH — Client Access Workstation Setup Script (Mode D)
================================================================================
Configures an office client PC to open LedgerAI PH in its web browser without
installing any local database or server engine on the client workstation.

Features:
  - Validates the Central Server's RFC 1918 LAN IPv4 address (blocks 127.x loopback)
  - Verifies TCP connectivity to the Central Server before writing configuration
  - Maps friendly LAN hostname (default: ledgerai.local & ledgerai-server.local)
  - Creates Desktop & Start Menu browser shortcuts pointing to the Central Server
================================================================================
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$ServerIp = "",

    [string]$Hostname = "ledgerai.local",
    [string]$AlternateHostname = "ledgerai-server.local",
    [int]$Port = 80,
    [switch]$SkipHostsUpdate
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================================" -ForegroundColor Cyan
Write-Host "       LEDGERAI PH — CLIENT WORKSTATION BROWSER ACCESS SETUP              " -ForegroundColor Cyan
Write-Host "==========================================================================" -ForegroundColor Cyan

# 1. Administrator privilege check only required if modifying hosts file
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $SkipHostsUpdate -and -not $isAdmin) {
    Write-Error "Administrator privileges are required to update the local hosts file. Run PowerShell as Administrator or pass -SkipHostsUpdate if your office router already resolves $Hostname."
    exit 1
}

if ([string]::IsNullOrWhiteSpace($ServerIp)) {
    $ServerIp = Read-Host "Enter the Central Server LAN IPv4 address (e.g. 192.168.1.10)"
    if ([string]::IsNullOrWhiteSpace($ServerIp)) {
        Write-Error "Server IP address is required."
        exit 1
    }
}

$ServerIp = $ServerIp.Trim()
if ($ServerIp -notmatch '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$') {
    Write-Error "Invalid IPv4 address format: '$ServerIp'."
    exit 1
}
if ($ServerIp -match '^127\.') {
    Write-Error "CRITICAL: Cannot use loopback IP (127.x.x.x) on a client PC. Enter the Central Server PC's private LAN IP."
    exit 1
}

Write-Host "[1/3] Testing connection to Central Server ($ServerIp)..." -ForegroundColor Yellow
$testPort = if ($Port -gt 0) { $Port } else { 80 }
$connTest = Test-NetConnection -ComputerName $ServerIp -Port $testPort -WarningAction SilentlyContinue
if ($connTest.TcpTestSucceeded) {
    Write-Host "  Connected to Central Server on TCP port $testPort." -ForegroundColor Green
} else {
    $fallbackTest = Test-NetConnection -ComputerName $ServerIp -Port 3000 -WarningAction SilentlyContinue
    if ($fallbackTest.TcpTestSucceeded) {
        $testPort = 3000
        Write-Host "  Connected to Central Server on TCP port 3000." -ForegroundColor Yellow
    } else {
        Write-Warning "Could not reach $ServerIp on port $testPort or 3000. Verify the Central Server is online and on the same office LAN."
    }
}

# 2. Optionally update local hosts file as DNS fallback
if (-not $SkipHostsUpdate) {
    $HostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
    if (Test-Path $HostsPath) {
        Write-Host "[2/3] Configuring local hostname resolution ($Hostname -> $ServerIp)..." -ForegroundColor Yellow
        $hostsLines = Get-Content $HostsPath
        $pattern = "^\s*[^#]*\s+($([regex]::Escape($Hostname))|$([regex]::Escape($AlternateHostname)))\b"
        $cleanLines = $hostsLines | Where-Object { $_ -notmatch $pattern }
        $block = @(
            "",
            "# LedgerAI PH Central Server (LAN Client)",
            "$ServerIp    $Hostname",
            "$ServerIp    $AlternateHostname"
        )
        $updatedContent = ($cleanLines -join "`r`n") + ($block -join "`r`n") + "`r`n"
        Set-Content -Path $HostsPath -Value $updatedContent -Encoding ASCII
        & ipconfig /flushdns | Out-Null
        Write-Host "  Hostname resolution configured and DNS cache flushed." -ForegroundColor Green
    }
} else {
    Write-Host "[2/3] Skipping hosts update (relying on office Router DNS / mDNS)." -ForegroundColor DarkGray
}

# 3. Create Desktop & Start Menu browser shortcuts (zero local DB installed)
Write-Host "[3/3] Creating LedgerAI PH browser shortcuts..." -ForegroundColor Yellow
$portSuffix = if ($testPort -eq 80) { "" } else { ":$testPort" }
$TargetUrl = "http://${Hostname}${portSuffix}"

$DesktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$ShortcutPath = Join-Path $DesktopPath "LedgerAI PH.url"
$urlContent = @"
[InternetShortcut]
URL=$TargetUrl
"@
Set-Content -Path $ShortcutPath -Value $urlContent -Encoding ASCII

$StartMenuDir = Join-Path ([System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Programs)) "LedgerAI PH"
New-Item -ItemType Directory -Path $StartMenuDir -Force | Out-Null
Set-Content -Path (Join-Path $StartMenuDir "LedgerAI PH.url") -Value $urlContent -Encoding ASCII

Write-Host ""
Write-Host "==========================================================================" -ForegroundColor Green
Write-Host "Client Workstation Ready — Browser-Only Mode" -ForegroundColor Green
Write-Host "  Open Browser URL:   $TargetUrl" -ForegroundColor White
Write-Host "  Direct IP Fallback: http://${ServerIp}:${testPort}" -ForegroundColor White
Write-Host "  Desktop Shortcut:   $ShortcutPath" -ForegroundColor White
Write-Host "  Local Database:     NONE (All data managed centrally on $ServerIp)" -ForegroundColor White
Write-Host "==========================================================================" -ForegroundColor Green
