import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

// Test suites run under Vitest + jsdom. They exercise browser DOM APIs *and*
// pull in Node helpers (fs/path, __dirname, process, global) for fixtures and
// module mocking, so they need both global sets — unlike browser source, which
// must stay Node-free.
const TEST_FILES = ['**/*.{test,spec}.{js,jsx}', 'tests/**/*.{js,jsx}']

export default defineConfig([
  globalIgnores(['dist', 'coverage']),

  // Browser application source (React 19, automatic JSX runtime → no React import).
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: TEST_FILES,
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // Vitest test suites: jsdom (browser) globals + Node globals for fixtures/mocks.
  // Vitest APIs (describe/it/expect/vi) are imported explicitly, so no test globals
  // are injected here. react-refresh is a dev-server DX rule and is irrelevant to
  // tests, so it is intentionally not extended for this block.
  {
    files: TEST_FILES,
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // Node tooling / config files (vite, vitest, eslint configs, scripts).
  {
    files: ['*.{js,cjs,mjs}', 'scripts/**/*.{js,cjs,mjs}'],
    ignores: TEST_FILES,
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
])
