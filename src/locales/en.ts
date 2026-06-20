// vF9 — English message catalog (runtime ids, no macro). Keys are explicit so
// `i18n._('app.tab.telemetry')` returns the string; missing → returns the id.
export const messages: Record<string, string> = {
  'app.tab.telemetry': 'Cockpit Dashboard',
  'app.tab.swarm': 'P2P Computing Swarm',
  'app.tab.saas': 'SaaS Gateway',
  'app.tab.pipeline': 'Pipeline Agent',
  'app.tab.react-agent': 'ReAct Specialist',
  'app.tab.files': 'Files Explorer',
  'app.tab.drive': 'Google Drive',
  'app.tab.terminal': 'Interactive CLI',
  'app.tab.keys': 'Hardware Vault',
  'app.tab.security': 'Guard Policies',
  'app.tab.backup': 'AES Cloud Backup',
  'app.tab.automation': 'Virtual Controller',
  'app.tab.selftest': 'Verify Gates',
  'app.sidebar.explorer': 'Project Explorer',
  'app.status.activeHost': 'Active Host:',
  'app.status.workspace': 'Workspace:',
  'app.footer.copyright':
    '© 2026 LLM Mission Control. Offline-First Privacy Secured Machine Cockpit.',
  'app.theme.toLight': 'Switch to light theme',
  'app.theme.toDark': 'Switch to dark theme',
  'app.lang.label': 'Language',
  'app.lang.tr': 'Türkçe',
  'app.lang.en': 'English',
};
