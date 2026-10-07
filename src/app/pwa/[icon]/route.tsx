import { ImageResponse } from "next/og";
import { LOGO_COLORS, Logo } from "@/components/common/logo";

/**
 * Íconos PNG del manifest, dibujados desde el mismo componente que el logo.
 * "maskable": fondo hasta los bordes y el dibujo dentro de la zona segura (Android lo recorta).
 */
const ICONS: Record<string, { size: number; maskable: boolean }> = {
  "icon-192.png": { size: 192, maskable: false },
  "icon-512.png": { size: 512, maskable: false },
  "maskable-192.png": { size: 192, maskable: true },
  "maskable-512.png": { size: 512, maskable: true },
};

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(ICONS).map((icon) => ({ icon }));
}

export async function GET(_req: Request, { params }: RouteContext<"/pwa/[icon]">) {
  const { size, maskable } = ICONS[(await params).icon];
  return new ImageResponse(
    maskable ? (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundImage: `linear-gradient(135deg, ${LOGO_COLORS.from}, ${LOGO_COLORS.to})`,
        }}
      >
        <Logo size={Math.round(size * 0.72)} bare />
      </div>
    ) : (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <Logo size={size} />
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
