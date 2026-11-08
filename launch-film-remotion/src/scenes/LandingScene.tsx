import React from "react";
import {
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { GOLD, SceneFrame, WHITE } from "../videoStyle";

export const LandingScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame>
      <div
        style={{
          position: "absolute",
          top: 44,
          left: 128,
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: GOLD,
          opacity: interpolate(frame, [0, 14], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Le cinéma s’allume
      </div>
      <div
        style={{
          position: "absolute",
          top: 88,
          left: 128,
          fontFamily: "Archivo Black, sans-serif",
          fontSize: 45,
          letterSpacing: "-0.04em",
          color: WHITE,
          opacity: interpolate(frame, [4, 20], [0, 1], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Découvre CineHD
      </div>
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 164,
          width: 1680,
          height: 860,
          border: "1px solid rgba(200, 144, 40, 0.34)",
          borderRadius: 16,
          overflow: "hidden",
          opacity: interpolate(frame, [0, 16], [0, 1], {
            extrapolateRight: "clamp",
          }),
          scale: interpolate(frame, [0, 100], [1.035, 1], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <Img
          src={staticFile("assets/screenshots/landing-fr.png")}
          alt="Capture réelle de la page d’accueil CineHD en français"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 120,
          bottom: 28,
          width: interpolate(frame, [10, 52], [0, 1680], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.65, 0, 0.35, 1),
          }),
          height: 2,
          backgroundColor: GOLD,
        }}
      />
    </SceneFrame>
  );
};
