/**
 * Logo de ToDoApp: tres columnas de tablero que se van vaciando y un tilde de "hecho".
 * Sin hooks ni clases para poder usarlo también en los íconos generados (next/og).
 * El mismo dibujo está en src/app/icon.svg (favicon).
 */
export const LOGO_COLORS = { from: "#3b82f6", to: "#4f46e5" };

type Props = {
  size?: number;
  className?: string;
  /** Sin esquinas redondeadas (ícono de iOS, que las redondea solo). */
  square?: boolean;
  /** Solo el dibujo, sin el fondo (íconos "maskable", que llevan el fondo aparte). */
  bare?: boolean;
};

export function Logo({ size, className, square, bare }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="ToDoApp"
    >
      <defs>
        <linearGradient id="todoapp-logo-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={LOGO_COLORS.from} />
          <stop offset="1" stopColor={LOGO_COLORS.to} />
        </linearGradient>
      </defs>
      {bare ? null : <rect width="64" height="64" rx={square ? 0 : 15} fill="url(#todoapp-logo-bg)" />}
      <rect x="10.5" y="11.5" width="11" height="30" rx="3.5" fill="#fff" />
      <rect x="25" y="11.5" width="11" height="21" rx="3.5" fill="#fff" fillOpacity="0.75" />
      <rect x="39.5" y="11.5" width="11" height="12" rx="3.5" fill="#fff" fillOpacity="0.5" />
      <circle cx="43" cy="42" r="11" fill="#fff" />
      <path
        d="M38 42.3l3.4 3.4 6.6-7"
        fill="none"
        stroke="#4338ca"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
