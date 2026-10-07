import type { MetadataRoute } from "next";

/** Manifest de la PWA: permite instalar ToDoApp como app en el celular o la compu. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ToDoApp",
    short_name: "ToDoApp",
    description: "Tablero de tareas liviano para proyectos personales y colaborativos.",
    lang: "es",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/pwa/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Buzón", url: "/inbox", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
      { name: "Proyectos", url: "/", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
