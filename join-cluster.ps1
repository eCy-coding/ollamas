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
# .\bin\hardware_orchestrator.exe --daemon
Write-Host "[+] Node joined."
