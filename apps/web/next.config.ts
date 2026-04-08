import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, "../../"),
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
