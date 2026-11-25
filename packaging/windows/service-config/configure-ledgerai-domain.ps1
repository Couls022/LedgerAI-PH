<#
================================================================================
LedgerAI PH — Central Server Hostname & LAN Port Configuration Script
================================================================================
Configures the Central Server (PC 1) for friendly office LAN browser access:
  1. Local Server hosts resolution (127.0.0.1 ledgerai.local & ledgerai-server.local)
  2. Optional Port 80 -> Internal Port 3000 portproxy forwarding across LAN interfaces
  3. Windows Defender Firewall rule scoped strictly to Domain & Private profiles
  4. Prints Router DNS A-record and fallback client workstation setup commands

Never modifies external/public DNS and never opens the Windows Public firewall profile.
================================================================================
#>

param(
    [string]$Hostname = "ledgerai.local",
    [string]$AlternateHostname = "ledgerai-server.local",
    [int]$InternalPort = 3000,
    [switch]$EnablePort80Proxy = $true
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================================" -ForegroundColor Cyan
Write-Host "       LEDGERAI PH — CENTRAL SERVER LAN HOSTNAME & PORT SETUP             " -ForegroundColor Cyan
Write-Host "==========================================================================" -ForegroundColor Cyan

# 1. Administrator Privilege Verification
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "Administrator privileges required to configure LAN network parameters."
    exit 1
}

# 2. Detect Server Unit Active RFC 1918 Private LAN IPv4 Addresses
$detectedIps = @()
try {
    $detectedIps = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
        ($_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)') -and
        $_.InterfaceAlias -notmatch 'vEthernet|Loopback|VirtualBox|VMware|WSL'
    }).IPAddress
} catch {
    $detectedIps = @()
}

$primaryLanIp = if ($detectedIps.Count -gt 0) { $detectedIps[0] } else { "127.0.0.1" }
Write-Host "[1/4] Detected Primary Private LAN IPv4: $primaryLanIp" -ForegroundColor Green

# 3. Update Server Unit hosts file cleanly
$HostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
if (Test-Path $HostsPath) {
    $hostsLines = Get-Content $HostsPath
    $pattern = "^\s*[^#]*\s+($([regex]::Escape($Hostname))|$([regex]::Escape($AlternateHostname)))\b"
    $cleanLines = $hostsLines | Where-Object { $_ -notmatch $pattern }
    $block = @(
        "",
        "# LedgerAI PH Central Server Local Hostname Resolution",
        "127.0.0.1    $Hostname",
        "127.0.0.1    $AlternateHostname"
    )
    $updatedContent = ($cleanLines -join "`r`n") + ($block -join "`r`n") + "`r`n"
    Set-Content -Path $HostsPath -Value $updatedContent -Encoding ASCII
    Write-Host "[2/4] Configured local hosts: 127.0.0.1 -> $Hostname, $AlternateHostname" -ForegroundColor Green
}

# 4. Configure Port 80 -> InternalPort portproxy if enabled
if ($EnablePort80Proxy) {
    Write-Host "[3/4] Configuring Port 80 -> Port $InternalPort portproxy forwarding..." -ForegroundColor Yellow
    $port80Check = Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue
    if ($port80Check) {
        Write-Warning "TCP Port 80 already has an active listener (PID $($port80Check[0].OwningProcess)). Verify IIS/W3SVC is not conflicting with netsh portproxy."
    }
    & netsh interface portproxy delete v4tov4 listenport=80 listenaddress=0.0.0.0 2>$null
    & netsh interface portproxy delete v4tov4 listenport=80 listenaddress=127.0.0.1 2>$null
    if ($InternalPort -eq 3000) {
        & netsh interface portproxy add v4tov4 listenport=80 listenaddress=0.0.0.0 connectport=3000 connectaddress=127.0.0.1
        & netsh interface portproxy add v4tov4 listenport=80 listenaddress=127.0.0.1 connectport=3000 connectaddress=127.0.0.1
    } else {
        & netsh interface portproxy add v4tov4 listenport=80 listenaddress=0.0.0.0 connectport=$InternalPort connectaddress=127.0.0.1
        & netsh interface portproxy add v4tov4 listenport=80 listenaddress=127.0.0.1 connectport=$InternalPort connectaddress=127.0.0.1
    }
    Write-Host "  Port 80 -> $InternalPort forwarding active." -ForegroundColor Green
} else {
    Write-Host "[3/4] Port 80 proxy skipped; serving directly on TCP $InternalPort." -ForegroundColor Yellow
}

# 5. Windows Defender Firewall (Domain & Private profiles ONLY)
Write-Host "[4/4] Registering Windows Defender Firewall rules (Domain & Private only)..." -ForegroundColor Yellow
Remove-NetFirewallRule -DisplayName "LedgerAI PH Server (Port $InternalPort)" -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "LedgerAI PH Server (Port 3000)" -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "LedgerAI PH HTTP Proxy (Port 80)" -ErrorAction SilentlyContinue

if ($EnablePort80Proxy) {
    New-NetFirewallRule -DisplayName "LedgerAI PH HTTP Proxy (Port 80)" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow -Profile Domain,Private | Out-Null
    Write-Host "  Allowed inbound TCP 80 on Domain & Private networks (Port $InternalPort stays internal)." -ForegroundColor Green
} else {
    New-NetFirewallRule -DisplayName "LedgerAI PH Server (Port $InternalPort)" -Direction Inbound -LocalPort $InternalPort -Protocol TCP -Action Allow -Profile Domain,Private | Out-Null
    Write-Host "  Allowed inbound TCP $InternalPort on Domain & Private networks." -ForegroundColor Green
}

$portSuffix = if ($EnablePort80Proxy) { "" } else { ":$InternalPort" }
Write-Host ""
Write-Host "==========================================================================" -ForegroundColor Green
Write-Host "LedgerAI PH Central Server LAN Access Ready" -ForegroundColor Green
Write-Host "  Primary LAN URL:    http://${Hostname}${portSuffix}" -ForegroundColor White
Write-Host "  Alternate LAN URL:  http://${AlternateHostname}${portSuffix}" -ForegroundColor White
Write-Host "  Direct IP Fallback: http://${primaryLanIp}${portSuffix}" -ForegroundColor White
Write-Host ""
Write-Host "  NOTE: mDNS (.local) requires Windows host naming or Router DNS A-Record." -ForegroundColor Cyan
Write-Host "  Recommended Router DNS A-Record (Zero Client Setup):" -ForegroundColor Cyan
Write-Host "    $Hostname  -->  $primaryLanIp" -ForegroundColor Yellow
Write-Host "  Optional Client Workstation Script (if router DNS / mDNS unavailable):" -ForegroundColor Cyan
Write-Host "    .\configure-lan-client.ps1 -ServerIp $primaryLanIp -Hostname $Hostname" -ForegroundColor Yellow
Write-Host "==========================================================================" -ForegroundColor Green
