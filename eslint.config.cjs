module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'artifacts/**'] },
  { files: ['src/**/*.{js,cjs}', 'scripts/**/*.cjs', 'tests/**/*.cjs'], languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: Object.fromEntries(['document', 'window', 'navigator', 'location', 'innerWidth', 'innerHeight', 'getComputedStyle', 'console', 'process', 'require', 'module', '__dirname', 'Buffer', 'URL', 'AbortController', 'AbortSignal', 'Response', 'ReadableStream', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'globalThis'].map(name => [name, 'readonly'])) }, rules: { 'no-undef': 'error', 'no-unreachable': 'error', 'no-dupe-keys': 'error', 'no-dupe-args': 'error', 'valid-typeof': 'error' } }
];
