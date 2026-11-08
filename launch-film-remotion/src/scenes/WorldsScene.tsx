import React from "react";
import {
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { GOLD, MUTED, WHITE, SceneFrame } from "../videoStyle";

export const WorldsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const categories = ["Films", "Séries", "Anime"];

  return (
    <SceneFrame>
      <div
        style={{
          position: "absolute",
          top: 170,
          left: 140,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "0.22em",
          color: GOLD,
          textTransform: "uppercase",
          opacity: interpolate(frame, [0, 14], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Tes envies, ton prochain choix
      </div>
      <div
        style={{
          position: "absolute",
          left: 128,
          right: 128,
          top: 335,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        {categories.map((category, index) => {
          const start = index * 13;

          return (
            <div
              key={category}
              style={{
                fontFamily: "Archivo Black, sans-serif",
                fontSize: 94,
                letterSpacing: "-0.045em",
                opacity: interpolate(frame, [start, start + 18], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
                translate: `0 ${interpolate(frame, [start, start + 18], [34, 0], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                })}px`,
                color: index === 1 ? GOLD : WHITE,
              }}
            >
              {category}
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          left: 140,
          bottom: 220,
          height: 2,
          width: interpolate(frame, [18, 68], [0, 1640], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.65, 0, 0.35, 1),
          }),
          background: `linear-gradient(90deg, ${GOLD}, rgba(200, 144, 40, 0.05))`,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 145,
          left: 140,
          fontSize: 28,
          color: MUTED,
          opacity: interpolate(frame, [fps * 1.7, fps * 2.3], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Explore un catalogue pensé pour tes envies.
      </div>
    </SceneFrame>
  );
};
