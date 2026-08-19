<#
================================================================================
LedgerAI PH — Workstation LAN Client Configuration Script
================================================================================
Configures a client workstation PC on the local network (LAN) to resolve
http://ledgerai.ph to the dedicated LedgerAI Server Unit.

Usage:
  .\configure-lan-client.ps1 -ServerIp 192.168.1.10
  .\configure-lan-client.ps1 -ServerIp 10.0.0.50
================================================================================
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$ServerIp = "",
    
    [switch]$CreateDesktopShortcut
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================================" -ForegroundColor Cyan
Write-Host "       LEDGERAI PH — WORKSTATION LAN CLIENT RESOLUTION SETUP              " -ForegroundColor Cyan
Write-Host "==========================================================================" -ForegroundColor Cyan

# 1. Administrator Privilege Verification
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "Administrator privileges are required to configure local hosts resolution. Please run PowerShell as Administrator."
    exit 1
}

# 2. Prompt for Server IP if not provided
if ([string]::IsNullOrWhiteSpace($ServerIp)) {
    Write-Host ""
    $ServerIp = Read-Host "Enter the IP Address of the LedgerAI Server Unit (e.g. 192.168.1.10)"
    if ([string]::IsNullOrWhiteSpace($ServerIp)) {
        Write-Error "Server IP address is required."
        exit 1
    }
}

$ServerIp = $ServerIp.Trim()

# Validate IPv4 Format
if ($ServerIp -notmatch '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$') {
    Write-Error "Invalid IPv4 address format: '$ServerIp'."
    exit 1
}

# Protect against accidental loopback assignment on client PCs
if ($ServerIp -match '^127\.') {
    Write-Error "CRITICAL: Cannot use loopback IP (127.x.x.x) on a client workstation. You must provide the Server Unit's LAN IP (e.g. 192.168.x.x)."
    exit 1
}

Write-Host "[1/3] Target LedgerAI Server Unit IP: $ServerIp" -ForegroundColor Yellow

# 3. Test Connectivity to Server Unit Port 80 / 3000
Write-Host "[2/3] Verifying network connectivity to $ServerIp..." -ForegroundColor Yellow
$port80Test = Test-NetConnection -ComputerName $ServerIp -Port 80 -WarningAction SilentlyContinue
if ($port80Test.TcpTestSucceeded) {
    Write-Host "  ✔ Connected successfully to LedgerAI Server on Port 80." -ForegroundColor Green
} else {
    $port3000Test = Test-NetConnection -ComputerName $ServerIp -Port 3000 -WarningAction SilentlyContinue
    if ($port3000Test.TcpTestSucceeded) {
        Write-Host "  ✔ Connected to LedgerAI Server on internal Port 3000 (Port 80 proxy may still be starting)." -ForegroundColor Yellow
    } else {
        Write-Warning "  ⚠️ Could not reach $ServerIp on Port 80 or 3000. Please verify the Server Unit is powered on, firewall rules are enabled, and both PCs are on the same subnet."
    }
}

# 4. Safely Update Client hosts file
$HostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
if (Test-Path $HostsPath) {
    Write-Host "[3/3] Updating local hosts file at $HostsPath..." -ForegroundColor Yellow
    
    $hostsLines = Get-Content $HostsPath
    # Strip any existing ledgerai.ph entries (including obsolete 127.0.0.1 or old IPs)
    $cleanLines = $hostsLines | Where-Object { $_ -notmatch '^\s*[^#]*\s+ledgerai\.ph\b' }
    
    $newEntry = "$ServerIp    ledgerai.ph"
    $updatedContent = ($cleanLines -join "`r`n") + "`r`n# LedgerAI PH Server Resolution (LAN Workstation)`r`n$newEntry`r`n"
    
    Set-Content -Path $HostsPath -Value $updatedContent -Encoding ASCII
    Write-Host "  ✔ Configured 'ledgerai.ph' -> '$ServerIp' in local hosts file." -ForegroundColor Green
} else {
    Write-Error "Hosts file not found at $HostsPath."
    exit 1
}

# 5. Flush Local DNS Cache
& ipconfig /flushdns | Out-Null
Write-Host "  ✔ Local DNS resolver cache flushed." -ForegroundColor Green

# 6. Optional Desktop Shortcut Creation
$DesktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::CommonDesktopDirectory)
if (-not (Test-Path $DesktopPath)) {
    $DesktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
}
$ShortcutPath = Join-Path $DesktopPath "LedgerAI PH.url"
$urlContent = @"
[InternetShortcut]
URL=http://ledgerai.ph
"@
Set-Content -Path $ShortcutPath -Value $urlContent -Encoding ASCII
Write-Host "  ✔ Created Desktop Shortcut: 'LedgerAI PH' (http://ledgerai.ph)" -ForegroundColor Green

Write-Host ""
Write-Host "==========================================================================" -ForegroundColor Green
Write-Host "✔ Client Workstation Configuration Complete!" -ForegroundColor Green
Write-Host "  You can now open: http://ledgerai.ph in your web browser." -ForegroundColor White
Write-Host "  Requests will resolve directly to LedgerAI Server at: $ServerIp" -ForegroundColor White
Write-Host "==========================================================================" -ForegroundColor Green
