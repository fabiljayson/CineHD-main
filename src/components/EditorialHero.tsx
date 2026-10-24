import React from 'react';
import { Link } from 'react-router-dom';
import { Play, Info, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { encodeId } from '../utils/idEncoder';

interface Media {
  id: number | string;
  title?: string;
  name?: string;
  poster_path: string;
  backdrop_path: string;
  overview: string;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
  media_type: 'movie' | 'tv';
  genre_ids?: number[];
}

interface EditorialHeroProps {
  items: Media[];
}

const tmdbImage = (path: string, size = 'w1280'): string =>
  path
    ? `https://image.tmdb.org/t/p/${size}${path}`
    : 'https://via.placeholder.com/1280x720/111111/949494?text=CineHD';

const GENRE_MAP: Record<number, string> = {
  28: 'Action', 12: 'Aventure', 16: 'Animation', 35: 'Comédie', 80: 'Crime',
  18: 'Drame', 14: 'Fantastique', 878: 'Sci-Fi', 53: 'Thriller', 10751: 'Famille',
  10402: 'Musique', 9648: 'Mystère', 10749: 'Romance', 27: 'Horreur', 36: 'Histoire', 37: 'Western',
};

export const EditorialHero: React.FC<EditorialHeroProps> = ({ items }) => {
  const { t } = useTranslation();
  const active = items[0];
  if (!active) return null;

  const title = active.title || active.name || '';
  const year = (active.release_date || active.first_air_date || '').slice(0, 4);
  const genres = (active.genre_ids || [])
    .slice(0, 2)
    .map(id => GENRE_MAP[id])
    .filter(Boolean)
    .join(' · ');
  const isTv = active.media_type === 'tv';

  return (
    <section className="relative w-full min-h-[78vh] bg-black overflow-hidden">
      <div className="relative z-10 max-w-7xl mx-auto px-4 md:px-8 lg:px-12 pt-12 md:pt-20 pb-12 md:pb-20 grid grid-cols-1 md:grid-cols-[320px_1fr] gap-8 md:gap-12 items-center">
        {/* Poster — flat plate on the ground */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative"
        >
          <div
            className="relative rounded-lg overflow-hidden bg-surface"
            style={{ aspectRatio: '2 / 3' }}
          >
            <img
              src={tmdbImage(active.poster_path || active.backdrop_path, 'w500')}
              alt={title}
              className="w-full h-full object-cover"
              loading="eager"
              decoding="async"
            />
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-ink-faint tabular-nums">
            <Clock className="w-3 h-3" />
            <span>{year || '—'}</span>
          </div>
        </motion.div>

        {/* Content column */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="min-w-0"
        >
          <div className="flex items-center gap-3 mb-6">
            <span className="h-px flex-1 bg-rule" />
            <span className="text-ink-faint text-xs font-medium">
              {t('home.hero.nowPlaying')}
            </span>
            <span className="h-px flex-1 bg-rule" />
          </div>

          <h1 className="text-5xl md:text-7xl lg:text-8xl font-semibold text-white leading-[0.95] tracking-tight mb-5">
            {title}
          </h1>

          {genres && (
            <p className="text-ink-muted text-sm md:text-base mb-6">
              {year && <span className="tabular-nums">{year}</span>}
              {year && genres && <span className="mx-2">—</span>}
              {genres && <span className="text-ink">{genres}</span>}
            </p>
          )}

          <p className="text-ink-muted text-base md:text-lg leading-relaxed mb-8 max-w-2xl">
            {active.overview || t('home.hero.noOverview')}
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              to={`/watch/movie/${encodeId(active.id)}`}
              state={{ source: 'hero' }}
              className="flex-1 sm:w-auto px-7 py-3.5 bg-white text-black font-medium rounded-full text-base hover:bg-neutral-200 transition-colors flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4" fill="currentColor" />
              {t('home.hero.play')}
            </Link>
            <Link
              to={`/movie/${encodeId(active.id)}`}
              className="flex-1 sm:w-auto px-7 py-3.5 border border-control text-white font-medium rounded-full text-base hover:bg-raised transition-colors flex items-center justify-center gap-2"
            >
              <Info className="w-4 h-4" />
              {t('home.hero.info')}
            </Link>
          </div>
        </motion.div>
      </div>

      {/* Bottom metadata rail — rating is the gold data mark */}
      <div className="relative z-10 max-w-7xl mx-auto px-4 md:px-8 lg:px-12 pb-10">
        <div className="border-t border-rule pt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-ink-faint text-xs mb-1">{t('home.hero.rating')}</div>
            <div className="text-accent text-2xl font-semibold tabular-nums">
              {active.vote_average > 0 ? active.vote_average.toFixed(1) : '—'}
              <span className="text-ink-faint text-xs"> /10</span>
            </div>
          </div>
          <div>
            <div className="text-ink-faint text-xs mb-1">{t('home.hero.release')}</div>
            <div className="text-white text-2xl font-semibold tabular-nums">{year || '—'}</div>
          </div>
          <div>
            <div className="text-ink-faint text-xs mb-1">{t('home.hero.type')}</div>
            <div className="text-white text-2xl font-semibold">{isTv ? t('home.hero.series') : t('home.hero.movie')}</div>
          </div>
          <div>
            <div className="text-ink-faint text-xs mb-1">{t('home.hero.genres')}</div>
            <div className="text-white text-sm font-medium truncate">{genres || '—'}</div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default EditorialHero;
