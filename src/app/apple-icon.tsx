import { ImageResponse } from "next/og";
import { Logo } from "@/components/common/logo";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Ícono para la pantalla de inicio de iOS (sin transparencia: iOS redondea las esquinas). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <Logo size={180} square />
      </div>
    ),
    size,
  );
}
