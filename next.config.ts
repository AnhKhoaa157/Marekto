import type { NextConfig } from "next";

// next.config.ts
const nextConfig = {
  experimental: {
    instrumentationHook: true,
  },
};
export default nextConfig;
