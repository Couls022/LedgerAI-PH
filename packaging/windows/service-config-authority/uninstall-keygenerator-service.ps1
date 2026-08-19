<#
================================================================================
LedgerAI PH — Internal Key Generator Windows Service Uninstaller
================================================================================
Gracefully stops and deregisters LedgerAIKeyGeneratorService.
================================================================================
#>

$ErrorActionPreference = "SilentlyContinue"
$ServiceName = "LedgerAIKeyGeneratorService"

Write-Host "Stopping $ServiceName..." -ForegroundColor Yellow
Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "Deregistering $ServiceName..." -ForegroundColor Yellow
$NssmExe = "$env:ProgramFiles\LedgerAI Key Generator\nssm.exe"
if (Test-Path $NssmExe) {
    & $NssmExe remove $ServiceName confirm
} else {
    & sc.exe delete $ServiceName
}

Write-Host "✔ LedgerAI PH Key Generator Service uninstalled." -ForegroundColor Green
