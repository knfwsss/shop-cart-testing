const js = require('@eslint/js');
const security = require('eslint-plugin-security');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'playwright-report/**', 'test-results/**', 'reports/**', 'tests/lr5_load/**'],
  },
  js.configs.recommended,
  security.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
];
