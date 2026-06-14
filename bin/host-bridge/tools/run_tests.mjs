import { readFileSync } from 'fs';

try {
  const token = readFileSync(`${process.env.HOME}/.llm-mission-control/bridge.token`, 'utf8').trim();
  
  const response = await fetch('http://127.0.0.1:7345/run', {
    method: 'POST',
    headers: {
      'X-Bridge-Token': token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      target: 'terminal',
      // Run the project's real test suite inside the container (vitest). Avoids
      // nesting bridge calls, which would deadlock the bridge's serialization mutex.
      command: 'cd /Users/emrecnyngmail.com/Desktop/ollamas && docker compose exec -T mission-control npx vitest run tests/MissionControl.test.ts 2>&1 | tail -6',
      timeoutMs: 90000
    })
  });

  const resp = await response.json();
  const out = resp.output || '';
  const passed = /Tests\s+\d+\s+passed/.test(out) || resp.exitCode === 0;
  console.log(JSON.stringify({ exitCode: resp.exitCode, passed, summary: out.trim().split('\n').slice(-3).join(' | ') }));
} catch (error) {
  console.error('Error:', error);
}