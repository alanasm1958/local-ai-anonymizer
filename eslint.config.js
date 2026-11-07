import js from '@eslint/js';
import globals from 'globals';

const extensionGlobals = { ...globals.browser, ...globals.webextensions };

export default [
  { ignores: ['vendor/**', 'node_modules/**', 'dist/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: extensionGlobals },
    rules: {
      'no-console': ['error', { allow: ['error', 'warn'] }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // MV3 content scripts are classic scripts sharing one isolated world.
    files: ['src/content/**/*.js'],
    languageOptions: { sourceType: 'script' },
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
  {
    // page.evaluate / worker.evaluate callbacks run inside the extension.
    files: ['tests/e2e/**/*.js', 'tests/helpers/extension-browser.js'],
    languageOptions: { globals: { ...globals.node, ...extensionGlobals } },
  },
];
