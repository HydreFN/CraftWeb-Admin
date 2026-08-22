import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@prospection/core",
    "@prospection/discovery",
    "@prospection/channels",
    "@prospection/ai",
  ],
  serverExternalPackages: ["pg", "pino"],
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    // Les packages du monorepo utilisent des imports ESM explicites (".js")
    // pointant vers des sources TypeScript.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
