import React, { useEffect, useState } from 'react';
import { CineHDWordmark } from './brand/CineHDWordmark';
import { Ring } from './ui/loading/ring';
import { TextDots } from './ui/loading/text-dots';

interface CineHDLoadingScreenProps {
  ready?: boolean;
  progress?: number | null;
  caption?: string;
}

const CineHDLoadingScreen: React.FC<CineHDLoadingScreenProps> = ({
  ready = false,
  progress = null,
  caption = 'Loading',
}) => {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (ready) setExiting(true);
  }, [ready]);

  const hasProgress = typeof progress === "number" && Number.isFinite(progress);
  const safeProgress = hasProgress ? Math.max(0, Math.min(100, Number(progress))) : null;

  return (
    <div
      aria-live="polite"
      aria-busy={!ready}
      role="status"
      className="fixed inset-0 z-[99999] flex flex-col items-center justify-center overflow-hidden bg-black"
      style={{
        opacity: exiting ? 0 : 1,
        transform: exiting ? 'scale(1.02)' : 'scale(1)',
        pointerEvents: exiting ? 'none' : 'auto',
        transition: 'opacity 420ms cubic-bezier(0.16, 1, 0.3, 1), transform 420ms cubic-bezier(0.16, 1, 0.3, 1)',
        willChange: 'transform, opacity',
      }}
    >
      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <CineHDWordmark className="h-[72px] w-auto md:h-[96px]" />
        <TextDots className="mt-7 text-xs text-ink-muted">
          {caption}
        </TextDots>
      </div>

      <div className="relative z-10 mt-10 flex h-5 w-[min(66vw,300px)] items-center justify-center">
        {safeProgress === null ? (
          <Ring className="h-4 w-4 text-ink-faint" aria-hidden="true" />
        ) : (
          <div className="h-0.5 w-full overflow-hidden rounded-full bg-rule">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${safeProgress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default CineHDLoadingScreen;
