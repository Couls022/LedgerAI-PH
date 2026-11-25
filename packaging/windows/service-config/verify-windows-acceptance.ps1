<#
================================================================================
LedgerAI PH — Native Windows Enterprise Deployment & Physical LAN Acceptance Runner
================================================================================
Target: Physical Windows 10/11 x64 Workstations (PC 1 Server + PC 2 / Laptop 1 / Laptop 2)
Role:   Automates Phase 1 (Windows Server Service) and Phase 2 (Physical LAN)
        evidence collection and writes a timestamped JSON evidence bundle for
        sign-off in docs/acceptance/*.md.

Usage:
  On PC 1 (Central Server — run as Administrator):
    .\verify-windows-acceptance.ps1 -Role Server -OutputDir C:\Temp\ledgerai-acceptance

  On PC 2 / Laptop 1 / Laptop 2 (LAN Browser Client):
    .\verify-windows-acceptance.ps1 -Role Client -ServerIp 192.168.1.10 -OutputDir C:\Temp\ledgerai-acceptance
================================================================================
#>

[CmdletBinding()]
param(
    [ValidateSet("Server", "Client")]
    [string]$Role = "Server",

    [string]$ServiceName = "LedgerAIServerService",
    [string]$ServerIp = "127.0.0.1",
    [string]$PrimaryHostname = "ledgerai.local",
    [string]$AlternateHostname = "ledgerai-server.local",
    [int]$Port = 80,
    [int]$InternalPort = 3000,
    [string]$DataDir = "$env:ProgramData\LedgerAI\data",
    [string]$LogDir = "$env:ProgramData\LedgerAI\logs",
    [string]$OutputDir = "$env:TEMP\ledgerai-acceptance-evidence"
)

$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ReportPath = Join-Path $OutputDir "acceptance-$Role-$env:COMPUTERNAME-$Timestamp.json"

$Results = [System.Collections.Generic.List[object]]::new()

function Add-Check {
    param(
        [string]$TestId,
        [string]$Title,
        [bool]$Passed,
        [string]$Actual,
        [string]$Evidence
    )
    $status = if ($Passed) { "PASS" } else { "FAIL" }
    $color = if ($Passed) { "Green" } else { "Red" }
    Write-Host "[$status] $TestId — $Title" -ForegroundColor $color
    Write-Host "       Actual: $Actual" -ForegroundColor DarkGray
    $Results.Add([PSCustomObject]@{
        testId      = $TestId
        title       = $Title
        status      = $status
        actual      = $Actual
        evidence    = $Evidence
        host        = $env:COMPUTERNAME
        role        = $Role
        executedAt  = (Get-Date).ToString("o")
    })
}

Write-Host "==========================================================================" -ForegroundColor Cyan
Write-Host "  LEDGERAI PH — WINDOWS ACCEPTANCE VERIFICATION ($Role on $env:COMPUTERNAME)" -ForegroundColor Cyan
Write-Host "==========================================================================" -ForegroundColor Cyan

$osInfo = Get-CimInstance Win32_OperatingSystem
Write-Host "OS: $($osInfo.Caption) ($($osInfo.Version) / Build $($osInfo.BuildNumber))" -ForegroundColor White

if ($Role -eq "Server") {
    # WIN-SRV-01: Service registration & Running state
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    $svcCim = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
    Add-Check -TestId "WIN-SRV-01" -Title "Windows Service Registration & Running State" `
        -Passed ($null -ne $svc -and $svc.Status -eq "Running") `
        -Actual $(if ($svc) { "Status=$($svc.Status), StartMode=$($svcCim.StartMode), PathName=$($svcCim.PathName)" } else { "Service not found" }) `
        -Evidence "Get-Service / Win32_Service ($ServiceName)"

    # WIN-SRV-02: Automatic startup configuration
    Add-Check -TestId "WIN-SRV-02" -Title "Windows Service Automatic Startup" `
        -Passed ($null -ne $svcCim -and $svcCim.StartMode -eq "Auto") `
        -Actual $(if ($svcCim) { "StartMode=$($svcCim.StartMode)" } else { "Unavailable" }) `
        -Evidence "Win32_Service.StartMode"

    # WIN-SRV-03: Service failure recovery policy (sc.exe qfailure)
    $qfailure = (& sc.exe qfailure $ServiceName 2>&1) -join "`n"
    $hasRestart = $qfailure -match "RESTART"
    Add-Check -TestId "WIN-SRV-03" -Title "Service Failure Recovery Policy" `
        -Passed $hasRestart `
        -Actual $(if ($hasRestart) { "Automatic RESTART actions configured" } else { "Missing RESTART actions" }) `
        -Evidence $qfailure

    # WIN-SRV-04: Database storage NTFS ACLs (SYSTEM & Administrators, no unprivileged Users)
    $aclOk = $false
    $aclSummary = "Directory missing: $DataDir"
    if (Test-Path $DataDir) {
        $acl = Get-Acl -Path $DataDir
        $identities = ($acl.Access | ForEach-Object { "$($_.IdentityReference.Value):$($_.FileSystemRights)" }) -join "; "
        $hasUsers = ($acl.Access | Where-Object { $_.IdentityReference.Value -match "BUILTIN\\Users|Everyone" -and $_.AccessControlType -eq "Allow" }).Count -gt 0
        $aclOk = (-not $hasUsers) -and $acl.AreAccessRulesProtected
        $aclSummary = "Protected=$($acl.AreAccessRulesProtected); Rules=[$identities]"
    }
    Add-Check -TestId "WIN-SRV-04" -Title "Central Database Storage NTFS Permissions" `
        -Passed $aclOk `
        -Actual $aclSummary `
        -Evidence "Get-Acl $DataDir"

    # WIN-SRV-05: Server logs & live /api/health endpoint
    $healthBody = ""
    $healthOk = $false
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$InternalPort/api/health" -TimeoutSec 5
        $healthOk = ($resp.status -eq "healthy")
        $healthBody = ($resp | ConvertTo-Json -Compress)
    } catch {
        $healthBody = $_.Exception.Message
    }
    $logsExist = (Test-Path (Join-Path $LogDir "service-stdout.log")) -or (Test-Path (Join-Path $LogDir "service-stderr.log"))
    Add-Check -TestId "WIN-SRV-05" -Title "Live Server Health Endpoint & Service Logs" `
        -Passed ($healthOk -and $logsExist) `
        -Actual "Health=$healthBody; LogsDirExists=$logsExist" `
        -Evidence "GET http://127.0.0.1:$InternalPort/api/health + $LogDir"

    # WIN-SRV-06: Windows Defender Firewall scoped to Domain & Private ONLY (Public blocked)
    $fwRules = Get-NetFirewallRule -DisplayName "LedgerAI PH*" -ErrorAction SilentlyContinue
    $publicExposed = ($fwRules | Where-Object { $_.Enabled -eq "True" -and ($_.Profile.ToString() -match "Public" -or $_.Profile.ToString() -eq "Any") }).Count -gt 0
    $fwSummary = ($fwRules | ForEach-Object { "$($_.DisplayName) [Profile=$($_.Profile), Enabled=$($_.Enabled)]" }) -join "; "
    Add-Check -TestId "WIN-SRV-06" -Title "Windows Firewall Profile Restriction (No Public Profile)" `
        -Passed ($fwRules.Count -gt 0 -and -not $publicExposed) `
        -Actual $(if ($fwSummary) { $fwSummary } else { "No LedgerAI PH firewall rules found" }) `
        -Evidence "Get-NetFirewallRule -DisplayName 'LedgerAI PH*'"
} else {
    # Client Workstation Checks (PC 2 / Laptop 1 / Laptop 2)
    $portSuffix = if ($Port -eq 80) { "" } else { ":$Port" }

    # LAN-CLI-01: Direct Server IP access
    $directOk = $false
    $directDetail = ""
    try {
        $r = Invoke-RestMethod -Uri "http://${ServerIp}${portSuffix}/api/health" -TimeoutSec 5
        $directOk = ($r.status -eq "healthy")
        $directDetail = ($r | ConvertTo-Json -Compress)
    } catch {
        $directDetail = $_.Exception.Message
    }
    Add-Check -TestId "LAN-CLI-01" -Title "Direct Server IP HTTP Health Access" `
        -Passed $directOk `
        -Actual $directDetail `
        -Evidence "GET http://${ServerIp}${portSuffix}/api/health"

    # LAN-CLI-02: ledgerai.local hostname resolution & HTTP reachability
    $primaryOk = $false
    $primaryDetail = ""
    try {
        $dns = Resolve-DnsName -Name $PrimaryHostname -ErrorAction Stop | Select-Object -First 1
        $r = Invoke-RestMethod -Uri "http://${PrimaryHostname}${portSuffix}/api/health" -TimeoutSec 5
        $primaryOk = ($r.status -eq "healthy")
        $primaryDetail = "Resolved=$($dns.IPAddress); Health=$($r.status)"
    } catch {
        $primaryDetail = $_.Exception.Message
    }
    Add-Check -TestId "LAN-CLI-02" -Title "Primary Hostname ($PrimaryHostname) Resolution & Reachability" `
        -Passed $primaryOk `
        -Actual $primaryDetail `
        -Evidence "Resolve-DnsName $PrimaryHostname + GET /api/health"

    # LAN-CLI-03: ledgerai-server.local hostname resolution & HTTP reachability
    $altOk = $false
    $altDetail = ""
    try {
        $dns = Resolve-DnsName -Name $AlternateHostname -ErrorAction Stop | Select-Object -First 1
        $r = Invoke-RestMethod -Uri "http://${AlternateHostname}${portSuffix}/api/health" -TimeoutSec 5
        $altOk = ($r.status -eq "healthy")
        $altDetail = "Resolved=$($dns.IPAddress); Health=$($r.status)"
    } catch {
        $altDetail = $_.Exception.Message
    }
    Add-Check -TestId "LAN-CLI-03" -Title "Alternate Hostname ($AlternateHostname) Resolution & Reachability" `
        -Passed $altOk `
        -Actual $altDetail `
        -Evidence "Resolve-DnsName $AlternateHostname + GET /api/health"

    # LAN-CLI-04: Verify remote client does NOT expose server filesystem paths via /api/companies/storage-environment
    $fsBlocked = $false
    $fsDetail = ""
    try {
        $resp = Invoke-WebRequest -Uri "http://${ServerIp}${portSuffix}/api/companies/storage-environment" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        $fsDetail = "UNEXPECTED HTTP $($resp.StatusCode)"
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        $fsBlocked = ($code -eq 403 -or $code -eq 401)
        $fsDetail = "HTTP $code (Server filesystem protected)"
    }
    Add-Check -TestId "LAN-CLI-04" -Title "Remote Client Blocked from Server Filesystem Inspection" `
        -Passed $fsBlocked `
        -Actual $fsDetail `
        -Evidence "GET http://${ServerIp}${portSuffix}/api/companies/storage-environment"
}

$Payload = [PSCustomObject]@{
    application = "LedgerAI PH"
    version     = "1.0.0-rc.2"
    role        = $Role
    hostname    = $env:COMPUTERNAME
    osCaption   = $osInfo.Caption
    osVersion   = $osInfo.Version
    osBuild     = $osInfo.BuildNumber
    executedAt  = (Get-Date).ToString("o")
    summary     = [PSCustomObject]@{
        total  = $Results.Count
        passed = ($Results | Where-Object { $_.status -eq "PASS" }).Count
        failed = ($Results | Where-Object { $_.status -eq "FAIL" }).Count
    }
    checks      = $Results
}

$Payload | ConvertTo-Json -Depth 6 | Set-Content -Path $ReportPath -Encoding UTF8
Write-Host ""
Write-Host "Evidence written to: $ReportPath" -ForegroundColor Cyan
