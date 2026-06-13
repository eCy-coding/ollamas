Write-Host "Installing LLM Mission Control Cluster Node..."
$consent = Read-Host "Terms of service: Consent required to mesh resources. Do you accept? (y/n)"
if ($consent -ne "y") {
    Write-Host "[-] Cluster join aborted."
    exit
}
Write-Host "[+] Consent recorded. Starting daemon..."
.\bin\p2p_network.exe
Write-Host "[+] Node joined."
