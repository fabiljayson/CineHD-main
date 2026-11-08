import React from "react";
import { Audio } from "@remotion/media";
import {
  AbsoluteFill,
  Composition,
  Easing,
  Sequence,
  interpolate,
  staticFile,
} from "remotion";
import { BrandReveal } from "./scenes/BrandReveal";
import { CatalogScene } from "./scenes/CatalogScene";
import { ClosingScene } from "./scenes/ClosingScene";
import { HomeScene } from "./scenes/HomeScene";
import { LandingScene } from "./scenes/LandingScene";
import { PricingScene } from "./scenes/PricingScene";
import { BLACK } from "./videoStyle";

type CineHDLaunchProps = {
  musicSrc: string | null;
};

export const CineHDLaunch: React.FC<CineHDLaunchProps> = ({ musicSrc }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: BLACK }}>
      <Sequence durationInFrames={75} name="01 · Allumage">
        <BrandReveal />
      </Sequence>
      <Sequence from={75} durationInFrames={120} name="02 · Page d’accueil">
        <LandingScene />
      </Sequence>
      <Sequence from={195} durationInFrames={120} name="03 · Catalogue">
        <HomeScene />
      </Sequence>
      <Sequence from={315} durationInFrames={120} name="04 · Films / séries / anime">
        <CatalogScene />
      </Sequence>
      <Sequence from={435} durationInFrames={190} name="05 · Tarifs en FCFA">
        <PricingScene />
      </Sequence>
      <Sequence from={625} durationInFrames={108} name="06 · Signature">
        <ClosingScene />
      </Sequence>
      {musicSrc ? (
        <Audio
          src={staticFile(musicSrc)}
          volume={(audioFrame) =>
            interpolate(audioFrame, [0, 5, 705, 732], [0, 0.9, 0.9, 0], {
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })
          }
        />
      ) : null}
    </AbsoluteFill>
  );
};

export const MyComposition: React.FC = () => (
  <Composition
    id="CineHDLaunch"
    component={CineHDLaunch}
    durationInFrames={733}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{ musicSrc: "assets/launch-groove.mp3" }}
  />
);
