// ESLint flat config（ESLint 9+ 不再支持 .eslintrc.*）
// 对应旧模板 ~/.config/opencode/template/.eslintrc.json，规则已按本仓库实际风格调整。
//
// 存量违规基线：eslint-suppressions.json（113 个文件 / 244 条 @typescript-eslint/no-unused-vars）
//   npm run lint                    仅对本轮新增的问题报错
//   npx eslint ... --prune-suppressions   清理已修复的基线条目
//   npx eslint ... --suppress-rule <rule> 为某个规则补充基线
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'prod/**',
      'node_modules/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: {
      'no-console': 'off', // 服务端大量使用日志
      'no-debugger': 'error',

      // 空 catch 是本项目刻意的降级处理（缓存/推送失败不阻断主流程）
      'no-empty': ['error', { allowEmptyCatch: true }],

      // `== null` 同时覆盖 null/undefined，是约定写法
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      'prefer-const': 'error',
      'no-var': 'error',

      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // 存量代码仍在用 any / Function / require，先不阻断，逐步收敛
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-expressions': ['error', {
        allowShortCircuit: true,
        allowTernary: true,
        allowTaggedTemplates: true,
      }],

      // Express 类型增强必须用 declare global { namespace Express {} }
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],

      // ban-ts-comment：ts-ignore 必须写明原因，避免无声忽略类型错误
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': 'allow-with-description' }],
    },
  },
  // Vue SFC：只启用 correctness 规则（essential），排版类规则交给编辑器
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      // 与服务端保持同一套风格约定
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      '@typescript-eslint/no-explicit-any': 'off',

      // 组件文件名是本仓库既有风格（如 Dashboard.vue），不做强制
      'vue/multi-word-component-names': 'off',
      // <script setup> 的未使用变量交给 TS 规则统一判定
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-undef': 'off', // 模板里的全局变量由 Vue 编译器处理
    },
  },
  {
    // CommonJS Worker 脚本（.cjs）
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'readonly', exports: 'readonly', __dirname: 'readonly', process: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Vue SFC 类型声明用 {} 是官方写法
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
)
