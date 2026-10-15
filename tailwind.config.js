/** @type {import('tailwindcss').Config} */
export default {
  content: ["./BOTINDEXSECURITY.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          gold: "#c89028",
          "gold-bright": "#d9a63a",
          "gold-dark": "#a87820",
          silver: "#e1e1e1",
        },
        nebula: {
          bg: "#131619",
          "bg-soft": "#1d2226",
          text: "#f7f8f9",
          muted: "#888f99",
          blue: "#2cadfe",
          "blue-deep": "#0085ce",
          amber: "#FBB659",
        },
        editorial: {
          paper: "#faf7f2",
          "paper-soft": "#f3ecde",
          ink: "#1a1816",
          "ink-soft": "#4a453f",
          muted: "#8c867c",
          border: "#d4ccc1",
          gold: "#c89028",
          "gold-soft": "#e8d9bd",
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', "Georgia", "serif"],
        body: ['"Inter"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      animation: {
        fadeIn: "fadeIn 0.5s ease-in-out",
        fadeOut: "fadeOut 0.5s ease-in-out",
        "skeleton-fade": "skeletonFade 0.3s ease-out",
        "card-enter": "cardEnter 0.3s ease-out both",
        "ad-content-enter": "adContentEnter 250ms cubic-bezier(0.23, 1, 0.32, 1) both",
        "ad-easter-egg-enter": "adEasterEggEnter 250ms cubic-bezier(0.23, 1, 0.32, 1) both",
        "ad-unlocked-glow": "adUnlockedGlow 650ms cubic-bezier(0.23, 1, 0.32, 1) both",
      },
      keyframes: {
        adContentEnter: {
          from: { opacity: "0", transform: "translateY(3px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        adEasterEggEnter: {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        adUnlockedGlow: {
          "0%": { opacity: "0" },
          "20%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(-20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeOut: {
          "0%": { opacity: "1", transform: "translateY(0)" },
          "100%": { opacity: "0", transform: "translateY(-20px)" },
        },
        skeletonFade: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        cardEnter: {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
