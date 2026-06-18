import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  // The replica runs dark by default via html[data-theme="dark"].
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // CRITICAL: preflight OFF so Tailwind's reset never touches the pixel-accurate
  // MetaMask styles. Only utility classes are added for new components.
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [tailwindcssAnimate],
};
