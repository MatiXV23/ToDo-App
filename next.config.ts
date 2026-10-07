import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // App autenticada y en tiempo real: todo se renderiza por request, sin Cache Components.
  serverExternalPackages: ["pg"],
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
