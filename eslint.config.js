// vF6 — Frontend ESLint flat config. Scope is deliberately narrow: tsc owns types
// (npm run lint runs both), so ESLint here gates ONLY accessibility (jsx-a11y),
// React hooks correctness, and the choke-point ban (no raw fetch/EventSource in
// components — FRONTEND_AGENTS.md §1/§4). Adopted: eslint-plugin-jsx-a11y (MIT),
// eslint-plugin-react-hooks (MIT), typescript-eslint parser (MIT).
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'dist/**',
      'tests/**',
      'server.ts',
      'server/**',
      'src/styles/tokens.css',
      '*.config.{js,ts}',
      'eslint.config.js',
    ],
  },
  jsxA11y.flatConfigs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Only the correctness rule that catches real bugs. The advisory rules
      // (exhaustive-deps, set-state-in-effect) flag legitimate polling effects
      // here and are out of vF6's a11y scope — left off to keep the gate focused.
      'react-hooks/rules-of-hooks': 'error',
      // Choke-point: components consume the backend ONLY through src/lib/apiClient.
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Use api.* from src/lib/apiClient (FRONTEND_AGENTS §1/§4).' },
        { name: 'EventSource', message: 'Use api.streamPost from src/lib/apiClient.' },
      ],
    },
  },
  {
    // apiClient is the choke-point; Google Drive hits an external API; SaaSAdmin
    // keeps a local token-scoped wrapper — all may use raw fetch by design.
    files: ['src/lib/apiClient.ts', 'src/components/GoogleDriveBrowser.tsx', 'src/components/SaaSAdmin.tsx'],
    rules: { 'no-restricted-globals': 'off' },
  },
];
