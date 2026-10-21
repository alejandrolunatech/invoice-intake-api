// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Each layer may import only from the layers it is allowed to know. */
const layer = (files, forbidden, message) => ({
  files,
  rules: {
    '@typescript-eslint/no-restricted-imports': ['error', { patterns: [{ group: forbidden, message }] }],
  },
});

export default tseslint.config(
  { ignores: ['dist/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  layer(['src/domain/**'], ['**/application/**', '**/adapters/**', '**/config*', 'express', 'pg', 'openai', 'pino'],
    'The domain is plain TypeScript: no framework, no adapter.'),
  layer(['src/application/**'], ['**/adapters/**', '**/config*', 'express', 'pg', 'openai', 'pino'],
    'Use cases reach the outside only through their ports.'),
  layer(['src/adapters/http/**'], ['**/adapters/db/**', '**/adapters/llm/**', 'pg', 'openai'],
    'The HTTP adapter talks to use cases, not to other adapters.'),
  {
    // Response bodies in HTTP tests are untyped JSON by nature; the assertions check their shape.
    files: ['test/**'],
    rules: { '@typescript-eslint/no-unsafe-member-access': 'off', '@typescript-eslint/no-unsafe-assignment': 'off' },
  },
  { files: ['**/*.js'], ...tseslint.configs.disableTypeChecked },
);
