import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

// Migrated from .eslintrc.json when ESLint 9 removed the old format. The two
// restricted-* rules below are not style: they enforce spec §9.5, and a
// migration that quietly dropped them would be the most expensive kind of
// silent regression in this repo. tests/lint-rules.test.js proves they fire.
// Every extension this repo lints, named ONCE. It was two lists, and the
// comment that used to sit here said an extension "belongs in both of these
// lists or it is silently exempt" — a footgun described accurately and then
// left in place. It had already fired twice: .jsx was silently unlinted until
// the flat-config move, and .mjs was silently unlinted the day scripts/ got
// its first one, where an undefined identifier passed CI.
const JS_LIKE = ['**/*.js', '**/*.jsx', '**/*.mjs']

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  { ...js.configs.recommended, files: JS_LIKE },
  {
    // Without an explicit `files`, ESLint lints only .js — so every .jsx file
    // was silently skipped, and the dangerouslySetInnerHTML rule below had
    // never once run. The old .eslintrc setup had the same hole: the lint
    // script has never passed `--ext`.
    //
    files: JS_LIKE,
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-restricted-properties': ['error',
        { property: 'innerHTML', message: 'Banned by spec §9.5 — use text nodes or the sanitised markdown renderer.' },
        { property: 'outerHTML', message: 'Banned by spec §9.5.' },
        { property: 'dangerouslySetInnerHTML', message: 'Banned by spec §9.5.' },
      ],
      // Projects.jsx already carried an eslint-disable for exhaustive-deps,
      // for a plugin that was never installed — an inert comment documenting a
      // decision nothing enforced. Now the rule exists and the comment means
      // something.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-syntax': ['error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Banned by spec §9.5.' },
      ],
    },
  },
]
