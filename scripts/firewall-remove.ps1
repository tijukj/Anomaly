# scripts/firewall-remove.ps1 - Remove Windows Defender Firewall rule for ANOMALY
$ErrorActionPreference = "Stop"

# 1. Check for Administrator Privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Red
    Write-Host " [!] ADMINISTRATOR PRIVILEGES REQUIRED" -ForegroundColor Red
    Write-Host "==========================================================" -ForegroundColor Red
    Write-Host " Windows requires Administrator permissions to remove firewall rules." -ForegroundColor White
    Write-Host " Please open PowerShell as Administrator and rerun." -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Red
    Write-Host ""
    exit 1
}

# 2. Extract Game Port from server/config.js (default 3000)
$Port = 3000
$configPath = Join-Path $PSScriptRoot "..\server\config.js"
if (Test-Path $configPath) {
    $content = Get-Content $configPath -Raw
    if ($content -match 'PORT:\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d+)') {
        $Port = [int]$matches[1]
    }
}

$RuleName = "ANOMALY Game $Port"

Write-Host ""
Write-Host "==> Removing Windows Defender Firewall rule '$RuleName'..." -ForegroundColor Cyan

try {
    Remove-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host " [SUCCESS] Firewall Rule '$RuleName' Removed." -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "[ERROR] Failed to remove firewall rule: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
