import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // App autenticada y en tiempo real: todo se renderiza por request, sin Cache Components.
  // Imagen de producción mínima: server.js + dependencias trazadas.
  output: "standalone",
  serverExternalPackages: ["pg"],
  // El service worker se revalida siempre, para que las actualizaciones lleguen enseguida.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
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
