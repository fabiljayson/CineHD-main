import React, { useEffect, useRef, useState } from 'react';

interface HomeBackgroundProps {
  images: readonly string[];
  activeIndex: number;
  className?: string;
}

/**
 * Fixed background layer behind the home page. Kept as a drop-in for the
 * scroll-driven backdrop wiring (props + useScrollBackground index), but it
 * now renders a flat black ground only: the crossfading image layers, their
 * washes and the vignette overlay are gone.
 */
export const HomeBackground: React.FC<HomeBackgroundProps> = ({ images, activeIndex, className }) => {
  const [displayed, setDisplayed] = useState(() => Math.max(0, Math.min(activeIndex, Math.max(images.length - 1, 0))));
  // États et effets de l'ancien crossfade conservés à l'identique (mêmes appels
  // de hooks, même ordre) : seule la couche d'images rendue a disparu.
  const [_previous, setPrevious] = useState<number | null>(null);
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

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-0 pointer-events-none bg-black ${className ?? ''}`}
    />
  );
};

export default HomeBackground;
