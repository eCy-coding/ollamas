Write-Host "[INFO] Preparing LLM Mission Control Cluster Node..."
if (-not (Get-Command "ollama" -ErrorAction SilentlyContinue)) {
    Write-Host "[-] Error: Ollama not found. Install it first."
    exit
}

Write-Host "--- TERMS OF SERVICE ---"
Write-Host "By joining, you allow the node to run sandboxed inference tasks."
$response = Read-Host "Do you accept these terms? (y/n)"
if ($response -ne "y") {
    Write-Host "[-] Aborted."
    exit
}

Write-Host "[+] Starting daemon..."
# Real implementation:
if (Test-Path ".\bin\hardware_orchestrator.exe") {
    Start-Process -FilePath ".\bin\hardware_orchestrator.exe" -ArgumentList "--daemon"
    Write-Host "[+] Node joined."
} else {
    Write-Host "[-] Error: hardware_orchestrator.exe binary not found. Please run build."
}
