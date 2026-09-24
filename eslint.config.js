import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Линтер настроен узко и по делу: правила, которые ловят настоящие
 * ошибки, а не стилистические предпочтения. Форматирование целиком
 * отдано Prettier — спорить с ним линтером бессмысленно.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'playwright-report/**',
      'test-results/**',
      // Черновые макеты направлений: обычные HTML-файлы, к сборке
      // отношения не имеют.
      '.planning/sketches/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['web/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  {
    files: ['server/**/*.ts', 'e2e/**/*.ts', '*.config.ts', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },

  {
    rules: {
      // Подчёркивание — общепринятая пометка «знаю, что не использую».
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Пустой catch в этом проекте почти всегда осознанный и
      // прокомментированный: недоступное хранилище, закрытый сокет.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
