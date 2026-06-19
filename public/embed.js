/*!
 * ollamas embed widget (vF7) — standalone, zero-dependency streaming chat.
 * Drop into any page:  <script src="https://your-ollamas/embed.js"
 *   data-api-base="https://your-ollamas" data-model="llama3" data-provider="ollama-local"></script>
 *
 * Shadow-DOM isolation pattern (so host-page CSS can't bleed in) and the
 * fetch+getReader SSE read are common zero-dep widget techniques (cf. chatui /
 * quikchat). Reimplemented here for ollamas — no third-party code copied.
 * The streaming read mirrors src/lib/apiClient.ts `streamPost`; embed.js is a
 * separate distributable (not a React component) so it intentionally stands alone.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) return;
  var cfg = {
    apiBase: (script.dataset.apiBase || '').replace(/\/$/, ''),
    provider: script.dataset.provider || 'ollama-local',
    model: script.dataset.model || '',
    title: script.dataset.title || 'ollamas',
  };

  var host = document.createElement('div');
  host.setAttribute('data-ollamas-embed', '');
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = [
    ':host,*{box-sizing:border-box}',
    '.bubble{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;border:none;',
    'background:#6366f1;color:#fff;font-size:24px;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.35);z-index:2147483000}',
    '.bubble:focus-visible{outline:2px solid #fff;outline-offset:2px}',
    '.panel{position:fixed;bottom:88px;right:20px;width:340px;max-width:calc(100vw - 40px);height:460px;max-height:calc(100vh - 120px);',
    'display:none;flex-direction:column;background:#0a0b10;color:#e2e8f0;border:1px solid rgba(255,255,255,.08);',
    'border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;z-index:2147483000}',
    '.panel[data-open]{display:flex}',
    '.hd{padding:10px 14px;background:#08090d;border-bottom:1px solid rgba(255,255,255,.06);font-size:13px;font-weight:700;color:#f8fafc;display:flex;justify-content:space-between;align-items:center}',
    '.hd button{background:none;border:none;color:#94a3b8;cursor:pointer;font-size:18px;line-height:1}',
    '.msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}',
    '.msg{padding:8px 10px;border-radius:8px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;max-width:85%}',
    '.msg.user{align-self:flex-end;background:rgba(99,102,241,.18);color:#c7d2fe}',
    '.msg.bot{align-self:flex-start;background:rgba(255,255,255,.05);color:#e2e8f0}',
    '.msg.err{align-self:flex-start;background:rgba(244,63,94,.15);color:#fda4af}',
    '.ft{display:flex;gap:6px;padding:10px;border-top:1px solid rgba(255,255,255,.06)}',
    '.ft input{flex:1;background:#050608;border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:8px;color:#e2e8f0;font-size:13px}',
    '.ft input:focus{outline:none;border-color:rgba(99,102,241,.5)}',
    '.ft button{background:rgba(99,102,241,.2);color:#c7d2fe;border:1px solid rgba(99,102,241,.3);border-radius:8px;padding:0 12px;cursor:pointer;font-weight:700;font-size:12px}',
    '.ft button:disabled{opacity:.5;cursor:not-allowed}',
  ].join('');
  root.appendChild(style);

  var bubble = el('button', { class: 'bubble', 'aria-label': 'Open ' + cfg.title + ' chat', type: 'button' }, '💬');
  var panel = el('div', { class: 'panel', role: 'dialog', 'aria-label': cfg.title + ' chat' });
  var closeBtn = el('button', { 'aria-label': 'Close chat', type: 'button' }, '×');
  var header = el('div', { class: 'hd' }, [document.createTextNode(cfg.title), closeBtn]);
  var msgs = el('div', { class: 'msgs', role: 'log', 'aria-live': 'polite' });
  var input = el('input', { type: 'text', 'aria-label': 'Message', placeholder: 'Ask anything…' });
  var send = el('button', { type: 'button' }, 'Send');
  var footer = el('div', { class: 'ft' }, [input, send]);
  panel.append(header, msgs, footer);
  root.append(bubble, panel);

  var history = [];
  var busy = false;

  bubble.addEventListener('click', toggle);
  closeBtn.addEventListener('click', toggle);
  send.addEventListener('click', submit);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });

  function toggle() {
    var open = panel.hasAttribute('data-open');
    if (open) panel.removeAttribute('data-open');
    else { panel.setAttribute('data-open', ''); input.focus(); }
  }

  function addMsg(role, text) {
    var cls = role === 'user' ? 'user' : role === 'err' ? 'err' : 'bot';
    var node = el('div', { class: 'msg ' + cls }, text);
    msgs.appendChild(node);
    msgs.scrollTop = msgs.scrollHeight;
    return node;
  }

  function submit() {
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    addMsg('user', text);
    history.push({ role: 'user', content: text });
    stream();
  }

  function stream(attempt) {
    attempt = attempt || 0;
    busy = true; send.disabled = true;
    var botNode = addMsg('bot', '');
    var acc = '';
    var body = { provider: cfg.provider, messages: history, stream: true };
    if (cfg.model) body.model = cfg.model;

    fetch(cfg.apiBase + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';
      return (function pump() {
        return reader.read().then(function (r) {
          if (r.done) return finish();
          buf += decoder.decode(r.value, { stream: true });
          var frames = buf.split('\n\n');
          buf = frames.pop() || '';
          frames.forEach(function (frame) {
            var line = frame.replace(/^data:\s*/, '').trim();
            if (!line || line === '[DONE]') return;
            try {
              var d = JSON.parse(line);
              if (d.done) return;
              var delta = d.chunk || d.text || d.content || d.response || '';
              if (delta) { acc += delta; botNode.textContent = acc; msgs.scrollTop = msgs.scrollHeight; }
            } catch (e) { /* ignore non-JSON keepalive frames */ }
          });
          return pump();
        });
      })();
    }).then(function () {
      finish();
    }).catch(function () {
      // Retry the connect once (transient network) only if nothing streamed yet —
      // an in-progress generation can't be resumed.
      if (!acc && attempt < 1) {
        botNode.remove();
        setTimeout(function () { stream(attempt + 1); }, 400);
        return;
      }
      if (!acc) { botNode.remove(); addMsg('err', 'Could not reach the model. Is the gateway running?'); }
      reset();
    });

    function finish() {
      if (acc) history.push({ role: 'assistant', content: acc });
      reset();
    }
    function reset() { busy = false; send.disabled = false; input.focus(); }
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (children != null) {
      if (Array.isArray(children)) children.forEach(function (c) { node.append(c); });
      else node.textContent = children;
    }
    return node;
  }
})();
