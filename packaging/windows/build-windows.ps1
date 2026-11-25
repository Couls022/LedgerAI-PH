# LedgerAI PH — Standalone Windows Desktop Packaging Automation Pipeline
# Run this script inside a PowerShell terminal on a Windows development system.

$ErrorActionPreference = "Stop"

Write-Host "==========================================================================" -ForegroundColor Cyan
Write-Host "         LEDGERAI PH — WINDOWS DESKTOP COMPILATION AND PACKAGING          " -ForegroundColor Cyan
Write-Host "==========================================================================" -ForegroundColor Cyan

# 1. Validation Checks for Required Local Runtimes
Write-Host "[1/6] Validating developer machine environment tools..." -ForegroundColor Yellow

if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is not installed on this system. Please install Node.js v18+ first."
}
if (!(Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "npm is not installed. Please install npm to resolve package dependencies."
}

$NodeVersion = node -v
Write-Host "✔ Found Node.js: $NodeVersion" -ForegroundColor Green

# 2. Cleanup Legacy Artifacts
Write-Host "[2/6] Cleaning up past build directories and caches..." -ForegroundColor Yellow
$BuildPaths = @("dist", "dist-client", "dist-authority", "out", "build-output")
foreach ($Path in $BuildPaths) {
    if (Test-Path $Path) {
        Remove-Item -Path $Path -Recurse -Force
        Write-Host "✔ Cleared $Path" -ForegroundColor DarkGray
    }
}

# 3. Installing Dependencies
Write-Host "[3/6] Installing complete node dependencies from package.json..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { Write-Error "npm install failed. Review dependency constraints." }

# 4. Production Compiling and Bundling
Write-Host "[4/6] Compiling production build files (Frontend & Backend Bundler)..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "Production compilation failed. Run npm run lint to diagnose." }

# 5. Injecting Electron Desktop Shell Integration
Write-Host "[5/6] Bundling Electron host wrapper configurations..." -ForegroundColor Yellow

$ElectronDist = "build-output/electron"
New-Item -ItemType Directory -Force -Path $ElectronDist | Out-Null
New-Item -ItemType Directory -Force -Path "$ElectronDist/dist" | Out-Null

# Copy production assets to Electron package directory
Copy-Item -Path "dist/*" -Destination "$ElectronDist/dist" -Recurse -Force
Copy-Item -Path "packaging/windows/package-config/main.js" -Destination "$ElectronDist/main.js" -Force
Copy-Item -Path "package.json" -Destination "$ElectronDist/package.json" -Force

# Edit local electron package.json dependency references dynamically
$PackageJsonPath = "$ElectronDist/package.json"
$PkgJson = Get-Content $PackageJsonPath | ConvertFrom-Json
$PkgJson.main = "main.js"
$PkgJson.dependencies | Add-Member -MemberType NoteProperty -Name "electron-is-dev" -Value "^2.0.0" -Force
$PkgJson | ConvertTo-Json -Depth 100 | Set-Content $PackageJsonPath

Write-Host "✔ Desktop wrapper directory structured successfully." -ForegroundColor Green

# 6. Execute Electron Packaging (Target: Windows Standalone Portable/Installer)
Write-Host "[6/6] Compiling standalone executable packages using electron-builder..." -ForegroundColor Yellow
Write-Host "NOTE: If Inno Setup is installed in its default folder, it will generate an installable EXE wizard." -ForegroundColor Gray

# Executing package compilation inside the structured host wrapper
Push-Location $ElectronDist
npm install --production
npm install electron-builder --save-dev
npx electron-builder --windows
Pop-Location

Write-Host "==========================================================================" -ForegroundColor Green
Write-Host "✔ STANDALONE WINDOWS PACKAGING ATTEMPT FINISHED COMPILING!" -ForegroundColor Green
Write-Host "Output Executables Location: $ElectronDist/dist/" -ForegroundColor Green
Write-Host "==========================================================================" -ForegroundColor Green
