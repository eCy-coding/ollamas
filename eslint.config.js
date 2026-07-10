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
      // NB: gitignore semantics — an ignored PARENT dir cannot be re-included via a
      // child negation. Ignore server's direct children (`server/*`) instead of the
      // whole subtree (`server/**`) so the O0 import-guard can re-include
      // server/modules below (only the tests inside it stay ignored).
      'server/*',
      '!server/modules/',
      'server/modules/**/__tests__/**',
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
    files: ['src/lib/apiClient.ts', 'src/components/GoogleDriveBrowser.tsx', 'src/components/GoogleSheetsBrowser.tsx', 'src/components/SaaSAdmin.tsx'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    // O0 store seam (02-o0-foundation.md §2.1 P6): module code reaches persistence
    // ONLY through server/modules/_core/store.ts — direct server/store imports fail.
    files: ['server/modules/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { sourceType: 'module' },
      globals: { ...globals.node },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Forbid the server/store persistence layer. Subpath forms
              // (store/index|db-adapter|migrations|vector) exist ONLY under
              // server/store — the _core/store FACADE has no such subpaths and a
              // module's OWN sibling ./store is not an up-reference, so both stay
              // allowed. Plus the bare up-directory forms that resolve to server/store.
              group: [
                '**/store/index', '**/store/index.*',
                '**/store/db-adapter', '**/store/db-adapter.*',
                '**/store/migrations', '**/store/migrations.*',
                '**/store/vector', '**/store/vector.*',
                '../store', '../../store', '../../../store',
              ],
              message: 'Modules access persistence ONLY via server/modules/_core/store (O0 INV, 02-o0-foundation.md §2.1).',
            },
          ],
        },
      ],
    },
  },
  {
    // The facade itself + the registry are the sanctioned infrastructure layer.
    files: ['server/modules/_core/**/*.ts', 'server/modules/registry.ts', 'server/modules/index.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];
