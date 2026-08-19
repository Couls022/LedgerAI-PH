<#
================================================================================
LedgerAI PH — Windows Background Service Uninstaller Script
================================================================================
Gracefully stops and removes the LedgerAI PH background Windows Service.
Preserves user company databases and financial archives.
================================================================================
#>

param(
    [string]$ServiceName = "LedgerAIServerService"
)

$ErrorActionPreference = "SilentlyContinue"

Write-Host "Stopping and removing $ServiceName..." -ForegroundColor Yellow
Stop-Service -Name $ServiceName -Force
& sc.exe delete $ServiceName

# Remove firewall rules
Remove-NetFirewallRule -DisplayName "LedgerAI PH Server (Port 3000)"
Remove-NetFirewallRule -DisplayName "LedgerAI PH HTTP Proxy (Port 80)"

# Remove netsh portproxy
& netsh interface portproxy delete v4tov4 listenport=80 listenaddress=0.0.0.0

Write-Host "✔ LedgerAI PH Windows Service removed cleanly." -ForegroundColor Green
