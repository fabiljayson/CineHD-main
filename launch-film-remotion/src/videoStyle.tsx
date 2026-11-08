import React from "react";
import { AbsoluteFill, staticFile } from "remotion";

export const GOLD = "#C89028";
export const WHITE = "#E1E1E1";
export const MUTED = "#9A9A9A";
export const BLACK = "#060606";

const fontStyles = `
  @font-face {
    font-family: "Archivo Black";
    src: url("${staticFile("assets/fonts/archivo-black.woff2")}") format("woff2");
    font-weight: 400;
    font-display: block;
  }
  @font-face {
    font-family: "Inter";
    src: url("${staticFile("assets/fonts/inter-regular.woff2")}") format("woff2");
    font-weight: 400;
    font-display: block;
  }
  @font-face {
    font-family: "Inter";
    src: url("${staticFile("assets/fonts/inter-semibold.woff2")}") format("woff2");
    font-weight: 600;
    font-display: block;
  }
`;

export const CineHDLogo: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 495 222" role="img" aria-label="CineHD" {...props}>
    <path
      d="M 218 28 L 218 96 L 280 62 Z"
      fill="none"
      stroke={GOLD}
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
      <tspan fill={WHITE}>CINE</tspan>
      <tspan fill={GOLD} dx="14">
        HD
      </tspan>
    </text>
  </svg>
);

export const SceneFrame: React.FC<React.PropsWithChildren> = ({ children }) => (
  <AbsoluteFill
    style={{
      backgroundColor: BLACK,
      color: WHITE,
      fontFamily: "Inter, sans-serif",
      overflow: "hidden",
    }}
  >
    <style>{fontStyles}</style>
    {children}
  </AbsoluteFill>
);
