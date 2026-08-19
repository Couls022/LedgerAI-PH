<#
================================================================================
LedgerAI PH — Desktop Shortcut Creation Script
================================================================================
Creates a desktop shortcut pointing to http://ledgerai.ph using the user's
default system web browser.
================================================================================
#>

param(
    [string]$TargetUrl = "http://ledgerai.ph",
    [string]$IconPath = "$env:ProgramFiles\LedgerAI PH\app-icon.ico"
)

$ErrorActionPreference = "SilentlyContinue"

$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::CommonDesktopDirectory)
if (-not (Test-Path $DesktopPath)) {
    $DesktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
}

$ShortcutPath = Join-Path $DesktopPath "LedgerAI PH.url"

# Create URL Internet Shortcut
$content = @"
[InternetShortcut]
URL=$TargetUrl
IconFile=$IconPath
IconIndex=0
"@

Set-Content -Path $ShortcutPath -Value $content -Encoding ASCII

Write-Host "✔ Created desktop shortcut for $TargetUrl at $ShortcutPath" -ForegroundColor Green
