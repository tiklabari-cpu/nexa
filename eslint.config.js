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

  // The k6 load suite (apps/load). k6 runs its own JavaScript runtime, not
  // Node: `__ENV` and friends are injected by the host, and `k6/http` is a
  // built-in module rather than anything on disk. Declaring the globals here
  // is what lets `pnpm -w lint` cover these files at all — the alternative was
  // excluding the package, which would leave the one suite that gates the NFR
  // budgets as the only unlinted code in the repo.
  {
    files: ['apps/load/**/*.js'],
    languageOptions: {
      globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly', open: 'readonly' },
    },
    // A k6 scenario reports through stdout; there is no logger to reach for.
    rules: { 'no-console': 'off' },
  },

  // The mobile session, and the only store it is allowed to live in (13.7-b).
  //
  // A rule rather than a test, because the failure mode is an addition: someone
  // reaches for AsyncStorage "just as a simulator fallback" and the refresh
  // token starts living in a plain file that survives into an unencrypted
  // backup. Nothing at runtime notices — the app keeps working, which is exactly
  // why it needs to be refused at build time.
  {
    files: ['apps/mobile/src/auth/**/*.ts', 'apps/mobile/src/api/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@react-native-async-storage/async-storage',
              message: 'Session material goes to expo-secure-store only — AsyncStorage is plain.',
            },
            {
              name: 'expo-file-system',
              message: 'Session material goes to expo-secure-store only — files are plain.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message: 'Not a native store, and not encrypted — use SessionStore.',
        },
        {
          name: 'sessionStorage',
          message: 'Not a native store, and not encrypted — use SessionStore.',
        },
      ],
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
