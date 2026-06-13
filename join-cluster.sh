#!/bin/bash
echo "Installing LLM Mission Control Cluster Node..."
if [[ "$OSTYPE" != "darwin"* && "$OSTYPE" != "linux-gnu"* ]]; then
  echo "[-] OS not supported. Please use the .ps1 script for Windows."
  exit 1
fi
echo "Terms of service: Consent required to mesh resources. Do you accept? (y/n)"
read -r response
if [[ "$response" != "y" ]]; then
  echo "[-] Cluster join aborted."
  exit 0
fi
echo "[+] Consent recorded. Starting daemon..."
./bin/p2p_network # This should be compiled
echo "[+] Node joined."
