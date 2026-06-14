import { readFileSync } from 'fs';
import os from 'os';
import { join } from 'path';

const token = readFileSync(join(os.homedir(), '.llm-mission-control', 'bridge.token'), 'utf8').trim();

const lines = process.argv[2] || '40';

const resp = await fetch('http://127.0.0.1:7345/run', {
  method: 'POST',
  headers: {
    'X-Bridge-Token': token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    target: 'terminal',
    command: `cd /Users/emrecnyngmail.com/Desktop/ollamas && docker compose logs --tail=${lines} --no-color 2>&1 | tail -${lines}`,
    timeoutMs: 20000
  })
});

const r = await resp.json();
console.log(r.output);