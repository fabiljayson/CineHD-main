import React, { useEffect, useRef, useState } from 'react';

/* ============================================================
   CINE HD — GOLDEN PLAY
   Écran de chargement cinématique dont le héros est le symbole
   Play doré du lockup. La géométrie est celle de
   `brand/CineHDWordmark` (triangle + Archivo Black) : le logo
   n'est pas redessiné, il est éclairé.

   Chronologie (3,5 s) :
     0.0 – 0.6   obscurité, très faible lueur sur le triangle
     0.6 – 1.6   un fin trait trace le contour, impulsion qui
                 suit la tête du tracé
     1.6 – 2.4   faisceau projeté, puis CINE et enfin HD
     2.4 – 3.5   le lockup se pose, un reflet d'or le traverse
     3.5 +       état de chargement calme : ligne + légende

   Seuls les éléments d'attente bouclent — l'intro ne se rejoue
   jamais. La sortie appartient à l'application : `ready` lance
   une dissolution dorée, puis `onExitComplete` démonte l'écran.
   L'intro n'est donc jamais bloquante.
   ============================================================ */

/** Contour du Play — identique à CineHDWordmark. */
const TRIANGLE_PATH = 'M 218 28 L 218 96 L 280 62 Z';

/**
 * Durée minimale d'affichage. Le symbole n'est révélé qu'à ~2,2 s : une
 * attente plus courte couperait l'intro avant que CINE/HD n'apparaissent.
 * L'application garde la main sur la sortie — on ne dépasse jamais ce seuil.
 */
const MIN_HOLD_MS = 2400;

/** Durée de la dissolution vers l'accueil. */
const EXIT_MS = 640;

type Phase = 'intro' | 'exiting';

interface CineHDLoadingScreenProps {
  /** L'application est prête : l'écran se dissout vers l'accueil. */
  ready?: boolean;
  /** Progression réelle 0-100. `null` → barre indéterminée. */
  progress?: number | null;
  caption?: string;
  /** Appelé une fois la dissolution terminée, pour démonter l'écran. */
  onExitComplete?: () => void;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    sync();
    // `addListener` reste nécessaire sous les vieilles WebView ciblées par
    // le bundle legacy ; on préfère l'API standard quand elle existe.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', sync);
      return () => query.removeEventListener('change', sync);
    }
    query.addListener(sync);
    return () => query.removeListener(sync);
  }, []);

  return reduced;
}

const CineHDLoadingScreen: React.FC<CineHDLoadingScreenProps> = ({
  ready = false,
  progress = null,
  caption = 'Loading',
  onExitComplete,
}) => {
  const [phase, setPhase] = useState<Phase>('intro');
  const [paused, setPaused] = useState(false);
  const reduced = usePrefersReducedMotion();

  const mountedAt = useRef(Date.now());
  const onExitCompleteRef = useRef(onExitComplete);
  onExitCompleteRef.current = onExitComplete;

  // L'application pilote la sortie : dès `ready`, on laisse au plus
  // MIN_HOLD_MS avant de commencer la dissolution (jamais l'inverse).
  useEffect(() => {
    if (!ready) {
      // Un nouveau cycle de chargement annule une sortie commencée.
      setPhase((current) => (current === 'exiting' ? 'intro' : current));
      return;
    }

    const wait = Math.max(0, MIN_HOLD_MS - (Date.now() - mountedAt.current));
    const timer = window.setTimeout(() => setPhase('exiting'), wait);
    return () => window.clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    if (phase !== 'exiting') return;
    const timer = window.setTimeout(() => onExitCompleteRef.current?.(), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // Les CSS animations continuent de tourner dans un onglet masqué :
  // on les fige plutôt que de laisser l'intro se jouer pour rien.
  useEffect(() => {
    const sync = () => setPaused(document.visibilityState === 'hidden');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  const hasProgress = typeof progress === 'number' && Number.isFinite(progress);
  const safeProgress = hasProgress ? Math.max(0, Math.min(100, Number(progress))) : null;
  const determinate = safeProgress !== null;

  const rootClass = [
    'cgp-root',
    phase === 'exiting' ? 'cgp-exit' : '',
    reduced ? 'cgp-reduced' : '',
    paused ? 'cgp-paused' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass} role="status" aria-live="polite" aria-busy={phase === 'intro'}>
      <div className="cgp-vignette" aria-hidden="true" />

      <div className="cgp-stage">
        <svg className="cgp-mark" viewBox="0 0 495 222" role="img" aria-label="CineHD">
          <defs>
            <radialGradient id="cgp-haze-grad">
              <stop offset="0%" stopColor="#D6AD55" stopOpacity="0.3" />
              <stop offset="45%" stopColor="#8D692B" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#8D692B" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="cgp-beam-grad">
              <stop offset="0%" stopColor="#F5F3EF" stopOpacity="0.2" />
              <stop offset="45%" stopColor="#D6AD55" stopOpacity="0.13" />
              <stop offset="100%" stopColor="#8D692B" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="cgp-flash-grad">
              <stop offset="0%" stopColor="#F5F3EF" stopOpacity="0.68" />
              <stop offset="40%" stopColor="#D6AD55" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#8D692B" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="cgp-sheen-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#D6AD55" stopOpacity="0" />
              <stop offset="40%" stopColor="#F5F3EF" stopOpacity="0.9" />
              <stop offset="55%" stopColor="#D6AD55" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#D6AD55" stopOpacity="0" />
            </linearGradient>
            {/* Le reflet ne doit peindre que le trait du triangle : le masque
                reprend le tracé exact du symbole. */}
            <mask
              id="cgp-triangle-mask"
              maskUnits="userSpaceOnUse"
              x="-400"
              y="-120"
              width="1300"
              height="460"
            >
              <path
                d={TRIANGLE_PATH}
                fill="none"
                stroke="#ffffff"
                strokeWidth="9"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </mask>
          </defs>

          {/* Lumière : halo ambiant, faisceau projeté, impulsion du symbole. */}
          <ellipse
            className="cgp-haze"
            cx="247.5"
            cy="62"
            rx="176"
            ry="132"
            fill="url(#cgp-haze-grad)"
          />
          <ellipse
            className="cgp-beam"
            cx="247.5"
            cy="62"
            rx="400"
            ry="42"
            fill="url(#cgp-beam-grad)"
          />
          <ellipse
            className="cgp-flash"
            cx="247.5"
            cy="62"
            rx="96"
            ry="78"
            fill="url(#cgp-flash-grad)"
          />

          <g className="cgp-lockup">
            {/* L'outline à peine visible dans le noir (0 – 0.6 s). */}
            <path
              className="cgp-tri-ghost"
              d={TRIANGLE_PATH}
              fill="none"
              stroke="#8D692B"
              strokeWidth="9"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {/* Le trait fin qui trace la géométrie (0.6 – 1.6 s). */}
            <path
              className="cgp-tri-trace"
              d={TRIANGLE_PATH}
              pathLength={1}
              fill="none"
              stroke="#D6AD55"
              strokeWidth="3.2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {/* L'impulsion lumineuse qui suit la tête du tracé. */}
            <path
              className="cgp-tri-pulse"
              d={TRIANGLE_PATH}
              pathLength={1}
              fill="none"
              stroke="#F5F3EF"
              strokeWidth="4.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="0.16 0.84"
            />
            {/* Le vrai trait du logo + le reflet doré, bornés au tracé. */}
            <g mask="url(#cgp-triangle-mask)">
              <path
                className="cgp-tri-final"
                d={TRIANGLE_PATH}
                fill="none"
                stroke="#C89028"
                strokeWidth="9"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <rect
                className="cgp-tri-sheen"
                x="170"
                y="6"
                width="110"
                height="112"
                fill="url(#cgp-sheen-grad)"
              />
            </g>

            {/* Deux <text> superposés : la largeur d'avance est identique,
                donc CINE et HD restent centrés au pixel près tout en se
                révélant l'un après l'autre (d'abord CINE, puis l'HD qui
                s'allume en or). */}
            <text
              className="cgp-word cgp-word-cine"
              x="247"
              y="192"
              textAnchor="middle"
              fontFamily="'Archivo Black', 'Arial Black', sans-serif"
              fontSize="86"
              letterSpacing="1"
            >
              <tspan fill="#E1E1E1">CINE</tspan>
              <tspan dx="14" fillOpacity="0">
                HD
              </tspan>
            </text>
            <text
              className="cgp-word cgp-word-hd"
              x="247"
              y="192"
              textAnchor="middle"
              fontFamily="'Archivo Black', 'Arial Black', sans-serif"
              fontSize="86"
              letterSpacing="1"
            >
              <tspan fillOpacity="0">CINE</tspan>
              <tspan dx="14">HD</tspan>
            </text>
          </g>
        </svg>

        <div
          className="cgp-progress"
          role={determinate ? 'progressbar' : undefined}
          aria-hidden={determinate ? undefined : true}
          aria-valuemin={determinate ? 0 : undefined}
          aria-valuemax={determinate ? 100 : undefined}
          aria-valuenow={determinate ? Math.round(safeProgress ?? 0) : undefined}
          aria-label={determinate ? caption : undefined}
        >
          <div className="cgp-progress-track">
            {determinate ? (
              <div className="cgp-progress-fill" style={{ width: `${safeProgress}%` }} />
            ) : (
              !reduced && <div className="cgp-progress-indet" />
            )}
          </div>
        </div>

        <p className="cgp-caption">{caption}</p>
      </div>
    </div>
  );
};

export default CineHDLoadingScreen;
