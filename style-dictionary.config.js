// vF5 — Design tokens (adopted from style-dictionary, Apache-2.0).
// JSON is the single source of truth; this compiles --ollamas-* CSS variables
// that Tailwind v4 @theme consumes (src/index.css). A native app or Figma sync
// can read the same tokens/*.json layer later (vF9 theming).
export default {
  source: ['tokens/**/*.json'],
  platforms: {
    css: {
      transformGroup: 'css',
      prefix: 'ollamas',
      buildPath: 'src/styles/',
      files: [
        {
          destination: 'tokens.css',
          format: 'css/variables',
          options: { outputReferences: true },
        },
      ],
    },
  },
};
