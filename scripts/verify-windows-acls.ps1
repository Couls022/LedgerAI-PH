# ==============================================================================
# LEDGERAI PH — Windows NTFS ACL & Keystore Permission Verification Script
# Target: Windows 10 / Windows 11 (x64)
# Purpose: Inspects and verifies strict NTFS DACL permissions for LedgerAI PH
#          company workspaces, keystore vaults, backups, and temporary files.
# ==============================================================================

[CmdletBinding()]
param(
    [string]$LedgerAIAppData = "$env:APPDATA\LedgerAI-PH",
    [string]$LedgerAIHowardDocs = "$env:USERPROFILE\Documents\LedgerAI Companies",
    [string]$CentralServerDataDir = "$env:ProgramData\LedgerAI\data",
    [string]$CentralServerLogDir = "$env:ProgramData\LedgerAI\logs"
)

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " LEDGERAI PH — Windows NTFS ACL Security Inspection" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

function Test-PathAcl {
    param([string]$TargetPath)
    
    if (-not (Test-Path $TargetPath)) {
        Write-Host "[INFO] Path does not exist yet (skipped): $TargetPath" -ForegroundColor DarkGray
        return
    }

    Write-Host "`n[INSPECT] Path: $TargetPath" -ForegroundColor Yellow
    try {
        $acl = Get-Acl -Path $TargetPath
        Write-Host " Owner: $($acl.Owner)" -ForegroundColor White
        Write-Host " AreAccessRulesProtected: $($acl.AreAccessRulesProtected)" -ForegroundColor White
        
        foreach ($rule in $acl.Access) {
            $identity = $rule.IdentityReference.Value
            $rights = $rule.FileSystemRights
            $type = $rule.AccessControlType
            Write-Host "   - [$type] $identity => $rights" -ForegroundColor Green
        }
    } catch {
        Write-Host "   [ERROR] Failed to retrieve ACL: $_" -ForegroundColor Red
    }
}

# 1. Inspect Centralized Server Service Data & Logs (Topology A — Server / Server+Desktop)
Test-PathAcl -TargetPath "$CentralServerDataDir"
Test-PathAcl -TargetPath "$CentralServerLogDir"

# 2. Inspect Keystore Vault
Test-PathAcl -TargetPath "$LedgerAIAppData\.keystore_vault"

# 3. Inspect Application Logs Directory
Test-PathAcl -TargetPath "$LedgerAIAppData\logs"

# 4. Inspect Company Documents Root
Test-PathAcl -TargetPath "$LedgerAIHowardDocs"

# 5. Inspect Individual Company Directories (if any exist)
if (Test-Path $LedgerAIHowardDocs) {
    Get-ChildItem -Path $LedgerAIHowardDocs -Directory | ForEach-Object {
        Test-PathAcl -TargetPath $_.FullName
        Test-PathAcl -TargetPath "$($_.FullName)\database.lai"
        Test-PathAcl -TargetPath "$($_.FullName)\.db_active.sqlite"
    }
}

Write-Host "`n======================================================================" -ForegroundColor Cyan
Write-Host " Security Policy Guidance for Native Windows Deployment:" -ForegroundColor Cyan
Write-Host " 1. Central Server (%ProgramData%\LedgerAI\data) must grant SYSTEM & Administrators only." -ForegroundColor White
Write-Host " 2. Keystore vault (.keystore_vault) must restrict access to current user / SYSTEM." -ForegroundColor White
Write-Host " 3. Standard unprivileged local users must be denied access to company books." -ForegroundColor White
Write-Host " 4. SYSTEM and Administrators retain management access per enterprise policy." -ForegroundColor White
Write-Host "======================================================================" -ForegroundColor Cyan
