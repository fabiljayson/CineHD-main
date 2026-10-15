import React, { useEffect, useState } from 'react';
import { CineHDWordmark } from './brand/CineHDWordmark';

interface CineHDLoadingScreenProps {
  ready?: boolean;
  progress?: number | null;
  caption?: string;
}

const NOISE_URI =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIj48ZmlsdGVyIGlkPSJuIj48ZmVUdXJidWxlbmNlIHR5cGU9ImZyYWN0YWxOb2lzZSIgYmFzZUZyZXF1ZW5jeT0iMC45IiBudW1PY3RhdmVzPSIzIiBzdGl0Y2hUaWxlcz0ic3RpdGNoIi8+PC9maWx0ZXI+PHJlY3Qgd2lkdGg9IjIwMCIgaGVpZ2h0PSIyMDAiIGZpbHRlcj0idXJsKCNuKSIgb3BhY2l0eT0iMSIvPjwvc3ZnPg==';

const CineHDLoadingScreen: React.FC<CineHDLoadingScreenProps> = ({
  ready = false,
  progress = null,
  caption = 'ESTABLISHING PRIVATE FEED • INITIALIZING STREAM',
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
      className="fixed inset-0 z-[99999] flex flex-col items-center justify-center overflow-hidden bg-[#030303]"
      style={{
        opacity: exiting ? 0 : 1,
        transform: exiting ? 'scale(1.02)' : 'scale(1)',
        pointerEvents: exiting ? 'none' : 'auto',
        transition: 'opacity 420ms cubic-bezier(0.16, 1, 0.3, 1), transform 420ms cubic-bezier(0.16, 1, 0.3, 1)',
        willChange: 'transform, opacity',
      }}
    >
      <style>
        {`
          @keyframes cinehd-anamorphic-beam {
            0% { transform: translate3d(-165%, 0, 0) skewX(-24deg); opacity: 0; }
            14% { opacity: .1; }
            48% { opacity: .22; }
            84% { opacity: .1; }
            100% { transform: translate3d(275%, 0, 0) skewX(-24deg); opacity: 0; }
          }

          @keyframes cinehd-logo-materialize {
            0% { opacity: 0; transform: translate3d(0, 12px, 0) scale(.96); filter: blur(8px) brightness(.6); }
            42% { opacity: .82; transform: translate3d(0, 3px, 0) scale(.992); filter: blur(2px) brightness(1.05); }
            100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); filter: blur(0) brightness(1); }
          }

          @keyframes cinehd-progress-sweep {
            0% { transform: translate3d(-105%, 0, 0); }
            100% { transform: translate3d(260%, 0, 0); }
          }

          .cinehd-dc-beam {
            animation: cinehd-anamorphic-beam 3.15s cubic-bezier(0.4, 0, 0.2, 1) infinite;
            will-change: transform, opacity;
          }

          .cinehd-dc-logo {
            animation: cinehd-logo-materialize 1.25s cubic-bezier(0.16, 1, 0.3, 1) both;
            will-change: transform, opacity, filter;
          }

          .cinehd-dc-progress--indeterminate::after {
            content: '';
            position: absolute;
            inset: 0;
            width: 34%;
            border-radius: 999px;
            background: linear-gradient(90deg, transparent, rgba(217,164,65,.2), rgba(217,164,65,.98), rgba(217,164,65,1), rgba(217,164,65,.98), rgba(217,164,65,.2), transparent);
            box-shadow: 0 0 18px rgba(217,164,65,.35);
            animation: cinehd-progress-sweep 1.28s cubic-bezier(0.4, 0, 0.2, 1) infinite;
          }

          @media (prefers-reduced-motion: reduce) {
            .cinehd-dc-beam,
            .cinehd-dc-logo,
            .cinehd-dc-progress--indeterminate::after {
              animation: none !important;
            }
          }
        `}
      </style>

      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(217,164,65,.045)_0%,transparent_42%),radial-gradient(ellipse_at_center,transparent_48%,rgba(0,0,0,.9)_100%)]" />
        <div
          aria-hidden="true"
          className="cinehd-dc-beam absolute inset-y-0 left-0 w-[18%] bg-gradient-to-r from-transparent via-[#D9A441]/12 to-transparent blur-3xl"
          style={{ boxShadow: '0 0 70px rgba(217,164,65,.12)' }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.03] mix-blend-screen"
          style={{ backgroundImage: `url("${NOISE_URI}")`, backgroundSize: '200px 200px' }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <CineHDWordmark className="cinehd-dc-logo h-[78px] w-auto md:h-[112px] [filter:drop-shadow(0_0_18px_rgba(217,164,65,.08))] [image-rendering:auto]" />
        <p
          className="mt-7 text-[10px] font-semibold uppercase text-[#746f66] md:text-xs"
          style={{ letterSpacing: '.34em' }}
        >
          {caption}
        </p>
      </div>

      <div className="relative z-10 mt-11 w-[min(66vw,300px)]">
        <div className="h-px overflow-hidden rounded-full bg-[#1a1a1a] shadow-[0_0_0_1px_rgba(255,255,255,.035)]">
          <div
            className={`relative h-full rounded-full bg-gradient-to-r from-[#A87820] via-[#D9A441] to-[#E9BF6D] ${
              safeProgress === null ? 'cinehd-dc-progress--indeterminate w-[34%]' : 'w-full transition-[width] duration-300'
            }`}
            style={safeProgress === null ? undefined : { width: `${safeProgress}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default CineHDLoadingScreen;
