// Conservative baseline: catches real bugs (undefined vars, empty catch, dupes) without
// forcing a style. Ratchet by promoting "warn" -> "error" as legacy code is cleaned up.
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'android-*/**', 'supabase/**', 'js/ai-center/repo-index.json'] },
  {
    files: ['js/**/*.js', 'inventory-search/**/*.js', 'sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.serviceworker },
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
      'no-undef': 'warn',            // legacy window.* globals: ratchet to error after Phase 4
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
];
