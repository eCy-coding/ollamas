#!/usr/bin/env node

import { join } from 'path';
import os from 'os';
import { readFileSync } from 'fs';

const tokenPath = join(os.homedir(), '.llm-mission-control', 'bridge.token');

// Read the token from file (Node global fetch; no external deps)
const token = readFileSync(tokenPath, 'utf8').trim();

// Get port from command line arguments or default to 3000
const port = process.argv[2] || '3000';

try {
  const response = await fetch('http://127.0.0.1:7345/run', {
    method: 'POST',
    headers: {
      'X-Bridge-Token': token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      target: 'terminal',
      command: `lsof -nP -iTCP:${port} -sTCP:LISTEN || echo 'no listener on ${port}'`,
      timeoutMs: 15000
    })
  });

  const result = await response.json();
  console.log(result.output);
} catch (error) {
  console.error('Error:', error.message);
}