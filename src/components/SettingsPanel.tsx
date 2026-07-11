// O8 SettingsPanel (docs/odyssey/handoff/settings-2fa/design.html) — ported UI,
// not copied verbatim (Golden Rule, PIPELINE-LESSONS). Data via apiClient
// (/api/modules/settings/*) — never a hard-coded list. design.html's eCy-cyan
// `:root` tokens become a COMPONENT-SCOPED `.set-scope` class (lesson #10),
// driven by the app's real useTheme() so the panel flips with the rest of the
// app. FONTS: Space Grotesk/DM Sans/JetBrains Mono referenced via
// `var(--font-*, fallback)` — no Google @import (PWA/CSP, lesson #11).
// a11y: policy/status are TEXT + icon, never color-only (lesson #9).
import { useCallback, useEffect, useState } from 'react';
import { useLingui } from '@lingui/react';
import {
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  Wrench,
  KeyRound,
  RefreshCw,
  AlertTriangle,
  Check,
  Minus,
  Diamond,
} from 'lucide-react';
import { api } from '../lib/apiClient';
import { useTheme } from '../lib/theme';

type Tr = (id: string) => string;

type Section = 'general' | 'security' | 'roles' | 'tools' | 'vault';
const SECTIONS: { id: Section; icon: typeof SettingsIcon }[] = [
  { id: 'general', icon: SettingsIcon },
  { id: 'security', icon: ShieldCheck },
  { id: 'roles', icon: Users },
  { id: 'tools', icon: Wrench },
  { id: 'vault', icon: KeyRound },
];

interface GeneralPrefs {
  theme: 'dark' | 'light' | 'system';
  density: 'comfortable' | 'compact';
  language: string;
  reduceMotion: boolean;
}

interface TwoFaStatus {
  enabled: boolean;
  backupCodesRemaining: number;
}

interface SessionRecord {
  id: string;
  client: string;
  ip: string;
  location: string;
  lastActive: string;
  current: boolean;
}

const CAPABILITIES = ['models', 'tools', 'vault', 'users', 'daemon'] as const;
type Capability = (typeof CAPABILITIES)[number];
type PermLevel = 'allow' | 'scoped' | 'deny';

interface RoleRecord {
  name: string;
  locked: boolean;
  kind: string;
  perms: Record<Capability, PermLevel>;
}

const TOOL_IDS = ['net', 'fsr', 'fsw', 'sh', 'py', 'mcp', 'clip', 'mem'] as const;
type ToolId = (typeof TOOL_IDS)[number];
type ToolPolicyLevel = 'allow' | 'ask' | 'deny';

interface ToolPolicyRecord {
  tool: ToolId;
  policy: ToolPolicyLevel;
  scope: string;
  tierRef?: string;
}

const PERM_CYCLE: PermLevel[] = ['allow', 'scoped', 'deny'];
const TOOL_POLICY_CYCLE: ToolPolicyLevel[] = ['allow', 'ask', 'deny'];

function PermMark({ level }: { level: PermLevel }) {
  if (level === 'allow') return <Check className="w-4 h-4" style={{ color: 'var(--set-acc)' }} />;
  if (level === 'scoped') return <Diamond className="w-2.5 h-2.5" style={{ color: 'var(--set-warn)', fill: 'var(--set-warn)' }} />;
  return <Minus className="w-4 h-4" style={{ color: 'var(--set-tx3)' }} />;
}

export default function SettingsPanel() {
  const { _: rawT } = useLingui();
  const _: Tr = (id: string) => rawT(id);
  const { theme } = useTheme();

  const [section, setSection] = useState<Section>('security');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [prefs, setPrefs] = useState<GeneralPrefs | null>(null);
  const [twoFa, setTwoFa] = useState<TwoFaStatus | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [roles, setRoles] = useState<RoleRecord[] | null>(null);
  const [tools, setTools] = useState<ToolPolicyRecord[] | null>(null);
  const [sandboxEnforced, setSandboxEnforcedState] = useState(true);

  // 2FA enrollment wizard state
  const [enrolling, setEnrolling] = useState(false);
  const [enrollStep, setEnrollStep] = useState<1 | 2 | 3>(1);
  const [enrollSecret, setEnrollSecret] = useState('');
  const [enrollUrl, setEnrollUrl] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpErr, setOtpErr] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [p, tf, ss, rl, tp, sb] = await Promise.all([
        api.get('/api/modules/settings/general') as Promise<GeneralPrefs>,
        api.get('/api/modules/settings/security/2fa') as Promise<TwoFaStatus>,
        api.get('/api/modules/settings/security/sessions') as Promise<{ sessions: SessionRecord[] }>,
        api.get('/api/modules/settings/roles') as Promise<{ roles: RoleRecord[] }>,
        api.get('/api/modules/settings/tools/policy') as Promise<{ tools: ToolPolicyRecord[] }>,
        api.get('/api/modules/settings/sandbox') as Promise<{ enforced: boolean }>,
      ]);
      setPrefs(p);
      setTwoFa(tf);
      setSessions(ss.sessions);
      setRoles(rl.roles);
      setTools(tp.tools);
      setSandboxEnforcedState(sb.enforced);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const savePrefs = async (patch: Partial<GeneralPrefs>) => {
    setPrefs((cur) => (cur ? { ...cur, ...patch } : cur));
    const updated = (await api.put('/api/modules/settings/general', patch)) as GeneralPrefs;
    setPrefs(updated);
  };

  const toggleSandbox = async () => {
    const next = !sandboxEnforced;
    setSandboxEnforcedState(next);
    const res = (await api.put('/api/modules/settings/sandbox', { enforced: next })) as { enforced: boolean };
    setSandboxEnforcedState(res.enforced);
  };

  const beginEnroll = async () => {
    const res = (await api.post('/api/modules/settings/security/2fa/enroll')) as { secret: string; otpauthUrl: string };
    setEnrollSecret(res.secret);
    setEnrollUrl(res.otpauthUrl);
    setEnrollStep(1);
    setOtpCode('');
    setOtpErr(false);
    setEnrolling(true);
  };

  const submitOtp = async () => {
    try {
      const res = (await api.post('/api/modules/settings/security/2fa/activate', { token: otpCode })) as {
        enabled: true;
        backupCodes: string[];
      };
      setBackupCodes(res.backupCodes);
      setOtpErr(false);
      setEnrollStep(3);
    } catch {
      setOtpErr(true);
    }
  };

  const finishEnroll = async () => {
    setEnrolling(false);
    setTwoFa({ enabled: true, backupCodesRemaining: backupCodes.length });
    await load();
  };

  const cancelEnroll = () => setEnrolling(false);

  const revokeSession = async (id: string) => {
    await api.post(`/api/modules/settings/security/sessions/${id}/revoke`);
    const ss = (await api.get('/api/modules/settings/security/sessions')) as { sessions: SessionRecord[] };
    setSessions(ss.sessions);
  };

  const cycleRolePerm = async (role: RoleRecord, cap: Capability) => {
    if (role.locked) return;
    const idx = PERM_CYCLE.indexOf(role.perms[cap]);
    const next = PERM_CYCLE[(idx + 1) % PERM_CYCLE.length];
    setRoles((cur) => (cur ? cur.map((r) => (r.name === role.name ? { ...r, perms: { ...r.perms, [cap]: next } } : r)) : cur));
    const updated = (await api.put(`/api/modules/settings/roles/${role.name}`, { [cap]: next })) as RoleRecord;
    setRoles((cur) => (cur ? cur.map((r) => (r.name === role.name ? updated : r)) : cur));
  };

  const cycleToolPolicy = async (tool: ToolPolicyRecord) => {
    const idx = TOOL_POLICY_CYCLE.indexOf(tool.policy);
    const next = TOOL_POLICY_CYCLE[(idx + 1) % TOOL_POLICY_CYCLE.length];
    setTools((cur) => (cur ? cur.map((t) => (t.tool === tool.tool ? { ...t, policy: next } : t)) : cur));
    const updated = (await api.put(`/api/modules/settings/tools/policy/${tool.tool}`, { policy: next })) as ToolPolicyRecord;
    setTools((cur) => (cur ? cur.map((t) => (t.tool === tool.tool ? updated : t)) : cur));
  };

  return (
    <section aria-label="settings-panel" className="set-scope" data-theme={theme}>
      <style>{`
        .set-scope[data-theme="dark"] {
          --set-app: #050A14; --set-panel: #0D1B2E; --set-elev: #0A1524; --set-elev2: #132338;
          --set-line: rgba(255,255,255,.06); --set-line2: rgba(255,255,255,.12);
          --set-tx1: #F0F4FF; --set-tx2: #8A9BB0; --set-tx3: #4d6480;
          --set-acc: #00D4FF; --set-acc-soft: rgba(0,212,255,.10); --set-acc-line: rgba(0,212,255,.25);
          --set-ok: #00C896; --set-warn: #F5A623; --set-danger: #FF4757;
          color: var(--set-tx1);
        }
        .set-scope[data-theme="light"] {
          --set-app: #eef1f6; --set-panel: #ffffff; --set-elev: #f5f7fb; --set-elev2: #eceef4;
          --set-line: rgba(12,14,22,.08); --set-line2: rgba(12,14,22,.14);
          --set-tx1: #0d1520; --set-tx2: #566072; --set-tx3: #8b93a5;
          --set-acc: #0088aa; --set-acc-soft: rgba(0,136,170,.08); --set-acc-line: rgba(0,136,170,.28);
          --set-ok: #059669; --set-warn: #b45309; --set-danger: #dc2626;
          color: var(--set-tx1);
        }
        .set-scope .set-mono { font-family: var(--font-mono, ui-monospace, monospace); }
        .set-scope .set-head { font-family: var(--font-display, 'Space Grotesk', sans-serif); }
        .set-scope button { font-family: inherit; }
      `}</style>

      {/* ── Section rail ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {SECTIONS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            aria-pressed={section === id}
            onClick={() => setSection(id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 9,
              border: `1px solid ${section === id ? 'var(--set-acc-line)' : 'var(--set-line2)'}`,
              background: section === id ? 'var(--set-acc-soft)' : 'transparent',
              color: section === id ? 'var(--set-acc)' : 'var(--set-tx2)',
              cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
            }}
          >
            <Icon className="w-3.5 h-3.5" />
            {_(`settings.tab.${id}`)}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          onClick={() => void load()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: 'var(--set-tx2)',
            border: '1px solid var(--set-line2)', borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
          }}
        >
          <RefreshCw className="w-3.5 h-3.5" /> {_('settings.refresh')}
        </button>
      </div>

      {loading && (
        <div role="status" aria-live="polite" className="set-mono" style={{ color: 'var(--set-acc)', fontSize: 12, padding: '20px 0' }}>
          {_('settings.state.loading')}
        </div>
      )}

      {!loading && error && (
        <div
          role="alert"
          style={{
            display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,71,87,0.08)',
            border: '1px solid var(--set-danger)', borderRadius: 12, padding: '16px 18px', color: 'var(--set-danger)',
          }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span style={{ flex: 1, fontSize: 13 }}>{_('settings.state.error')}</span>
          <button
            onClick={() => void load()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: 'var(--set-acc)',
              border: '1px solid var(--set-acc-line)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" /> {_('settings.retry')}
          </button>
        </div>
      )}

      {!loading && !error && section === 'general' && prefs && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="set-head" style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{_('settings.general.theme')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['system', 'light', 'dark'] as const).map((t) => (
                <button
                  key={t}
                  aria-pressed={prefs.theme === t}
                  onClick={() => void savePrefs({ theme: t })}
                  style={{
                    padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 500,
                    background: prefs.theme === t ? 'var(--set-elev2)' : 'transparent',
                    color: prefs.theme === t ? 'var(--set-tx1)' : 'var(--set-tx3)',
                  }}
                >
                  {_(`settings.general.theme.${t}`)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="set-head" style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{_('settings.general.density')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['comfortable', 'compact'] as const).map((d) => (
                <button
                  key={d}
                  aria-pressed={prefs.density === d}
                  onClick={() => void savePrefs({ density: d })}
                  style={{
                    padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 500,
                    background: prefs.density === d ? 'var(--set-elev2)' : 'transparent',
                    color: prefs.density === d ? 'var(--set-tx1)' : 'var(--set-tx3)',
                  }}
                >
                  {_(`settings.general.density.${d}`)}
                </button>
              ))}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={prefs.reduceMotion} onChange={(e) => void savePrefs({ reduceMotion: e.target.checked })} />
            <span style={{ fontSize: 13 }}>{_('settings.general.reduceMotion')}</span>
          </label>
        </div>
      )}

      {!loading && !error && section === 'security' && twoFa && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'var(--set-panel)', border: '1px solid var(--set-line2)', borderRadius: 12, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span className="set-head" style={{ fontSize: 15, fontWeight: 600 }}>{_('settings.security.twoFa.title')}</span>
              <span
                data-testid="twofa-status"
                style={{ fontSize: 11.5, fontWeight: 700, color: twoFa.enabled ? 'var(--set-ok)' : 'var(--set-tx3)' }}
              >
                {twoFa.enabled ? _('settings.security.twoFa.active') : _('settings.security.twoFa.disabled')}
              </span>
            </div>

            {!enrolling && !twoFa.enabled && (
              <button
                onClick={() => void beginEnroll()}
                style={{
                  padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--set-acc)', color: '#050A14',
                  fontWeight: 600, fontSize: 13, cursor: 'pointer',
                }}
              >
                {_('settings.security.twoFa.enable')}
              </button>
            )}

            {!enrolling && twoFa.enabled && (
              <div style={{ fontSize: 12.5, color: 'var(--set-tx2)' }} className="set-mono">
                {_('settings.security.twoFa.backupRemaining').replace('{n}', String(twoFa.backupCodesRemaining))}
              </div>
            )}

            {enrolling && enrollStep === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                <div className="set-mono" style={{ fontSize: 13, color: 'var(--set-acc)', wordBreak: 'break-all' }}>
                  {enrollSecret}
                </div>
                <div className="set-mono" style={{ fontSize: 11, color: 'var(--set-tx3)', wordBreak: 'break-all' }}>{enrollUrl}</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => setEnrollStep(2)}
                    style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--set-acc)', color: '#050A14', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {_('settings.security.twoFa.continue')}
                  </button>
                  <button onClick={cancelEnroll} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--set-line2)', background: 'transparent', color: 'var(--set-tx2)', cursor: 'pointer' }}>
                    {_('settings.security.twoFa.cancel')}
                  </button>
                </div>
              </div>
            )}

            {enrolling && enrollStep === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10, maxWidth: 320 }}>
                <label htmlFor="settings-otp-input" style={{ fontSize: 12.5 }}>
                  {_('settings.security.twoFa.enterCode')}
                </label>
                <input
                  id="settings-otp-input"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  style={{
                    fontFamily: 'var(--font-mono, monospace)', fontSize: 20, letterSpacing: '0.15em', padding: '10px 12px',
                    borderRadius: 8, border: `1.5px solid ${otpErr ? 'var(--set-danger)' : 'var(--set-line2)'}`, background: 'var(--set-elev)', color: 'var(--set-tx1)',
                  }}
                />
                {otpErr && (
                  <div role="alert" style={{ fontSize: 12, color: 'var(--set-danger)' }}>
                    {_('settings.security.twoFa.wrongCode')}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => void submitOtp()}
                    disabled={otpCode.length !== 6}
                    style={{
                      padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--set-acc)', color: '#050A14',
                      fontWeight: 600, cursor: otpCode.length === 6 ? 'pointer' : 'not-allowed', opacity: otpCode.length === 6 ? 1 : 0.5,
                    }}
                  >
                    {_('settings.security.twoFa.verify')}
                  </button>
                  <button onClick={() => setEnrollStep(1)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--set-line2)', background: 'transparent', color: 'var(--set-tx2)', cursor: 'pointer' }}>
                    {_('settings.security.twoFa.back')}
                  </button>
                </div>
              </div>
            )}

            {enrolling && enrollStep === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                <div style={{ fontSize: 13 }}>{_('settings.security.twoFa.backupIntro')}</div>
                <div
                  data-testid="backup-codes"
                  className="set-mono"
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px', padding: 14,
                    background: 'var(--set-elev)', border: '1px solid var(--set-line2)', borderRadius: 10, fontSize: 13,
                  }}
                >
                  {backupCodes.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
                <button
                  onClick={() => void finishEnroll()}
                  style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'var(--set-acc)', color: '#050A14', fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' }}
                >
                  {_('settings.security.twoFa.finish')}
                </button>
              </div>
            )}
          </div>

          <div style={{ background: 'var(--set-panel)', border: '1px solid var(--set-line2)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--set-line)', fontWeight: 600, fontSize: 13 }}>
              {_('settings.security.sessions.title')} <span className="set-mono" style={{ color: 'var(--set-tx3)', fontWeight: 400 }}>· {sessions?.length ?? 0}</span>
            </div>
            {(sessions ?? []).map((s) => (
              <div key={s.id} data-session-row style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', borderTop: '1px solid var(--set-line)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                    {s.client} {s.current && <span style={{ fontSize: 10.5, color: 'var(--set-acc)' }}>· {_('settings.security.sessions.thisDevice')}</span>}
                  </div>
                  <div className="set-mono" style={{ fontSize: 11.5, color: 'var(--set-tx3)' }}>{s.ip} · {s.location}</div>
                </div>
                {s.current ? (
                  <span style={{ fontSize: 12, color: 'var(--set-ok)' }}>{_('settings.security.sessions.current')}</span>
                ) : (
                  <button
                    onClick={() => void revokeSession(s.id)}
                    style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--set-line2)', background: 'transparent', color: 'var(--set-tx2)', fontSize: 12, cursor: 'pointer' }}
                  >
                    {_('settings.security.sessions.revoke')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && section === 'roles' && roles && (
        <div style={{ background: 'var(--set-panel)', border: '1px solid var(--set-line2)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr repeat(5, 1fr)', padding: '10px 16px', background: 'var(--set-elev)', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: 'var(--set-tx3)' }}>
            <div>{_('settings.roles.role')}</div>
            {CAPABILITIES.map((c) => (
              <div key={c} style={{ textAlign: 'center' }}>{_(`settings.roles.cap.${c}`)}</div>
            ))}
          </div>
          {roles.map((role) => (
            <div key={role.name} data-role-row style={{ display: 'grid', gridTemplateColumns: '1.3fr repeat(5, 1fr)', padding: '11px 16px', borderTop: '1px solid var(--set-line)', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {_(`settings.roles.name.${role.name}`)}
                  {role.locked && <span style={{ fontSize: 10, color: 'var(--set-tx3)' }}>({_('settings.roles.locked')})</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--set-tx3)' }}>{role.kind}</div>
              </div>
              {CAPABILITIES.map((cap) => (
                <div key={cap} style={{ display: 'flex', justifyContent: 'center' }}>
                  <button
                    aria-label={`${role.name}-${cap}-${role.perms[cap]}`}
                    onClick={() => void cycleRolePerm(role, cap)}
                    disabled={role.locked}
                    style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: 'transparent', cursor: role.locked ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <PermMark level={role.perms[cap]} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {!loading && !error && section === 'tools' && tools && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 12,
              border: `1px solid ${sandboxEnforced ? 'var(--set-acc-line)' : 'var(--set-line2)'}`,
              background: sandboxEnforced ? 'var(--set-acc-soft)' : 'var(--set-elev)',
            }}
          >
            <div style={{ flex: 1 }}>
              <div className="set-head" style={{ fontSize: 14, fontWeight: 600 }}>{_('settings.tools.sandbox.title')}</div>
              <div style={{ fontSize: 12, color: 'var(--set-tx2)' }}>
                {sandboxEnforced ? _('settings.tools.sandbox.enforcedDesc') : _('settings.tools.sandbox.advisoryDesc')}
              </div>
            </div>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: sandboxEnforced ? 'var(--set-ok)' : 'var(--set-warn)' }}>
              {sandboxEnforced ? _('settings.tools.sandbox.enforced') : _('settings.tools.sandbox.advisory')}
            </span>
            <button
              role="switch"
              aria-checked={sandboxEnforced}
              onClick={() => void toggleSandbox()}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--set-line2)', background: 'transparent', color: 'var(--set-tx1)', cursor: 'pointer', fontSize: 12 }}
            >
              {sandboxEnforced ? _('settings.tools.sandbox.disable') : _('settings.tools.sandbox.enable')}
            </button>
          </div>

          <div style={{ background: 'var(--set-panel)', border: '1px solid var(--set-line2)', borderRadius: 12, overflow: 'hidden' }}>
            {tools.map((t) => (
              <div key={t.tool} data-tool-row style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', borderTop: '1px solid var(--set-line)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{_(`settings.tools.name.${t.tool}`)}</div>
                  <div className="set-mono" style={{ fontSize: 11, color: 'var(--set-tx3)' }}>
                    {t.scope}
                    {t.tierRef ? ` · tier:${t.tierRef}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => void cycleToolPolicy(t)}
                  aria-label={`${t.tool}-policy-${t.policy}`}
                  style={{
                    padding: '6px 16px', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${t.policy === 'deny' ? 'var(--set-line2)' : 'var(--set-acc-line)'}`,
                    background: t.policy === 'allow' ? 'var(--set-acc-soft)' : 'transparent',
                    color: t.policy === 'deny' ? 'var(--set-tx3)' : t.policy === 'ask' ? 'var(--set-warn)' : 'var(--set-acc)',
                  }}
                >
                  {_(`settings.tools.policy.${t.policy}`)}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && section === 'vault' && (
        <div style={{ background: 'var(--set-panel)', border: '1px solid var(--set-line2)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--set-tx2)', fontSize: 13 }}>
          {_('settings.vault.redirect')}
        </div>
      )}
    </section>
  );
}
