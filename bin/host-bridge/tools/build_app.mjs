import { readFileSync } from 'fs';
import os from 'os';
import { join } from 'path';

const token = readFileSync(join(os.homedir(), '.llm-mission-control', 'bridge.token'), 'utf8').trim();

// Node 24 has global fetch; no external lib needed.
const resp = await fetch('http://127.0.0.1:7345/run', {
  method: 'POST',
  headers: {
    'X-Bridge-Token': token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    target: 'terminal',
    command: 'cd /Users/emrecnyngmail.com/Desktop/ollamas && docker compose build 2>&1 | tail -2 && docker compose up -d --force-recreate 2>&1 | tail -2 && sleep 4 && curl -fs http://127.0.0.1:3000/api/health >/dev/null && echo HEALTHY || echo UNHEALTHY',
    timeoutMs: 200000
  })
});

const r = await resp.json();
console.log(JSON.stringify({
  built: r.exitCode === 0,
  healthy: (r.output || '').includes('HEALTHY'),
  output: (r.output || '').slice(-200)
}));