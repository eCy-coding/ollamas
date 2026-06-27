<#
.SYNOPSIS
  fleet-join.ps1 — Windows GPU worker one-command join (idempotent).
.DESCRIPTION
  Makes this Windows PC an ollamas inference backend reachable over Tailscale:
  verify Tailscale + Ollama, bind ollama to all interfaces, open the firewall on
  the Tailscale interface, pull the required model. Re-run = no-op (safe).
  Pairs with scripts/fleet-up.sh on the Mac control plane. See cli/FLEET.md.
.PARAMETER Model
  Model to ensure is pulled (default qwen3:8b — the gateway selftest gates require it).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\fleet-join.ps1
#>
[CmdletBinding()]
param(
  [string]$Model = "qwen3:8b",
  [int]$Port = 11434
)
$ErrorActionPreference = "Stop"
function Log  ($m) { Write-Host "[fleet] $m" -ForegroundColor Cyan }
function Warn ($m) { Write-Host "[fleet] uyari: $m" -ForegroundColor Yellow }
function Die  ($m) { Write-Host "[fleet] HATA: $m" -ForegroundColor Red; exit 1 }

# 1) Tailscale — the mesh that makes this host reachable from the Mac.
if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
  Warn "Tailscale not found. Installing via winget…"
  try { winget install -e --id Tailscale.Tailscale --accept-source-agreements --accept-package-agreements }
  catch { Die "winget install failed — install Tailscale manually from tailscale.com/download, then re-run." }
}
# `tailscale status` exits non-zero when logged out.
& tailscale status *> $null
if ($LASTEXITCODE -ne 0) {
  Die "Tailscale installed but not connected — run 'tailscale up' (SAME account as the Mac), then re-run."
}
Log "Tailscale connected."

# 2) Ollama — the inference engine.
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Die "Ollama not found — install from ollama.com/download/windows, then re-run."
}

# 3) Bind to all interfaces so the tailnet/LAN can reach the daemon (default is
#    127.0.0.1 only). Persist as a USER environment variable (idempotent).
$bind = "0.0.0.0:$Port"
$cur  = [Environment]::GetEnvironmentVariable("OLLAMA_HOST", "User")
if ($cur -ne $bind) {
  Log "Setting user env OLLAMA_HOST=$bind (was '$cur')."
  [Environment]::SetEnvironmentVariable("OLLAMA_HOST", $bind, "User")
  $env:OLLAMA_HOST = $bind
  $restartNeeded = $true
} else { Log "OLLAMA_HOST already $bind." }

# 4) Firewall — allow inbound on the ollama port (idempotent: skip if rule exists).
$ruleName = "Ollama ($Port) — ollamas fleet"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  Log "Adding firewall rule '$ruleName'."
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $Port -Profile Private | Out-Null
} else { Log "Firewall rule already present." }

# 5) Restart ollama if the bind changed, so it picks up OLLAMA_HOST.
if ($restartNeeded) {
  Log "Restarting Ollama to apply bind…"
  Get-Process ollama -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

# 6) Pull the required model (idempotent — ollama skips if present).
Log "Ensuring model '$Model' is pulled…"
& ollama pull $Model
if ($LASTEXITCODE -ne 0) { Die "ollama pull $Model failed." }

# 7) Verify the daemon answers on the bound port.
try {
  $v = Invoke-RestMethod -Uri "http://localhost:$Port/api/version" -TimeoutSec 5
  Log "Ollama serving (version $($v.version)). This host is fleet-ready."
} catch { Warn "Could not reach http://localhost:$Port/api/version — check the daemon." }

Log "Done. On the Mac run: ./scripts/fleet-up.sh  (it auto-discovers this worker)."
