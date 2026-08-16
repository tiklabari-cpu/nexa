/**
 * Metro's transform for `apps/mobile`.
 *
 * `babel-preset-expo` is the only preset the managed workflow needs: it carries
 * the TypeScript and JSX transforms plus the React Native runtime shims, so the
 * same source compiles for Metro (`expo export`) and for Jest (`jest-expo`).
 */
module.exports = function babelConfig(api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
