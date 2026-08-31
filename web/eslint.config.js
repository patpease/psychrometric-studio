/**
 * Lint rules, kept to the ones that catch bugs this codebase actually produces.
 *
 * This exists because of one of them. The write-through setters in `App.tsx`
 * used to be `useState` setters, whose identity never changes, so callers held
 * them in `useCallback`s with empty dependency arrays. When those setters
 * started closing over the active operating case, every such caller kept
 * writing to whichever case was open when it was created: a click that did
 * nothing on the second page, and a drag that silently edited the first.
 * `react-hooks/exhaustive-deps` would have said so the moment it was written.
 *
 * The type-checked rules are deliberately not enabled. `tsc` already runs in
 * CI with `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`
 * — the rules that would add anything over that mostly restate it, at the cost
 * of a second full type-check on every lint.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    // Generated, vendored, or built: none of it is written by hand, and all of
    // it is verified another way.
    ignores: [
      'dist/**',
      'vendor/**',
      'src/icons/generated.ts',
      'coverage/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // An underscore prefix is how this codebase already says "deliberately
      // unused" — destructuring a field only to drop it from an object.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // The non-null assertion is load-bearing here: `noUncheckedIndexedAccess`
      // makes every array index `T | undefined`, and the alternative to `!` at
      // a known-good index is a guard that can never fire.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // The rule this whole config was added for.
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  {
    // Build scripts and the Worker run in node and workerd, not the browser.
    files: ['scripts/**/*.mjs', 'worker/**/*.ts', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    // Tests reach for globals the application never does, and a fixture that
    // shadows a name is not a defect worth failing a build over.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
