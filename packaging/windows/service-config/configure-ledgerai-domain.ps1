<#
================================================================================
LedgerAI PH — Server Unit Hostname Resolution & Port Forwarding Script
================================================================================
Configures:
1. Local Server Unit hostname resolution (127.0.0.1 ledgerai.ph)
2. Global interface portproxy forwarding (Port 80 -> Internal Port 3000)
3. Windows Defender Firewall exceptions for LAN access
4. Generates dynamic client configuration details based on active LAN IPv4

Zero global DNS modification, zero router DNS changes, zero network hijacking.
================================================================================
#>

$ErrorActionPreference = "Stop"

Write-Host "==========================================================================" -ForegroundColor Cyan
Write-Host "         LEDGERAI PH — SERVER UNIT HOSTNAME & PORT CONFIGURATION          " -ForegroundColor Cyan
Write-Host "==========================================================================" -ForegroundColor Cyan

# 1. Administrator Privilege Verification
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "Administrator privileges required to configure system network parameters."
    exit 1
}

# 2. Detect Server Unit Active LAN IPv4 Addresses (Excluding loopback/APIPA/Virtual adapters)
$detectedIps = @()
try {
    $detectedIps = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { 
        $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|Loopback|VirtualBox|VMware'
    }).IPAddress
} catch {
    $detectedIps = @()
}

$primaryLanIp = if ($detectedIps.Count -gt 0) { $detectedIps[0] } else { "127.0.0.1" }
Write-Host "[1/4] Server Unit Primary LAN IPv4: $primaryLanIp" -ForegroundColor Green

# 3. Update Server Unit C:\Windows\System32\drivers\etc\hosts
$HostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$DomainEntry = "127.0.0.1    ledgerai.ph"

if (Test-Path $HostsPath) {
    $hostsLines = Get-Content $HostsPath
    $cleanLines = $hostsLines | Where-Object { $_ -notmatch '^\s*[^#]*\s+ledgerai\.ph\b' }
    $updatedContent = ($cleanLines -join "`r`n") + "`r`n# LedgerAI PH Local Server Unit Resolution`r`n$DomainEntry`r`n"
    Set-Content -Path $HostsPath -Value $updatedContent -Encoding ASCII
    Write-Host "[2/4] Configured Server Unit local hosts: '127.0.0.1 ledgerai.ph'" -ForegroundColor Green
}

# 4. Configure Port 80 to Port 3000 local and LAN portproxy
Write-Host "[3/4] Configuring Port 80 -> Port 3000 portproxy forwarding (All Interfaces 0.0.0.0)..." -ForegroundColor Yellow

# Delete existing mappings cleanly
& netsh interface portproxy delete v4tov4 listenport=80 listenaddress=0.0.0.0 2>$null
& netsh interface portproxy delete v4tov4 listenport=80 listenaddress=127.0.0.1 2>$null

# Add 0.0.0.0 (Captures LAN client requests arriving at <ServerIp>:80)
& netsh interface portproxy add v4tov4 listenport=80 listenaddress=0.0.0.0 connectport=3000 connectaddress=127.0.0.1

# Add 127.0.0.1 (Captures local Server Unit browser requests at 127.0.0.1:80)
& netsh interface portproxy add v4tov4 listenport=80 listenaddress=127.0.0.1 connectport=3000 connectaddress=127.0.0.1

Write-Host "  ✔ Port 80 -> 3000 portproxy active across all interfaces." -ForegroundColor Green

# 5. Ensure Windows Defender Firewall allows Inbound TCP 80 ONLY (Port 3000 remains internal)
Write-Host "[4/4] Ensuring Windows Defender Firewall rules (Exposing Port 80 ONLY)..." -ForegroundColor Yellow
Remove-NetFirewallRule -DisplayName "LedgerAI PH Server (Port 3000)" -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "LedgerAI PH HTTP Proxy (Port 80)" -ErrorAction SilentlyContinue

New-NetFirewallRule -DisplayName "LedgerAI PH HTTP Proxy (Port 80)" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow -Profile Domain,Private | Out-Null

Write-Host "  ✔ Firewall rule registered for TCP 80 (Domain & Private profiles)." -ForegroundColor Green
Write-Host "  ✔ Port 3000 kept internal on 127.0.0.1 (No direct LAN ingress)." -ForegroundColor Green

# 6. Summary output for administrators
Write-Host ""
Write-Host "==========================================================================" -ForegroundColor Green
Write-Host "✔ Server Unit Local & LAN Routing Configured Successfully!" -ForegroundColor Green
Write-Host "  Local Server Unit Browser:   http://ledgerai.ph (Resolves locally to 127.0.0.1:80 -> :3000)" -ForegroundColor White
Write-Host "  LAN Workstation Address:     http://ledgerai.ph" -ForegroundColor White
Write-Host ""
Write-Host "  HOW LAN CLIENTS RESOLVE 'http://ledgerai.ph':" -ForegroundColor Cyan
Write-Host "  Option A (Zero-Touch Enterprise): In your Router/DNS server, add DNS A-Record:" -ForegroundColor White
Write-Host "    ledgerai.ph  -->  $primaryLanIp" -ForegroundColor Yellow
Write-Host "  Option B (Workstation Setup): Run on each client workstation PC:" -ForegroundColor White
Write-Host "    .\configure-lan-client.ps1 -ServerIp $primaryLanIp" -ForegroundColor Yellow
Write-Host "==========================================================================" -ForegroundColor Green
