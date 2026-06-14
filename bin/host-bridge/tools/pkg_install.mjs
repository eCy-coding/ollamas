import { readFileSync } from 'fs';
import os from 'os';
import { join } from 'path';

const token = readFileSync(join(os.homedir(), '.llm-mission-control', 'bridge.token'), 'utf8').trim();

// Node global fetch (NO node-fetch/undici/Deno)
const manager = process.argv[2];
const pkg = process.argv.slice(3).join(' ');

if (!manager || !pkg) {
  console.error('usage: manager(npm|pip|brew) package');
  process.exit(1);
}

let cmd;

if (manager === 'npm') {
  cmd = `cd /Users/emrecnyngmail.com/Desktop/ollamas && docker compose exec -T mission-control npm install ${pkg} < /dev/null 2>&1 | tail -5`;
} else if (manager === 'pip') {
  cmd = `pip3 install ${pkg} 2>&1 | tail -5`;
} else if (manager === 'brew') {
  cmd = `brew install ${pkg} 2>&1 | tail -5`;
} else {
  console.error('unknown manager');
  process.exit(1);
}

const resp = await fetch('http://127.0.0.1:7345/run', {
  method: 'POST',
  headers: {
    'X-Bridge-Token': token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    target: 'terminal',
    command: cmd,
    timeoutMs: 120000
  })
});

const r = await resp.json();
console.log(JSON.stringify({ installed: r.exitCode === 0, output: (r.output || '').slice(-300) }));