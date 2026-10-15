import React, { useEffect, useRef, useState } from 'react';

interface HomeBackgroundProps {
  images: readonly string[];
  activeIndex: number;
  className?: string;
}

/**
 * Fixed background layer that crossfades between a set of images as the user
 * scrolls. The images stay subtle by way of an overlay, so the foreground
 * content remains readable.
 */
export const HomeBackground: React.FC<HomeBackgroundProps> = ({ images, activeIndex, className }) => {
  const [displayed, setDisplayed] = useState(() => Math.max(0, Math.min(activeIndex, Math.max(images.length - 1, 0))));
  const [previous, setPrevious] = useState<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
  }, []);

  useEffect(() => {
    if (!images.length) return;
    const safeIndex = Math.max(0, Math.min(activeIndex, images.length - 1));
    if (safeIndex === displayed) return;

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    setPrevious(displayed);
    setDisplayed(safeIndex);

    if (reducedMotionRef.current) {
      setPrevious(null);
      return;
    }

    timeoutRef.current = window.setTimeout(() => {
      setPrevious(null);
      timeoutRef.current = null;
    }, 700);
  }, [activeIndex, displayed, images.length]);

  if (!images.length) return null;

  const transition = reducedMotionRef.current ? 'none' : 'opacity 700ms ease-in-out';

  return (
    <div className={`fixed inset-0 z-0 pointer-events-none overflow-hidden ${className ?? ''}`}>
      {previous !== null && (
        <div
          key={`previous-${previous}`}
          aria-hidden="true"
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${images[previous] ?? images[0] ?? ''}")`, opacity: 0, transition }}
        />
      )}
      <div
        key={`active-${displayed}`}
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url("${images[displayed] ?? images[0] ?? ''}")`, opacity: 1, transition }}
      />
      <div className="absolute inset-0 bg-transparent" />
    </div>
  );
};

export default HomeBackground;
