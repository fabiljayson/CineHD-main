import { useEffect, useState } from 'react';

/**
 * Returns the index of the active background image based on how far the
 * user has scrolled down the page. Each scroll of roughly one viewport
 * height advances to the next image, and the sequence then loops back.
 */
export function useScrollBackground(imageCount: number): number {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (imageCount <= 0) return;

    let frameId = 0;
    let scrollPos = 0;

    const update = () => {
      scrollPos = window.scrollY;
      const base = Math.max(320, window.innerHeight * 0.75);
      const stage = Math.floor(scrollPos / base);
      const next = ((stage % imageCount) + imageCount) % imageCount;
      setActiveIndex((previous) => (previous === next ? previous : next));
    };

    const onScroll = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        update();
      });
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [imageCount]);

  return activeIndex;
}
