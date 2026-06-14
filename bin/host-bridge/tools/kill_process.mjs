#!/usr/bin/env node

import { readFileSync } from 'fs';
import os from 'os';
import { join } from 'path';

const token = join(os.homedir(), '.llm-mission-control', 'bridge.token');

// Node 24 has global fetch; no external lib needed.
const target = process.argv[2];

if (!target) {
  console.error('pid or :port required');
  process.exit(1);
}

let command;

if (target.startsWith(':')) {
  // Treat as port
  command = `lsof -ti${target} | xargs kill 2>&1 || echo no-proc`;
} else {
  // Treat as pid
  command = `kill ${target} 2>&1 && echo killed || echo no-such-pid`;
}

const resp = await fetch('http://127.0.0.1:7345/run', {
  method: 'POST',
  headers: {
    'X-Bridge-Token': readFileSync(token, 'utf-8').trim(),
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    target: 'terminal',
    command,
    timeoutMs: 15000
  })
});

console.log(JSON.stringify({ok: (await resp.json()).output}));