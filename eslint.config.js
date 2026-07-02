/**
 * ESLint flat config for SpecFuse — ESM-only Node.js >= 20 project.
 *
 * Run `pnpm install` first to fetch eslint and eslint-config-prettier.
 */

import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['node_modules/', 'templates/'],
  },

  {
    files: ['**/*.js', '**/*.mjs'],

    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Node.js global built-ins
        process: 'readonly',
        console: 'readonly',
        __dirname: 'off',     // ESM — not available
        __filename: 'off',    // ESM — not available
        require: 'off',       // ESM — not available
        module: 'off',        // ESM — not available
        exports: 'off',       // ESM — not available
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        setImmediate: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        clearImmediate: 'readonly',
        globalThis: 'readonly',
      },
    },

    rules: {
      // Possible errors
      'no-console': 'off',             // CLI tool — console is primary output
      'no-constant-condition': 'warn',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-empty': 'warn',
      'no-ex-assign': 'error',
      'no-extra-semi': 'error',
      'no-func-assign': 'error',
      'no-irregular-whitespace': 'error',
      'no-unreachable': 'error',
      'no-unsafe-negation': 'error',
      'valid-typeof': 'error',

      // Best practices
      'curly': ['error', 'multi-line'],
      'eqeqeq': ['error', 'always'],
      'no-case-declarations': 'error',
      'no-eval': 'error',
      'no-fallthrough': ['error', { commentPattern: 'break[\\s\\w]*omitted' }],
      'no-global-assign': 'error',
      'no-implicit-globals': 'error',
      'no-implied-eval': 'error',
      'no-lone-blocks': 'error',
      'no-multi-str': 'error',
      'no-new-wrappers': 'error',
      'no-octal': 'error',
      'no-octal-escape': 'error',
      'no-proto': 'error',
      'no-redeclare': 'error',
      'no-return-await': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-unused-expressions': ['error', { allowShortCircuit: true, allowTaggedTemplates: true }],
      'no-useless-call': 'error',
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'no-with': 'error',
      'prefer-promise-reject-errors': 'error',
      'require-await': 'warn',

      // Variables
      'no-delete-var': 'error',
      'no-shadow-restricted-names': 'error',
      'no-undef': 'error',
      'no-undef-init': 'warn',
      'no-unused-vars': ['warn', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'no-use-before-define': ['error', { functions: false }],

      // Stylistic (formatting rules — Prettier handles these, but these are
      // non-formatting style rules that Prettier doesn't cover)
      'no-mixed-spaces-and-tabs': 'error',
      'no-multi-spaces': 'off',        // Prettier handles alignment
      'no-trailing-spaces': 'off',      // Prettier handles
      'no-multiple-empty-lines': 'off', // Prettier handles
    },
  },

  {
    files: ['src/tests/**/*.js', 'src/tests/**/*.mjs'],
    rules: {
      'no-unused-vars': ['warn', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
    },
  },

  // Prettier compatibility — turns off all ESLint rules that conflict with Prettier
  eslintConfigPrettier,
];
