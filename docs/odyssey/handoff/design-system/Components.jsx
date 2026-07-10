// eCy Web UI Kit — Shared Components
// KAYNAK: claude.ai/design "eCy Design System" ui_kits/ecy_web/Components.jsx (DesignSync, 2026-07-11)
// REFERANS KİT (Golden Rule: verbatim kopyalanmaz — ollamas panellerine token-remap ile uyarlanır)
// Load with <script type="text/babel" src="Components.jsx"></script>

const ECY_TOKENS = {
  cyan: '#00D4FF',
  cyanMuted: 'rgba(0,212,255,0.10)',
  cyanBorder: 'rgba(0,212,255,0.20)',
  bgBase: '#050A14',
  bgSurface: '#0D1B2E',
  bgRaised: '#132338',
  bgOverlay: '#1A2E47',
  fgPrimary: '#F0F4FF',
  fgSecondary: '#8A9BB0',
  fgTertiary: '#536882',
  borderSubtle: 'rgba(255,255,255,0.06)',
  borderDefault: 'rgba(255,255,255,0.10)',
  success: '#00C896',
  warning: '#F5A623',
  danger: '#FF4757',
};

// ── NAV ──────────────────────────────────────────
function NavBar({ activePage, onNav }) {
  const navStyles = {
    nav: {
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
      height: 56, display: 'flex', alignItems: 'center',
      padding: '0 32px', gap: 0,
      background: 'rgba(5,10,20,0.85)',
      backdropFilter: 'blur(16px)',
      borderBottom: `1px solid ${ECY_TOKENS.borderSubtle}`,
    },
    logo: {
      fontFamily: "'Space Grotesk', sans-serif",
      fontWeight: 700, fontSize: 20, letterSpacing: '-0.03em',
      color: ECY_TOKENS.fgPrimary, marginRight: 40, cursor: 'pointer',
      display: 'flex', alignItems: 'center', gap: 8,
    },
    logoCyan: { color: ECY_TOKENS.cyan },
    links: { display: 'flex', gap: 2, flex: 1 },
    link: (active) => ({
      fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 500,
      padding: '6px 14px', borderRadius: 7, cursor: 'pointer',
      color: active ? ECY_TOKENS.fgPrimary : ECY_TOKENS.fgSecondary,
      background: active ? ECY_TOKENS.bgRaised : 'transparent',
      border: 'none', transition: 'all 150ms',
    }),
    actions: { display: 'flex', gap: 10, alignItems: 'center' },
    btnGhost: {
      fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 500,
      background: 'transparent', color: ECY_TOKENS.fgSecondary,
      border: `1px solid ${ECY_TOKENS.borderDefault}`,
      borderRadius: 7, padding: '6px 14px', cursor: 'pointer',
    },
    btnPrimary: {
      fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600,
      background: ECY_TOKENS.cyan, color: '#050A14',
      border: 'none', borderRadius: 7, padding: '6px 16px', cursor: 'pointer',
    },
  };
  const pages = ['Product', 'Docs', 'Pricing', 'Blog'];
  return (
    <nav style={navStyles.nav}>
      <div style={navStyles.logo} onClick={() => onNav('home')}>
        e<span style={navStyles.logoCyan}>Cy</span>
      </div>
      <div style={navStyles.links}>
        {pages.map(p => (
          <button key={p} style={navStyles.link(activePage === p)} onClick={() => onNav(p)}>{p}</button>
        ))}
      </div>
      <div style={navStyles.actions}>
        <button style={navStyles.btnGhost} onClick={() => onNav('login')}>Sign in</button>
        <button style={navStyles.btnPrimary} onClick={() => onNav('signup')}>Get Started</button>
      </div>
    </nav>
  );
}

// ── SIDEBAR ───────────────────────────────────────
function Sidebar({ activeItem, onNav }) {
  const items = [
    { id: 'overview', label: 'Overview', icon: '▦' },
    { id: 'pipelines', label: 'Pipelines', icon: '⬡' },
    { id: 'logs', label: 'Logs', icon: '≡' },
    { id: 'settings', label: 'Settings', icon: '◎' },
  ];
  const s = {
    sidebar: {
      width: 220, background: ECY_TOKENS.bgSurface,
      borderRight: `1px solid ${ECY_TOKENS.borderSubtle}`,
      height: '100%', padding: '24px 12px', display: 'flex', flexDirection: 'column', gap: 2,
    },
    item: (active) => ({
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
      fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: active ? 600 : 400,
      color: active ? ECY_TOKENS.fgPrimary : ECY_TOKENS.fgSecondary,
      background: active ? ECY_TOKENS.bgRaised : 'transparent',
      borderLeft: active ? `2px solid ${ECY_TOKENS.cyan}` : '2px solid transparent',
      transition: 'all 150ms',
    }),
    icon: (active) => ({
      fontSize: 14, color: active ? ECY_TOKENS.cyan : ECY_TOKENS.fgTertiary,
    }),
    section: {
      fontFamily: "'Space Grotesk', sans-serif", fontSize: 10, fontWeight: 600,
      letterSpacing: '0.14em', textTransform: 'uppercase',
      color: ECY_TOKENS.fgTertiary, padding: '16px 12px 8px',
    },
  };
  return (
    <div style={s.sidebar}>
      <div style={s.section}>Workspace</div>
      {items.map(({ id, label, icon }) => (
        <div key={id} style={s.item(activeItem === id)} onClick={() => onNav(id)}>
          <span style={s.icon(activeItem === id)}>{icon}</span>
          {label}
        </div>
      ))}
    </div>
  );
}

// ── BADGE ─────────────────────────────────────────
function Badge({ type = 'default', children }) {
  const configs = {
    live:    { bg: 'rgba(0,200,150,0.12)',  color: '#00C896', border: 'rgba(0,200,150,0.25)' },
    building:{ bg: 'rgba(245,166,35,0.12)', color: '#F5A623', border: 'rgba(245,166,35,0.25)' },
    failed:  { bg: 'rgba(255,71,87,0.12)',  color: '#FF4757', border: 'rgba(255,71,87,0.25)' },
    info:    { bg: 'rgba(0,212,255,0.10)',  color: '#00D4FF', border: 'rgba(0,212,255,0.25)' },
    default: { bg: 'rgba(255,255,255,0.06)',color: '#8A9BB0', border: 'rgba(255,255,255,0.10)' },
  };
  const c = configs[type] || configs.default;
  return (
    <span style={{
      fontFamily: "'Space Grotesk', sans-serif", fontSize: 11, fontWeight: 600,
      padding: '3px 10px', borderRadius: 9999,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.color }}></span>
      {children}
    </span>
  );
}

// ── STAT CARD ─────────────────────────────────────
function StatCard({ value, unit, label, glow }) {
  return (
    <div style={{
      background: ECY_TOKENS.bgSurface,
      border: `1px solid ${glow ? 'rgba(0,212,255,0.30)' : ECY_TOKENS.borderDefault}`,
      borderRadius: 12, padding: '20px 24px',
      boxShadow: glow ? '0 0 20px rgba(0,212,255,0.18), 0 4px 16px rgba(0,0,0,0.4)' : '0 4px 16px rgba(0,0,0,0.3)',
    }}>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 36, fontWeight: 700, color: ECY_TOKENS.fgPrimary, lineHeight: 1 }}>
        {value}<span style={{ fontSize: 14, color: ECY_TOKENS.cyan, fontWeight: 500, marginLeft: 6 }}>{unit}</span>
      </div>
      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: ECY_TOKENS.fgSecondary, marginTop: 8 }}>{label}</div>
    </div>
  );
}

// ── BTN ───────────────────────────────────────────
function Btn({ variant = 'primary', size = 'md', children, onClick }) {
  const sizes = { sm: { fontSize: 12, padding: '6px 14px', borderRadius: 6 }, md: { fontSize: 14, padding: '10px 20px', borderRadius: 8 }, lg: { fontSize: 16, padding: '14px 28px', borderRadius: 10 } };
  const variants = {
    primary: { background: ECY_TOKENS.cyan, color: '#050A14', border: 'none' },
    secondary: { background: ECY_TOKENS.cyanMuted, color: ECY_TOKENS.cyan, border: `1px solid ${ECY_TOKENS.cyanBorder}` },
    ghost: { background: 'transparent', color: ECY_TOKENS.fgSecondary, border: `1px solid ${ECY_TOKENS.borderDefault}` },
  };
  return (
    <button onClick={onClick} style={{
      fontFamily: "'Space Grotesk', sans-serif", fontWeight: 500, cursor: 'pointer',
      transition: 'all 200ms cubic-bezier(0.16,1,0.3,1)',
      ...sizes[size], ...variants[variant],
    }}>{children}</button>
  );
}

// ── INPUT ─────────────────────────────────────────
function Input({ label, placeholder, value, hint, error }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && <label style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 500, color: ECY_TOKENS.fgSecondary }}>{label}</label>}
      <input defaultValue={value} placeholder={placeholder} style={{
        fontFamily: "'DM Sans',sans-serif", fontSize: 14,
        background: ECY_TOKENS.bgRaised, color: ECY_TOKENS.fgPrimary,
        border: `1px solid ${error ? ECY_TOKENS.danger : ECY_TOKENS.borderDefault}`,
        borderRadius: 8, padding: '9px 12px', outline: 'none', width: '100%', boxSizing: 'border-box',
      }} />
      {hint && <span style={{ fontSize: 11, color: error ? ECY_TOKENS.danger : ECY_TOKENS.fgTertiary, fontFamily: "'DM Sans',sans-serif" }}>{hint}</span>}
    </div>
  );
}

Object.assign(window, { NavBar, Sidebar, Badge, StatCard, Btn, Input, ECY_TOKENS });
