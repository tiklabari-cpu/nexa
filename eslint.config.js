import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Flat config shared by every workspace package. Rules are chosen to catch real
 * defects (floating promises, unsafe narrowing) rather than to police style —
 * formatting is Prettier's job.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/generated/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': ['error', { boolean: false }],
      'prefer-const': 'error',
      'no-restricted-syntax': [
        'error',
        {
          // NFR-S6: user-authored text must never be interpolated into markup.
          selector: "MemberExpression[property.name='innerHTML']",
          message: 'innerHTML is banned — use textContent so user content cannot inject markup.',
        },
      ],
    },
  },

  // Browser packages
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/widget/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // Tests may reach for shortcuts that would be sloppy in production code.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**/*.ts', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // Build scripts and seeds are CLIs; printing is the point.
  {
    files: ['**/scripts/**/*.ts', '**/prisma/seed.ts', '**/*.config.{ts,js}'],
    rules: { 'no-console': 'off' },
  },
);
