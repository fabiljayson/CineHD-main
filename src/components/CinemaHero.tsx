import React from 'react';
import { Link } from 'react-router-dom';
import { Play, Info, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { encodeId } from '../utils/idEncoder';

interface Media {
  id: number;
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

interface CinemaHeroProps {
  items: Media[];
}

const tmdbImage = (path: string, size = 'w1280'): string =>
  path
    ? `https://image.tmdb.org/t/p/${size}${path}`
    : 'https://via.placeholder.com/1280x720/0b0d10/c89028?text=MOVIX';

const GENRE_MAP: Record<number, string> = {
  28: 'Action', 12: 'Aventure', 16: 'Animation', 35: 'Comédie', 80: 'Crime',
  18: 'Drame', 14: 'Fantastique', 878: 'Sci-Fi', 53: 'Thriller', 10751: 'Famille',
  10402: 'Musique', 9648: 'Mystère', 10749: 'Romance', 27: 'Horreur', 36: 'Histoire',
};

/**
 * CinemaHero — particular, film-buff hero.
 *
 * One bold element only: a full-bleed marquee with film-grain texture,
 * brand-gold accent, and a spotlight glow behind the active backdrop.
 * Everything else stays quiet — no card hover animations, no all-caps
 * labels everywhere, no scattered fade-ins.
 */
export const CinemaHero: React.FC<CinemaHeroProps> = ({ items }) => {
  const { t } = useTranslation();
  const active = items[0];
  if (!active) return null;

  const title = active.title || active.name || '';
  const year = (active.release_date || active.first_air_date || '').slice(0, 4);
  const genres = (active.genre_ids || []).slice(0, 2).map(id => GENRE_MAP[id]).filter(Boolean).join(' · ');
  const isTv = active.media_type === 'tv';

  return (
    <section className="relative w-full min-h-[78vh] overflow-hidden bg-[#0b0d10]">
      <style dangerouslySetInnerHTML={{ __html: `
        .cinema-hero-noise { background-image: url('https://grainy-gradients.vercel.app/noise.svg'); }
      ` }} />

      {/* Spotlight glow behind the active slide */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#c89028]/15 via-transparent to-[#0b0d10]" />

      {/* Backdrop image with film-grain overlay */}
      <div className="absolute inset-0">
        <img
          src={tmdbImage(active.backdrop_path || active.poster_path, 'w1280')}
          alt=""
          className="w-full h-full object-cover opacity-60 grayscale-[0.5] brightness-[0.8] contrast-[1.1]"
          loading="eager"
          decoding="async"
        />
        <div className="cinema-hero-noise absolute inset-0 opacity-[0.35] mix-blend-overlay pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b0d10]/95 via-[#0b0d10]/40 to-transparent" />
      </div>

      <div className="relative z-10 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-8 px-4 md:px-8 pt-16 md:pt-20 pb-8 md:pb-20">
        {/* Poster column */}
        <div className="hidden md:flex flex-col gap-4 items-start">
          <div className="relative group rounded-lg overflow-hidden border border-white/10 shadow-2xl block">
            <img
              src={tmdbImage(active.poster_path || active.backdrop_path, 'w500')}
              alt={title}
              className="w-56 h-auto object-cover"
              loading="eager"
            />
            <div className="absolute inset-0 bg-[#0b0d10]/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="absolute bottom-3 right-3 text-[#c89028] opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <Play className="w-6 h-6" fill="currentColor" />
            </div>
          </div>
          <div className="flex items-center gap-2 pl-2 text-[#c89028] text-xs font-bold tracking-wider border border-[#c89028]/30 rounded-full px-3 py-1 bg-[#0b0d10]/40">
            <Clock className="w-3 h-3" />
            <span>{year}</span>
          </div>
        </div>

        {/* Content column */}
        <div className="flex flex-col justify-center">
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-3 mb-6"
          >
            <div className="h-px flex-1 bg-[#c89028]/30" />
            <span className="text-[#c89028] text-xs font-bold tracking-[0.25em] uppercase">
              {t('home.hero.nowPlaying') || 'Now Playing'}
            </span>
            <div className="h-px flex-1 bg-[#c89028]/30" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-4xl md:text-6xl lg:text-7xl font-extrabold text-white tracking-tight leading-tight mb-3"
            style={{ textShadow: '0 4px 24px rgba(0,0,0,0.6)' }}
          >
            {title}
          </motion.h1>

          {genres && (
            <p className="text-gray-400 text-sm md:text-base mb-5 tracking-wide">
              {year && <span className="text-gray-500">{year}</span>}
              {year && genres && <span className="text-gray-700 mx-2">•</span>}
              {genres && <span className="text-[#c89028]/90">{genres}</span>}
            </p>
          )}

          <p className="text-gray-300 text-base md:text-lg leading-relaxed mb-7 max-w-3xl">
            {active.overview || t('home.hero.noOverview') || 'No overview available.'}
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              to={`/watch/movie/${encodeId(active.id)}`}
              state={{ source: 'hero' }}
              className="flex-1 sm:w-auto px-7 py-3.5 bg-[#c89028] text-white font-bold rounded-lg text-base tracking-wide hover:bg-[#d9a63a] transition-colors flex items-center justify-center gap-2"
            >
              <Play className="w-4.5 h-4.5" fill="currentColor" />
              {t('home.hero.play') || 'Play'}
            </Link>
            <Link
              to={`/movie/${encodeId(active.id)}`}
              className="flex-1 sm:w-auto px-7 py-3.5 border border-white/20 text-white font-medium rounded-lg text-base hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
            >
              <Info className="w-4.5 h-4.5" />
              {t('home.hero.info') || 'Info'}
            </Link>
          </div>
        </div>
      </div>

      {/* Bottom stats rail */}
      <div className="absolute bottom-0 left-0 right-0 px-4 md:px-8 pb-4 md:pb-7 z-10">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="flex items-baseline gap-2">
            <span className="text-gray-500 text-xs font-medium tracking-wider uppercase">{t('home.hero.rating') || 'Rating'}</span>
            <span className="text-white font-bold">{active.vote_average > 0 ? active.vote_average.toFixed(1) : '—'} <span className="text-gray-600">/10</span></span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-gray-500 text-xs font-medium tracking-wider uppercase">{t('home.hero.release') || 'Year'}</span>
            <span className="text-white font-bold">{year || '—'}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-gray-500 text-xs font-medium tracking-wider uppercase">{t('home.hero.genres') || 'Genres'}</span>
            <span className="text-[#c89028] text-xs font-bold tracking-wide">{genres || '—'}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-gray-500 text-xs font-medium tracking-wider uppercase">{t('home.hero.type') || 'Type'}</span>
            <span className="text-white font-bold">{isTv ? (t('home.hero.series') || 'Series') : (t('home.hero.movie') || 'Movie')}</span>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CinemaHero;
