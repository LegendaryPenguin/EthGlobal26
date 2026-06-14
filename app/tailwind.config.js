import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  // Match the existing dark theming (some apps toggle html[data-theme="dark"]).
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // CRITICAL: preflight OFF so Tailwind's CSS reset does not clobber the existing
  // hand-written styles. We only want utility classes available for new components.
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [tailwindcssAnimate],
};
