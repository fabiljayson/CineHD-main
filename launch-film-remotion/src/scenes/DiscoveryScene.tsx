import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { GOLD, MUTED, WHITE, SceneFrame } from "../videoStyle";

export const DiscoveryScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame>
      <div
        style={{
          position: "absolute",
          left: 130,
          top: 215,
          width: 1160,
          fontFamily: "Archivo Black, sans-serif",
          fontSize: 86,
          lineHeight: 1.07,
          letterSpacing: "-0.04em",
          opacity: interpolate(frame, [0, 20, 98], [0, 1, 1], {
            extrapolateRight: "clamp",
          }),
          translate: `0 ${interpolate(frame, [0, 20], [36, 0], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })}px`,
        }}
      >
        <span>Explore.</span>
        <br />
        <span style={{ color: GOLD }}>Cherche.</span>
        <br />
        <span>Choisis.</span>
      </div>
      <div
        style={{
          position: "absolute",
          right: 155,
          top: 330,
          width: 370,
          fontSize: 31,
          lineHeight: 1.45,
          color: MUTED,
          opacity: interpolate(frame, [22, 42], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Films, séries et anime — à toi de choisir quoi regarder.
      </div>
      <div
        style={{
          position: "absolute",
          right: 155,
          top: 555,
          width: interpolate(frame, [35, 76], [0, 390], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.65, 0, 0.35, 1),
          }),
          height: 3,
          backgroundColor: GOLD,
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 155,
          top: 600,
          fontSize: 20,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: WHITE,
          opacity: interpolate(frame, [48, 62], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Découvre CineHD
      </div>
    </SceneFrame>
  );
};
