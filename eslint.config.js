import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.tsbuild/**',
      'assets/**',
      'OmegaStrikers/**',
      'SpriteCollab-master/**',
      'Pokebonk Offline-win32-x64/**',
      'tools/research/**',
      'out/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The simulation must stay deterministic.
    files: ['packages/sim/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use a seeded RNG in the sim.' },
        { object: 'Math', property: 'sin', message: 'Not bit-exact across engines.' },
        { object: 'Math', property: 'cos', message: 'Not bit-exact across engines.' },
        { object: 'Math', property: 'atan2', message: 'Not bit-exact across engines.' },
        { object: 'Date', property: 'now', message: 'The sim has no wall clock.' },
        { object: 'performance', property: 'now', message: 'The sim has no wall clock.' },
      ],
      'no-restricted-imports': ['error', { patterns: ['three', '@pokeathlon/client'] }],
    },
  },
);
