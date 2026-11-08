import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { CineHDLogo, GOLD, SceneFrame } from "../videoStyle";

export const ClosingScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 46%, rgba(200, 144, 40, 0.12), transparent 34%)",
          opacity: interpolate(frame, [0, 45, 80], [0, 1, 0.55], {
            extrapolateRight: "clamp",
          }),
        }}
      />
      <CineHDLogo
        style={{
          position: "absolute",
          width: 440,
          height: 197,
          left: "50%",
          top: 265,
          translate: "-50% 0",
          opacity: interpolate(frame, [0, 22], [0, 1], {
            extrapolateRight: "clamp",
          }),
          scale: interpolate(frame, [0, 24], [0.96, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 540,
          width: "100%",
          textAlign: "center",
          fontFamily: "Archivo Black, sans-serif",
          fontSize: 52,
          letterSpacing: "-0.04em",
          opacity: interpolate(frame, [16, 34], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        À toi de choisir.
      </div>
      <div
        style={{
          position: "absolute",
          top: 650,
          width: "100%",
          textAlign: "center",
          fontSize: 23,
          letterSpacing: "0.18em",
          color: GOLD,
          textTransform: "uppercase",
          opacity: interpolate(frame, [30, 48], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Explore le catalogue
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 715,
          width: interpolate(frame, [24, 50], [0, 370], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.65, 0, 0.35, 1),
          }),
          height: 2,
          translate: "-50% 0",
          backgroundColor: GOLD,
        }}
      />
    </SceneFrame>
  );
};
