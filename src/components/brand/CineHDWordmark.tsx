import type { SVGProps } from 'react';

/**
 * Lockup CineHD : triangle doré, CINE argent, HD or. Fond transparent —
 * se pose sur les surfaces sombres de l'app. La police Archivo Black est
 * chargée globalement depuis main.tsx.
 */
export function CineHDWordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 495 222" role="img" aria-label="CineHD" {...props}>
      <path
        d="M 218 28 L 218 96 L 280 62 Z"
        fill="none"
        stroke="#C89028"
        strokeWidth="9"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <text
        x="247"
        y="192"
        textAnchor="middle"
        fontFamily="'Archivo Black', 'Arial Black', sans-serif"
        fontSize="86"
        letterSpacing="1"
      >
        <tspan fill="#E1E1E1">CINE</tspan>
        <tspan fill="#C89028" dx="14">HD</tspan>
      </text>
    </svg>
  );
}
