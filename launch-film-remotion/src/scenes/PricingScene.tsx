import React from "react";
import {
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { GOLD, MUTED, SceneFrame, WHITE } from "../videoStyle";

export const PricingScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame>
      <div
        style={{
          position: "absolute",
          top: 54,
          left: 135,
          color: GOLD,
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          opacity: interpolate(frame, [0, 14], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Des formules en FCFA
      </div>
      <div
        style={{
          position: "absolute",
          left: 135,
          top: 100,
          fontFamily: "Archivo Black, sans-serif",
          fontSize: 52,
          letterSpacing: "-0.04em",
          color: WHITE,
          opacity: interpolate(frame, [5, 21], [0, 1], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        La durée qui te convient.
      </div>
      <div
        style={{
          position: "absolute",
          left: 135,
          top: 182,
          color: MUTED,
          fontSize: 20,
          opacity: interpolate(frame, [14, 30], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Les tarifs, directement dans l’application.
      </div>
      <div
        style={{
          position: "absolute",
          left: 242,
          top: 245,
          width: 1436,
          height: 819,
          overflow: "hidden",
          border: "1px solid rgba(200, 144, 40, 0.5)",
          borderRadius: 14,
          opacity: interpolate(frame, [0, 20], [0, 1], {
            extrapolateRight: "clamp",
          }),
          scale: interpolate(frame, [0, 80], [0.98, 1], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <Img
          src={staticFile("assets/screenshots/pricing-xaf.png")}
          alt="Capture réelle des tarifs CineHD en FCFA"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            backgroundColor: "#111",
          }}
        />
      </div>
    </SceneFrame>
  );
};
