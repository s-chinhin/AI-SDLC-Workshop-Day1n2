import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the Playwright server (scripts/test-server.mjs) run beside `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
