/** ESLint config for shared React component packages. */
module.exports = {
  ...require('./base.js'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  env: { browser: true, node: true, es2022: true },
};
