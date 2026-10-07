import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { PwaSetup } from "@/components/pwa-setup";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "ToDoApp", template: "%s · ToDoApp" },
  description: "Tablero de tareas liviano para proyectos personales y colaborativos.",
  applicationName: "ToDoApp",
  // Instalada en iOS: pantalla completa, sin la barra de Safari.
  appleWebApp: { capable: true, title: "ToDoApp", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
        <PwaSetup />
      </body>
    </html>
  );
}
