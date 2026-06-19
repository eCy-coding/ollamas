// vF7 — vanilla landing logic. Zero dependencies, no framework. Reads the public
// /api/health endpoint and reflects live status in the hero badge. Defensive about
// the response shape (the gateway has evolved its health payload across versions).
const badge = document.querySelector('[data-health-badge]');

function describe(health) {
  if (!health || typeof health !== 'object') return 'online';
  const parts = [];
  if (health.mode) parts.push(String(health.mode));
  const models = health.loadedModels ?? health.models;
  if (Array.isArray(models)) parts.push(`${models.length} models`);
  else if (typeof models === 'number') parts.push(`${models} models`);
  if (health.ollamaVersion) parts.push(`ollama ${health.ollamaVersion}`);
  return parts.length ? `online · ${parts.join(' · ')}` : 'online';
}

async function refreshHealth() {
  if (!badge) return;
  try {
    const res = await fetch('/api/health', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    const health = await res.json().catch(() => ({}));
    badge.textContent = describe(health);
    badge.dataset.status = 'online';
  } catch {
    badge.textContent = 'gateway offline';
    badge.dataset.status = 'offline';
  }
}

refreshHealth();
setInterval(refreshHealth, 15000);
