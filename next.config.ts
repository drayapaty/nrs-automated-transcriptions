import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // API-only service — no static assets / images
  reactStrictMode: true,
  // Allow large request bodies for the rare case admin sends inline data
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
