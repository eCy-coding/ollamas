import { readFileSync, writeFileSync } from 'fs';
import os from 'os';
import { join } from 'path';

const token = readFileSync(join(os.homedir(), '.llm-mission-control', 'bridge.token'), 'utf8').trim();

// Node global fetch
const diff = readFileSync(0, 'utf8');

if (!diff.trim()) {
  console.error('diff required on stdin');
  process.exit(1);
}

const tmp = '/tmp/apply_' + Date.now() + '.patch';
writeFileSync(tmp, diff);

// POST http://127.0.0.1:7345/run
// header X-Bridge-Token
// body {target:'terminal',command:`cd /Users/emrecnyngmail.com/Desktop/ollamas && git apply --check ${tmp} 2>&1 && git apply ${tmp} 2>&1 && echo APPLIED || echo FAILED`,timeoutMs:20000}
const resp = await fetch('http://127.0.0.1:7345/run', {
  method: 'POST',
  headers: {
    'X-Bridge-Token': token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    target: 'terminal',
    command: `cd /Users/emrecnyngmail.com/Desktop/ollamas && git apply --check ${tmp} 2>&1 && git apply ${tmp} 2>&1 && echo APPLIED || echo FAILED`,
    timeoutMs: 20000
  })
});

const r = await resp.json();
console.log(JSON.stringify({ applied: (r.output || '').includes('APPLIED'), output: r.output }));