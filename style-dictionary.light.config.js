// vF9 — light theme tokens. Same --ollamas-color-* names as the dark base, but
// scoped under [data-theme="light"] so they override :root only when the toggle
// flips. Source is tokens-light/ (separate from tokens/ to avoid key collision
// with the dark base). Only colors flip; font/radius/space stay shared (dark config).
export default {
  source: ['tokens-light/**/*.json'],
  platforms: {
    css: {
      transformGroup: 'css',
      prefix: 'ollamas',
      buildPath: 'src/styles/',
      files: [
        {
          destination: 'tokens-light.css',
          format: 'css/variables',
          options: { outputReferences: true, selector: '[data-theme="light"]' },
        },
      ],
    },
  },
};
