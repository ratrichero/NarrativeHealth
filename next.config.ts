import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // IMPORTANT: Do NOT enable "output: 'export'" as it will disable API routes
  // Current architecture uses Next.js API routes for data refresh operations
  // FastAPI is configured as backup but Next.js is the primary API server
  
  // If you want to switch to static export (no API routes), you would need to:
  // 1. Enable output: "export" and images: { unoptimized: true }
  // 2. Move all API logic to FastAPI backend
  // 3. Update scheduler to call FastAPI endpoints only
  // 4. Remove Next.js API routes
  
  // Current recommendation: Keep Next.js in server mode with API routes enabled
  // This provides the best balance of performance and feature set
  
  // Disable Turbopack due to stability issues
  experimental: {
    turbo: undefined,
  },
  
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "",
  },
};

export default nextConfig;
