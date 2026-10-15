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
    : 'https://via.placeholder.com/1280x720/faf7f2/1a1816?text=MOVIX';

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
    <section className="relative w-full min-h-[78vh] bg-editorial-paper overflow-hidden">
      <div className="absolute inset-0 bg-editorial-paper-soft opacity-60 pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 md:px-8 lg:px-12 pt-12 md:pt-20 pb-12 md:pb-20 grid grid-cols-1 md:grid-cols-[320px_1fr] gap-8 md:gap-12 items-center">
        {/* Poster — archival card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative"
        >
          <div
            className="relative border border-editorial-border rounded-md overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.08)] bg-white"
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
          <div className="mt-3 flex items-center gap-2 text-xs text-editorial-muted tracking-wider uppercase">
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
            <span className="h-px flex-1 bg-editorial-border" />
            <span className="text-editorial-gold text-xs font-bold tracking-[0.25em] uppercase">
              {t('home.hero.nowPlaying') || 'Now Playing'}
            </span>
            <span className="h-px flex-1 bg-editorial-border" />
          </div>

          <h1
            className="font-display text-5xl md:text-7xl lg:text-8xl text-editorial-ink leading-[0.95] tracking-tight mb-5"
            style={{ fontWeight: 400 }}
          >
            {title}
          </h1>

          {genres && (
            <p className="text-editorial-muted text-sm md:text-base mb-6 tracking-wide">
              {year && <span>{year}</span>}
              {year && genres && <span className="mx-2">—</span>}
              {genres && <span className="text-editorial-ink-soft">{genres}</span>}
            </p>
          )}

          <p className="text-editorial-ink-soft text-base md:text-lg leading-relaxed mb-8 max-w-2xl font-normal">
            {active.overview || t('home.hero.noOverview') || 'No overview available.'}
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              to={`/watch/movie/${encodeId(active.id)}`}
              state={{ source: 'hero' }}
              className="flex-1 sm:w-auto px-7 py-3.5 bg-editorial-gold text-white font-medium tracking-wide rounded-md text-base hover:bg-editorial-ink-soft transition-colors flex items-center justify-center gap-2"
            >
              <Play className="w-4.5 h-4.5" fill="currentColor" />
              {t('home.hero.play') || 'Play'}
            </Link>
            <Link
              to={`/movie/${encodeId(active.id)}`}
              className="flex-1 sm:w-auto px-7 py-3.5 border border-editorial-border text-editorial-ink font-medium rounded-md text-base hover:bg-editorial-paper-soft transition-colors flex items-center justify-center gap-2"
            >
              <Info className="w-4.5 h-4.5" />
              {t('home.hero.info') || 'Info'}
            </Link>
          </div>
        </motion.div>
      </div>

      {/* Bottom metadata rail */}
      <div className="relative z-10 max-w-7xl mx-auto px-4 md:px-8 lg:px-12 pb-10">
        <div className="border-t border-editorial-border pt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-editorial-muted text-xs uppercase tracking-wider mb-1">{t('home.hero.rating') || 'Rating'}</div>
            <div className="text-editorial-ink font-display text-2xl">{active.vote_average > 0 ? active.vote_average.toFixed(1) : '—'}<span className="text-editorial-muted text-xs"> /10</span></div>
          </div>
          <div>
            <div className="text-editorial-muted text-xs uppercase tracking-wider mb-1">{t('home.hero.release') || 'Year'}</div>
            <div className="text-editorial-ink font-display text-2xl">{year || '—'}</div>
          </div>
          <div>
            <div className="text-editorial-muted text-xs uppercase tracking-wider mb-1">{t('home.hero.type') || 'Type'}</div>
            <div className="text-editorial-ink font-display text-2xl capitalize">{isTv ? (t('home.hero.series') || 'Series') : (t('home.hero.movie') || 'Movie')}</div>
          </div>
          <div>
            <div className="text-editorial-muted text-xs uppercase tracking-wider mb-1">{t('home.hero.genres') || 'Genres'}</div>
            <div className="text-editorial-gold text-sm font-medium tracking-wide truncate">{genres || '—'}</div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default EditorialHero;
