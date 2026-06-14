import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

async function run() {
  try {
    // Bridge token lives in the user's mission-control state dir.
    const token = await readFile(join(homedir(), '.llm-mission-control', 'bridge.token'), 'utf8');
    
    const response = await fetch('http://127.0.0.1:7345/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Token': token.trim()
      },
      body: JSON.stringify({
        target: 'terminal',
        command: 'cd /Users/emrecnyngmail.com/Desktop/ollamas && git status --short && echo --- && git log --oneline -3',
        timeoutMs: 20000
      })
    });

    const resp = await response.json();
    console.log(resp.output);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

run();