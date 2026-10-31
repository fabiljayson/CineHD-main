import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

interface LandingBackgroundProps {
  images: readonly string[];
  /** Délai entre deux images, en millisecondes. */
  intervalMs?: number;
  className?: string;
}

/** Amplitude du glissement latéral, en pourcentage de la largeur. */
const SLIDE_PERCENT = 4;
/** Durée du glissement / fondu entre deux images, en secondes. */
const TRANSITION_S = 1.4;
/** Marge de sécurité : l'image est légèrement surdimensionnée pour que le
 *  glissement ne découvre jamais les bords (sinon une bande noire apparaît). */
const OVERSCAN_SCALE = 1.12;
/** Dérive lente pendant que l'image est affichée. */
const DRIFT_S = 16;

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Fond animé de la page d'accueil publique.
 *
 * Les images glissent horizontalement et se croisent en fondu, avec une dérive
 * très lente pendant l'affichage. La couche est purement décorative
 * (`aria-hidden`, `pointer-events-none`) et un voile noir plat la recouvre pour
 * garder le texte blanc lisible et l'identité « true black » de la page.
 *
 * `prefers-reduced-motion` : plus de glissement ni de dérive, simple fondu.
 */
export const LandingBackground: React.FC<LandingBackgroundProps> = ({
  images,
  intervalMs = 10000,
  className,
}) => {
  const reduceMotion = useReducedMotion();
  const [state, setState] = useState<{ current: number; previous: number | null }>({
    current: 0,
    previous: null,
  });
  const currentIndex = state.current;
  const timeoutRef = useRef<number | null>(null);
  // La première image est peinte immédiatement : une entrée en fondu depuis
  // `opacity: 0` laisserait un écran noir au premier rendu (et sur toute
  // capture prise avant la fin de l'animation). Les suivantes glissent.
  const isFirstRenderRef = useRef(true);

  // Rotation automatique. Le minuteur est remis à zéro à chaque image ; on ne
  // change rien quand l'onglet est masqué, pour ne pas empiler les transitions
  // au retour.
  useEffect(() => {
    if (images.length < 2) return;

    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setState((previousState) => ({
        current: (previousState.current + 1) % images.length,
        previous: previousState.current,
      }));
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [images.length, intervalMs]);

  // L'ancienne image reste montée le temps de la transition, puis disparaît.
  useEffect(() => {
    if (state.previous === null) return;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setState((previousState) => ({ ...previousState, previous: null }));
      timeoutRef.current = null;
    }, TRANSITION_S * 1000 + 120);

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [state.previous]);

  // Précharge l'image suivante pendant que la courante est affichée.
  useEffect(() => {
    if (images.length < 2) return;
    const next = images[(currentIndex + 1) % images.length];
    if (!next) return;
    const preload = new Image();
    preload.src = next;
  }, [images, currentIndex]);

  // Après le premier rendu, les changements d'image sont animés.
  useEffect(() => {
    isFirstRenderRef.current = false;
  }, []);

  if (!images.length) return null;

  const currentImage = images[currentIndex];
  const previousImage = state.previous === null ? null : images[state.previous];

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-0 overflow-hidden bg-ground ${className ?? ''}`}
    >
      {previousImage ? (
        <motion.div
          key={`out-${state.previous}`}
          className="absolute inset-0 will-change-transform"
          initial={{ opacity: 1, x: 0 }}
          animate={{ opacity: 0, x: `${-SLIDE_PERCENT}%` }}
          transition={{ duration: TRANSITION_S, ease: EASE }}
        >
          <img
            src={previousImage}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ transform: `scale(${OVERSCAN_SCALE})` }}
          />
        </motion.div>
      ) : null}

      <motion.div
        key={`in-${currentIndex}`}
        className="absolute inset-0 will-change-transform"
        initial={
          isFirstRenderRef.current
            ? false
            : reduceMotion
              ? { opacity: 0 }
              : { opacity: 0, x: `${SLIDE_PERCENT}%` }
        }
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: TRANSITION_S, ease: EASE }}
      >
        <motion.img
          src={currentImage}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
          initial={{ scale: OVERSCAN_SCALE }}
          animate={reduceMotion ? undefined : { scale: [OVERSCAN_SCALE, OVERSCAN_SCALE + 0.06] }}
          transition={reduceMotion ? undefined : { duration: DRIFT_S, repeat: Infinity, repeatType: 'reverse', ease: 'linear' }}
        />
      </motion.div>

      {/* Voile plat : garde le texte lisible sans laver l'image en dégradé. */}
      <div className="absolute inset-0 bg-black/65" />
    </div>
  );
};

export default LandingBackground;
