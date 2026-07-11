// O3 Documents — writing-first document workspace (PDF/office/markdown → text).
// Ported from docs/odyssey/handoff/documents/design.html (Golden Rule: reference,
// not verbatim — indigo palette #6366f1/#8b5cf6, list + viewer layout). Data via
// apiClient (/api/modules/documents/*) — never a hard-coded list.
//
// THEME: the design.html indigo palette is scoped to `.doc-scope` (component-
// local CSS vars), so no raw hex leaks into global CSS (PIPELINE-LESSONS #10).
// FONTS: Inter/JetBrains Mono are referenced via var(--font-*, fallback) — no
// Google @import here (PWA/CSP, lesson #11); falls back to the existing stack.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLingui } from '@lingui/react';
import { RefreshCw, AlertTriangle, FileText, Upload, Trash2 } from 'lucide-react';
import { api } from '../lib/apiClient';

type DocKind = 'pdf' | 'docx' | 'xlsx' | 'markdown' | 'text' | 'unknown';

interface DocumentRecord {
  id: string;
  name: string;
  kind: DocKind;
  mime: string;
  bytes: number;
  text: string;
  html?: string;
  pages?: number;
  sheets?: { name: string; rows: string[][] }[];
  truncated: boolean;
  extractError?: string;
  created_at: string;
  updated_at: string;
}

type Tr = (id: string) => string;

const KIND_COLOR: Record<DocKind, string> = {
  markdown: '#22d3ee',
  pdf: '#fb7185',
  docx: '#fbbf24',
  xlsx: '#fbbf24',
  text: '#9aa1b2',
  unknown: '#5f6675',
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// FileReader (not File.arrayBuffer, which jsdom's test DOM doesn't implement —
// found live while writing tests/ui/documents-panel.test.tsx) — data-URL result
// is `data:<mime>;base64,<payload>`; split off the header to get raw base64.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}

export default function DocumentsPanel() {
  const { _: rawT } = useLingui();
  const _: Tr = (id: string) => rawT(id);

  const [docs, setDocs] = useState<DocumentRecord[] | null>(null);
  const [selected, setSelected] = useState<DocumentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = (await api.get('/api/modules/documents')) as { documents: DocumentRecord[] };
      setDocs(res.documents);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const kindLabel = (k: DocKind) => _(`documents.kind.${k}`);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setUploadError(null);
      try {
        const contentBase64 = await fileToBase64(file);
        await api.post('/api/modules/documents', { name: file.name, contentBase64 });
        await load();
      } catch {
        setUploadError(_('documents.uploadFailed'));
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [load, _],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await api.del(`/api/modules/documents/${id}`);
      if (selected?.id === id) setSelected(null);
      await load();
    },
    [load, selected],
  );

  return (
    <section aria-label="documents-panel" className="doc-scope">
      <style>{`
        .doc-scope {
          --dc-bg: #0a0b10; --dc-raised: #0e0f16; --dc-elev: #14161d;
          --dc-accent: #6366f1; --dc-accent2: #8b5cf6;
          --dc-line: rgba(255,255,255,0.08); --dc-line2: rgba(255,255,255,0.14);
          --dc-accent-soft: rgba(99,102,241,0.14); --dc-accent-line: rgba(99,102,241,0.4);
          --dc-tx1: #e6e8ee; --dc-tx2: #9aa1b2; --dc-tx3: #6d7488;
          --dc-err: #fb7185;
          color: var(--dc-tx1);
        }
        .doc-scope .dc-mono { font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace); }
        .doc-scope .dc-eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600; }
        @keyframes dcScan { 0% { transform: translateX(-120%); } 100% { transform: translateX(420%); } }
      `}</style>

      {/* ── Header: title + upload ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <FileText className="w-4 h-4" style={{ color: 'var(--dc-accent)' }} />
        <span style={{ fontSize: 15, fontWeight: 600 }}>{_('documents.title')}</span>
        <span className="dc-mono" style={{ fontSize: 10, color: '#8b8ef5', background: 'var(--dc-accent-soft)', border: '1px solid var(--dc-accent-line)', borderRadius: 5, padding: '2px 7px' }}>
          {_('documents.subtitle')}
        </span>
        <span style={{ flex: 1 }} />
        <input
          ref={fileInputRef}
          type="file"
          aria-label={_('documents.upload')}
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUpload(f);
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--dc-accent)', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}
        >
          <Upload className="w-3.5 h-3.5" /> {uploading ? _('documents.uploading') : _('documents.upload')}
        </button>
        <button
          onClick={() => void load()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: 'var(--dc-tx2)', border: '1px solid var(--dc-line2)', borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
        >
          <RefreshCw className="w-3.5 h-3.5" /> {_('documents.refresh')}
        </button>
      </div>

      {uploadError && (
        <div role="alert" style={{ marginBottom: 10, fontSize: 12, color: 'var(--dc-err)' }}>
          {uploadError}
        </div>
      )}

      {/* ── LOADING ── */}
      {loading && (
        <div
          role="status"
          aria-live="polite"
          style={{ position: 'relative', overflow: 'hidden', background: 'var(--dc-bg)', border: '1px solid var(--dc-accent-line)', borderRadius: 14, padding: '22px 20px' }}
        >
          <div style={{ position: 'absolute', top: 0, left: 0, height: 2, width: '26%', background: 'linear-gradient(90deg,transparent,var(--dc-accent),transparent)', animation: 'dcScan 0.85s linear infinite' }} />
          <div className="dc-mono" style={{ color: 'var(--dc-accent2)', fontSize: 12 }}>{_('documents.state.loading')}</div>
        </div>
      )}

      {/* ── ERROR ── */}
      {!loading && error && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(251,113,133,0.08)', border: '1px solid var(--dc-err)', borderRadius: 12, padding: '16px 18px', color: 'var(--dc-err)' }}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span style={{ flex: 1, fontSize: 13 }}>{_('documents.state.error')}</span>
          <button
            onClick={() => void load()}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: 'var(--dc-accent2)', border: '1px solid var(--dc-accent-line)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            <RefreshCw className="w-3.5 h-3.5" /> {_('documents.retry')}
          </button>
        </div>
      )}

      {/* ── EMPTY ── */}
      {!loading && !error && docs && docs.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--dc-tx3)', background: 'var(--dc-bg)', border: '1px solid var(--dc-line)', borderRadius: 12, padding: '40px 20px', fontSize: 13 }}>
          {_('documents.state.empty')}
        </div>
      )}

      {/* ── LIST + VIEWER ── */}
      {!loading && !error && docs && docs.length > 0 && (
        <div style={{ display: 'flex', gap: 16 }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, width: 260, flex: 'none' }}>
            {docs.map((d) => (
              <li
                key={d.id}
                data-document-row
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  background: selected?.id === d.id ? 'var(--dc-accent-soft)' : 'var(--dc-raised)',
                  border: `1px solid ${selected?.id === d.id ? 'var(--dc-accent-line)' : 'var(--dc-line2)'}`,
                  borderRadius: 10, padding: '2px 6px 2px 11px',
                }}
              >
                <button
                  onClick={() => setSelected(d)}
                  style={{
                    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9,
                    background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer',
                    padding: '7px 0', font: 'inherit', textAlign: 'left',
                  }}
                >
                  <span
                    className="dc-mono"
                    style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.04em', color: KIND_COLOR[d.kind], background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 6px' }}
                  >
                    {kindLabel(d.kind)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--dc-tx1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
                  <span className="dc-mono" style={{ fontSize: 10, color: 'var(--dc-tx3)' }}>{fmtBytes(d.bytes)}</span>
                </button>
                <button
                  aria-label={`${_('documents.delete')} ${d.name}`}
                  onClick={() => void handleDelete(d.id)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--dc-tx3)', cursor: 'pointer', padding: 2 }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>

          <div style={{ flex: 1, minWidth: 0, background: 'var(--dc-bg)', border: '1px solid var(--dc-line)', borderRadius: 12, padding: '16px 18px' }}>
            {!selected && (
              <div style={{ color: 'var(--dc-tx3)', fontSize: 13 }}>{_('documents.viewer.empty')}</div>
            )}
            {selected && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{selected.name}</span>
                  {typeof selected.pages === 'number' && (
                    <span className="dc-mono" style={{ fontSize: 10.5, color: 'var(--dc-tx3)' }}>{selected.pages} {_('documents.meta.pages')}</span>
                  )}
                  {selected.sheets && (
                    <span className="dc-mono" style={{ fontSize: 10.5, color: 'var(--dc-tx3)' }}>{selected.sheets.length} {_('documents.meta.sheets')}</span>
                  )}
                  {selected.truncated && (
                    <span className="dc-mono" style={{ fontSize: 10.5, color: 'var(--dc-tx3)' }}>({_('documents.meta.truncated')})</span>
                  )}
                </div>
                {selected.extractError ? (
                  <div role="alert" style={{ color: 'var(--dc-err)', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle className="w-3.5 h-3.5" /> {_('documents.viewer.extractError')}
                  </div>
                ) : selected.html ? (
                  // Server-side sanitized (server/modules/documents/service.ts sanitizeHtml) —
                  // script/style/on*-handler/javascript: stripped before it ever reaches here.
                  <div
                    className="dc-doc-html"
                    style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--dc-tx2)' }}
                    dangerouslySetInnerHTML={{ __html: selected.html }}
                  />
                ) : (
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.6, color: 'var(--dc-tx2)', margin: 0, fontFamily: 'var(--font-mono, monospace)' }}>
                    {selected.text}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
