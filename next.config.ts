import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // App autenticada y en tiempo real: todo se renderiza por request, sin Cache Components.
  // Imagen de producción mínima: server.js + dependencias trazadas.
  output: "standalone",
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
