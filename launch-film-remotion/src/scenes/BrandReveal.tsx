import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CineHDLogo, GOLD, MUTED, SceneFrame } from "../videoStyle";

export const BrandReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <SceneFrame>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 45%, rgba(200, 144, 40, 0.15), transparent 38%)",
          opacity: interpolate(frame, [0, 22, 75], [0, 1, 0.48], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          scale: interpolate(frame, [0, 75], [0.86, 1.12], {
            extrapolateRight: "clamp",
          }),
        }}
      />
      <CineHDLogo
        style={{
          position: "absolute",
          width: 520,
          height: 233,
          left: "50%",
          top: "38%",
          translate: `-50% ${interpolate(frame, [0, 24], [24, 0], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })}px`,
          opacity: interpolate(frame, [0, 24, 85], [0, 1, 1], {
            extrapolateRight: "clamp",
          }),
          scale: interpolate(frame, [0, 28], [0.94, 1], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "66%",
          width: "100%",
          textAlign: "center",
          color: MUTED,
          fontSize: 24,
          letterSpacing: "0.24em",
          textTransform: "uppercase",
          opacity: interpolate(frame, [fps * 1.4, fps * 2.2], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Le cinéma s’allume
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "76%",
          width: interpolate(frame, [0, 48], [0, 280], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.65, 0, 0.35, 1),
          }),
          height: 2,
          translate: "-50% 0",
          backgroundColor: GOLD,
          boxShadow: "0 0 24px rgba(200, 144, 40, 0.55)",
        }}
      />
    </SceneFrame>
  );
};
