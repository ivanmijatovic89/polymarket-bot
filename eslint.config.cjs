// eslint.config.cjs
const tsParser = require('@typescript-eslint/parser')
const tsPlugin = require('@typescript-eslint/eslint-plugin')
const prettierConfig = require('eslint-config-prettier')

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  // 1) Global ignore pravila (umesto .eslintignore)
  {
    ignores: ['node_modules', 'dist', 'build'],
  },

  // 2) TypeScript pravila za sve .ts / .tsx fajlove
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: __dirname,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // Uzimamo recommended pravila iz TS plugina
      ...tsPlugin.configs.recommended.rules,

      // Gasi ESLint/TS style pravila koja se kose sa Prettier-om
      ...(prettierConfig.rules ?? {}),

      // Tvoja custom pravila:
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
]
