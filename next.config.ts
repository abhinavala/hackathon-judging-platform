import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Pin the project root: there are unrelated lockfiles further up the tree.
  outputFileTracingRoot: import.meta.dirname,
  // Loaded by Node at runtime, not bundled: bundling nodemailer merged it
  // with lib/server-env and mixed up their exports (siteUrl() came back
  // undefined on /t/[code]).
  serverExternalPackages: ["nodemailer"],
  turbopack: {
    root: import.meta.dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
