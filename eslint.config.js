import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Modules purs : testables en Node, sans navigateur ni moteur de rendu. */
const PURE_DIRS = ['src/model/**', 'src/gen/**', 'src/hydro/**', 'src/climate/**'];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['../*'], message: 'Utiliser les imports absolus @/… .' }] },
      ],
    },
  },
  {
    // Voir docs/architecture.md : model, gen, hydro et climate ne dépendent
    // d'aucune API de navigateur ni d'aucune bibliothèque d'interface.
    files: PURE_DIRS,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-dom',
                'pixi.js',
                'zustand',
                '@/render/*',
                '@/ui/*',
                '@/store/*',
                '../*',
              ],
              message:
                'Module pur : ni DOM, ni Pixi, ni React, ni Zustand. Voir docs/architecture.md.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
