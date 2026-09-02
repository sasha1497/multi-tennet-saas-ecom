/** ESLint config for the NestJS API + worker. */
module.exports = {
  ...require('./base.js'),
  env: { node: true, es2022: true, jest: true },
  rules: {
    ...require('./base.js').rules,
    // Nest relies heavily on decorators + DI; these two are noise there.
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-empty-function': ['warn', { allow: ['constructors'] }],
  },
};
