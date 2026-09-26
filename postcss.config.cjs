/**
 * The interface size setting scales the root font size, so every length has
 * to be in rem to follow it. Tailwind classes like text-[10px] and w-[240px]
 * are written in px, so they are converted here against the 14px Normal root.
 *
 * Left alone: 1px lines (hairline borders and dividers stay crisp), media
 * queries (breakpoints follow the window, not the text size), the root size
 * rules themselves, and third-party CSS such as xterm's, which measures in px.
 */
module.exports = {
  plugins: {
    "postcss-pxtorem": {
      rootValue: 14,
      unitPrecision: 5,
      propList: ["*"],
      selectorBlackList: [/^html(\.|$)/, /^:root/],
      replace: true,
      mediaQuery: false,
      minPixelValue: 2,
      exclude: /node_modules/i,
    },
  },
};
