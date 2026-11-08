import React from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { GOLD, SceneFrame } from "../videoStyle";

const categories = [
  { src: "films.png", start: 0 },
  { src: "series.png", start: 12 },
  { src: "anime.png", start: 24 },
];

export const CatalogScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame>
      <div
        style={{
          position: "absolute",
          left: 128,
          top: 35,
          color: GOLD,
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          opacity: interpolate(frame, [0, 12], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Trois univers. À toi de choisir.
      </div>
      {categories.map(({ src, start }, index) => (
        <div
          key={src}
          style={{
            position: "absolute",
            left: 128,
            top: 93 + index * 318,
            width: 1664,
            height: 300,
            overflow: "hidden",
            borderRadius: 10,
            border: "1px solid rgba(225, 225, 225, 0.12)",
            opacity: interpolate(frame, [start, start + 18], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: `0 ${interpolate(frame, [start, start + 18], [28, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}px`,
            scale: interpolate(frame, [start, start + 45], [1.04, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          <Img
            src={staticFile(`assets/screenshots/${src}`)}
            alt={`Capture réelle de la rubrique ${src.replace(".png", "")}`}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      ))}
    </SceneFrame>
  );
};
