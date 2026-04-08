import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#101827",
        mist: "#f5f0e8",
        clay: "#d17c43",
        pine: "#0f766e",
        sand: "#f4e7d6",
      },
      boxShadow: {
        panel: "0 20px 60px rgba(16, 24, 39, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;

