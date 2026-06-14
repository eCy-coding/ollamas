import { readFileSync } from 'fs';
import os from 'os';
import { join } from 'path';

const token = readFileSync(join(os.homedir(), '.llm-mission-control', 'bridge.token'), 'utf8').trim();
const message = process.argv.slice(2).join(' ');

if (!message) {
  console.error('message required');
  process.exit(1);
}

(async () => {
  const resp = await fetch('http://127.0.0.1:7345/run', {
    method: 'POST',
    headers: {
      'X-Bridge-Token': token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      target: 'terminal',
      command: `cd /Users/emrecnyngmail.com/Desktop/ollamas && git add -A && git commit -m ${JSON.stringify(message)} 2>&1 | tail -4`,
      timeoutMs: 20000
    })
  });

  const result = await resp.json();
  console.log(JSON.stringify({ committed: result.exitCode === 0, output: result.output }));
})();