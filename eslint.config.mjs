import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier/flat';

export default [
  js.configs.recommended,
  prettier,
  {
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.mocha } },
    rules: { eqeqeq: ['error', 'always', { null: 'ignore' }], 'prefer-const': 'error' },
  },
  { files: ['**/*.mjs'], languageOptions: { sourceType: 'module' } },
  { files: ['public/**/*.js'], languageOptions: { sourceType: 'script', globals: globals.browser } },
];
