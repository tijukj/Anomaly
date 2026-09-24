# scripts/firewall-setup.ps1 - Configure Windows Defender Firewall for ANOMALY
$ErrorActionPreference = "Stop"

# 1. Check for Administrator Privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Red
    Write-Host " [!] ADMINISTRATOR PRIVILEGES REQUIRED" -ForegroundColor Red
    Write-Host "==========================================================" -ForegroundColor Red
    Write-Host " Windows requires Administrator permissions to add firewall rules." -ForegroundColor White
    Write-Host ""
    Write-Host " HOW TO RUN AS ADMINISTRATOR:" -ForegroundColor Yellow
    Write-Host "  1. Press the Windows key." -ForegroundColor White
    Write-Host "  2. Type 'PowerShell'." -ForegroundColor White
    Write-Host "  3. Right-click 'Windows PowerShell' and select 'Run as administrator'." -ForegroundColor White
    Write-Host "  4. Type: cd `"$((Get-Item $PSScriptRoot).Parent.FullName)`"" -ForegroundColor White
    Write-Host "  5. Type: npm run firewall" -ForegroundColor White
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
Write-Host "==> Configuring Windows Defender Firewall for ANOMALY (Port $Port)..." -ForegroundColor Cyan

# 3. Safely remove any existing rule with this name so script is idempotent
try {
    Remove-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
} catch {
    # Ignore if not present
}

# 4. Add the inbound rule for Domain, Private, and Public profiles
try {
    New-NetFirewallRule -DisplayName $RuleName `
                        -Description "Allow phone controllers to connect to ANOMALY game server over local Wi-Fi" `
                        -Direction Inbound `
                        -LocalPort $Port `
                        -Protocol TCP `
                        -Action Allow `
                        -Profile Domain, Private, Public `
                        -Enabled True | Out-Null

    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host " [SUCCESS] Inbound Firewall Rule Created Successfully!" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  Rule Name : $RuleName" -ForegroundColor White
    Write-Host "  Port      : $Port (TCP Inbound)" -ForegroundColor White
    Write-Host "  Profiles  : Private, Public, Domain" -ForegroundColor White
    Write-Host "  Status    : Allowed & Enabled" -ForegroundColor White
    Write-Host ""
    Write-Host " Phones on your local Wi-Fi can now connect without blocking." -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "[ERROR] Failed to add firewall rule: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
