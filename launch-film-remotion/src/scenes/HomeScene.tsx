import React from "react";
import {
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { GOLD, MUTED, SceneFrame, WHITE } from "../videoStyle";

export const HomeScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame>
      <div
        style={{
          position: "absolute",
          top: 50,
          left: 130,
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
        Tout commence par un choix
      </div>
      <div
        style={{
          position: "absolute",
          top: 93,
          left: 130,
          color: WHITE,
          fontFamily: "Archivo Black, sans-serif",
          fontSize: 43,
          letterSpacing: "-0.04em",
          opacity: interpolate(frame, [5, 21], [0, 1], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Un film, une soirée.
      </div>
      <div
        style={{
          position: "absolute",
          left: 130,
          top: 165,
          width: 1660,
          height: 710,
          overflow: "hidden",
          border: "1px solid rgba(225, 225, 225, 0.16)",
          borderRadius: 14,
          opacity: interpolate(frame, [0, 15], [0, 1], {
            extrapolateRight: "clamp",
          }),
          scale: interpolate(frame, [0, 110], [1.045, 1], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <Img
          src={staticFile("assets/screenshots/home-fr.png")}
          alt="Capture réelle du catalogue CineHD"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "top",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          right: 132,
          bottom: 73,
          color: MUTED,
          fontSize: 16,
          letterSpacing: "0.12em",
          opacity: interpolate(frame, [27, 45], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        FILMS · SÉRIES · ANIME
      </div>
    </SceneFrame>
  );
};
