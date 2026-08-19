<#
================================================================================
LedgerAI PH — Key Generator Desktop Shortcut Creation Script
================================================================================
Creates a desktop shortcut pointing to http://127.0.0.1:4000
================================================================================
#>

param(
    [string]$TargetUrl = "http://127.0.0.1:4000",
    [string]$IconPath = "$env:ProgramFiles\LedgerAI Key Generator\keygenerator-icon.ico"
)

$ErrorActionPreference = "SilentlyContinue"

$DesktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::CommonDesktopDirectory)
if (-not (Test-Path $DesktopPath)) {
    $DesktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
}

$ShortcutPath = Join-Path $DesktopPath "LedgerAI PH Key Generator.url"

$content = @"
[InternetShortcut]
URL=$TargetUrl
IconFile=$IconPath
IconIndex=0
"@

Set-Content -Path $ShortcutPath -Value $content -Encoding ASCII
Write-Host "✔ Created desktop shortcut for Key Generator at $ShortcutPath" -ForegroundColor Green
