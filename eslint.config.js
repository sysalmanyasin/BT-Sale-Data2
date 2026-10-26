// Zero-warning policy: unknown globals are errors (known legacy ones live in config/legacy-globals.mjs and may only shrink).
// Style is not enforced; real-bug rules are.
import globals from 'globals';
import { LEGACY_GLOBALS } from './config/legacy-globals.mjs';

export default [
  { ignores: ['node_modules/**', 'coverage/**', '.bundle-check/**', 'android-*/**', 'supabase/**/*.ts', 'js/ai-center/repo-index.json'] },
  {
    files: ['js/**/*.js', 'inventory-search/**/*.js', 'sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.serviceworker, ...LEGACY_GLOBALS },
    },
    rules: {
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-redeclare': 'error',
      'no-self-assign': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-unsafe-finally': 'error',
      'no-const-assign': 'error',
      'no-empty': ['warn', { allowEmptyCatch: false }],
      'no-undef': 'error',           // unknown globals fail CI; known legacy ones live in config/legacy-globals.mjs (ratcheted)
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    // Edge-function helper modules (plain .js next to the .ts entry points). Deno + web-standard globals only.
    files: ['supabase/functions/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.serviceworker, Deno: 'readonly' } },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }], 'no-empty': 'warn' },
  },
];
