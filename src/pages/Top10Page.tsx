import React, { useLayoutEffect, useEffect, useState, useCallback, useRef, startTransition } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { motion, AnimatePresence } from 'framer-motion';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import {
  ArrowLeft, Trophy, Film, Tv, Sparkles, Users, Clock, Eye,
  BarChart3, ChevronDown, TrendingUp, Timer, Star,
  Activity, Flame, CalendarDays
} from 'lucide-react';
import { Skeleton } from '../components/ui/Skeleton';

const MAIN_API = import.meta.env.VITE_MAIN_API;
const TMDB_IMAGE_URL = 'https://image.tmdb.org/t/p';

/**
 * Format a number in compact notation:
 * - < 1000: "845" with locale separator → "845"
 * - >= 1000: "3 960" (with space separator) or "57.1k" / "1.2M"
 * useCompact=true  → "57.1k", "1.2M"
 * useCompact=false → "3 960" (french locale with non-breaking space)
 */
function formatNumber(n: number, useCompact = false): string {
  if (useCompact) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    return n.toLocaleString(i18n.language);
  }
  return n.toLocaleString(i18n.language);
}

/** Format hours in compact notation: 92.4k, 2.9k, 340 */
function formatHours(h: number): string {
  if (h >= 1_000) return `${(h / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  if (h >= 100) return Math.round(h).toLocaleString(i18n.language);
  return h.toFixed(1);
}

// Types
interface Top10Entry {
  rank: number;
  contentId: string;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
  voteAverage: number | null;
  genres: string[];
  releaseDate: string | null;
  uniqueViewers: number;
  totalHours: number;
  totalSessions: number;
  avgSessionMinutes: number;
  episodesWatched?: number;
}

interface GlobalStats {
  totalActiveUsers: number;
  totalUniqueContent: number;
  totalHoursWatched: number;
  totalSessions: number;
  avgSessionMinutes: number;
  dataFrom: string | null;
  dataTo: string | null;
}

type TabType = 'movies' | 'tv' | 'anime';

interface Top10OverviewResponse {
  success: boolean;
  type: TabType;
  top10: Top10Entry[];
  stats: GlobalStats | null;
  updatedAt: string | null;
}

const tabs: { id: TabType; labelKey: string; icon: React.ReactNode }[] = [
  { id: 'movies', labelKey: 'top10.movies', icon: <Film className="w-4 h-4" /> },
  { id: 'tv', labelKey: 'top10.tvShows', icon: <Tv className="w-4 h-4" /> },
  { id: 'anime', labelKey: 'top10.anime', icon: <Sparkles className="w-4 h-4" /> },
];

type PeriodType = 'day' | 'week' | 'month' | 'year' | 'all';
type AlgoType = 'viewers' | 'hours' | 'sessions';

const periodOptions: { id: PeriodType; labelKey: string }[] = [
  { id: 'day', labelKey: 'top10.filters.day' },
  { id: 'week', labelKey: 'top10.filters.week' },
  { id: 'month', labelKey: 'top10.filters.month' },
  { id: 'year', labelKey: 'top10.filters.year' },
  { id: 'all', labelKey: 'top10.filters.all' },
];

const algoOptions: { id: AlgoType; labelKey: string; icon: React.ReactNode }[] = [
  { id: 'viewers', labelKey: 'top10.filters.algoViewers', icon: <Users className="w-3.5 h-3.5" /> },
  { id: 'hours', labelKey: 'top10.filters.algoHours', icon: <Clock className="w-3.5 h-3.5" /> },
  { id: 'sessions', labelKey: 'top10.filters.algoSessions', icon: <Eye className="w-3.5 h-3.5" /> },
];

const tabIds: TabType[] = ['movies', 'tv', 'anime'];
const emptyTop10ByTab: Record<TabType, Top10Entry[]> = { movies: [], tv: [], anime: [] };
const emptyStatsByTab: Record<TabType, GlobalStats | null> = { movies: null, tv: null, anime: null };
const emptyBooleanByTab: Record<TabType, boolean> = { movies: false, tv: false, anime: false };
const emptyErrorByTab: Record<TabType, string | null> = { movies: null, tv: null, anime: null };
const emptyUpdatedAtByTab: Record<TabType, string | null> = { movies: null, tv: null, anime: null };

// FAQ items about methodology
const methodologyItems = [
  { questionKey: 'top10.faq.q1', answerKey: 'top10.faq.a1' },
  { questionKey: 'top10.faq.q2', answerKey: 'top10.faq.a2' },
  { questionKey: 'top10.faq.q3', answerKey: 'top10.faq.a3' },
  { questionKey: 'top10.faq.q4', answerKey: 'top10.faq.a4' },
  { questionKey: 'top10.faq.q5', answerKey: 'top10.faq.a5' },
  { questionKey: 'top10.faq.q6', answerKey: 'top10.faq.a6' },
];

const Top10Page: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabType>('movies');
  const [period, setPeriod] = useState<PeriodType>('all');
  const [algo, setAlgo] = useState<AlgoType>('viewers');
  const [top10Data, setTop10Data] = useState<Record<TabType, Top10Entry[]>>(emptyTop10ByTab);
  const [statsByTab, setStatsByTab] = useState<Record<TabType, GlobalStats | null>>(emptyStatsByTab);
  const [loadingTabs, setLoadingTabs] = useState<Record<TabType, boolean>>(emptyBooleanByTab);
  const [loadedTabs, setLoadedTabs] = useState<Record<TabType, boolean>>(emptyBooleanByTab);
  const [errorsByTab, setErrorsByTab] = useState<Record<TabType, string | null>>(emptyErrorByTab);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [updatedAtByTab, setUpdatedAtByTab] = useState<Record<TabType, string | null>>(emptyUpdatedAtByTab);
  const loadedTabsRef = useRef<Record<TabType, boolean>>(emptyBooleanByTab);
  const statsByTabRef = useRef<Record<TabType, GlobalStats | null>>(emptyStatsByTab);
  const top10RequestsRef = useRef<Set<TabType>>(new Set());
  const statsRequestsRef = useRef<Set<TabType>>(new Set());
  const overviewRequestsRef = useRef<Set<TabType>>(new Set());
  // Current filters key: responses from an older filter combo are dropped.
  const filtersKeyRef = useRef('all:viewers');

  const applyFilters = useCallback((nextPeriod: PeriodType, nextAlgo: AlgoType) => {
    if (filtersKeyRef.current === `${nextPeriod}:${nextAlgo}`) return;
    filtersKeyRef.current = `${nextPeriod}:${nextAlgo}`;
    loadedTabsRef.current = emptyBooleanByTab;
    statsByTabRef.current = emptyStatsByTab;
    top10RequestsRef.current.clear();
    statsRequestsRef.current.clear();
    overviewRequestsRef.current.clear();
    setPeriod(nextPeriod);
    setAlgo(nextAlgo);
    setTop10Data(emptyTop10ByTab);
    setStatsByTab(emptyStatsByTab);
    setLoadedTabs(emptyBooleanByTab);
    setLoadingTabs(emptyBooleanByTab);
    setErrorsByTab(emptyErrorByTab);
    setUpdatedAtByTab(emptyUpdatedAtByTab);
  }, []);

  // Hide footer.
  // The previous implementation also ran a `setInterval(..., 100)` polling
  // `document.querySelector('footer')` for the entire page lifetime, which
  // wasted main-thread time and prevented idle callbacks from firing. The
  // useLayoutEffect below is sufficient on its own. — perf
  useLayoutEffect(() => {
    const footer = document.querySelector('footer');
    if (footer) footer.style.display = 'none';
    document.body.classList.add('no-footer-page');
    return () => {
      if (footer) footer.style.display = '';
      document.body.classList.remove('no-footer-page');
    };
  }, []);

  useEffect(() => {
    loadedTabsRef.current = loadedTabs;
  }, [loadedTabs]);

  useEffect(() => {
    statsByTabRef.current = statsByTab;
  }, [statsByTab]);

  const applyOverviewPayload = useCallback((
    type: TabType,
    payload: { top10?: Top10Entry[]; stats?: GlobalStats | null; updatedAt?: string | null },
    options?: { background?: boolean; markLoaded?: boolean; clearError?: boolean },
  ) => {
    const commit = () => {
      if (payload.top10 !== undefined) {
        setTop10Data(prev => ({ ...prev, [type]: payload.top10! }));
      }
      if (payload.stats !== undefined) {
        setStatsByTab(prev => ({ ...prev, [type]: payload.stats ?? null }));
      }
      if (payload.updatedAt !== undefined) {
        setUpdatedAtByTab(prev => ({ ...prev, [type]: payload.updatedAt ?? null }));
      }
      if (options?.markLoaded) {
        setLoadedTabs(prev => ({ ...prev, [type]: true }));
      }
      if (options?.clearError) {
        setErrorsByTab(prev => ({ ...prev, [type]: null }));
      }
    };

    if (options?.background) {
      startTransition(commit);
      return;
    }

    commit();
  }, []);

  // Fetch data
  const fetchTop10 = useCallback(async (type: TabType, options?: { background?: boolean; signal?: AbortSignal }) => {
    if (loadedTabsRef.current[type] || top10RequestsRef.current.has(type)) return;

    const requestKey = `${period}:${algo}`;
    top10RequestsRef.current.add(type);
    setLoadingTabs(prev => ({ ...prev, [type]: true }));

    try {
      const response = await fetch(`${MAIN_API}/api/top10/${type}?period=${period}&algo=${algo}`, { signal: options?.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.success && filtersKeyRef.current === requestKey) {
        applyOverviewPayload(
          type,
          { top10: data.top10, updatedAt: data.updatedAt ?? null },
          { background: options?.background, markLoaded: true, clearError: true },
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error(`[Top10] Error fetching ${type}:`, err);
      if (filtersKeyRef.current === requestKey) {
        setErrorsByTab(prev => ({ ...prev, [type]: 'top10.loadError' }));
      }
    } finally {
      top10RequestsRef.current.delete(type);
      setLoadingTabs(prev => ({ ...prev, [type]: false }));
    }
  }, [applyOverviewPayload, period, algo]);

  const fetchStats = useCallback(async (type: TabType, options?: { background?: boolean; signal?: AbortSignal }) => {
    if (statsByTabRef.current[type] || statsRequestsRef.current.has(type)) return;

    const requestKey = `${period}:${algo}`;
    statsRequestsRef.current.add(type);

    try {
      const response = await fetch(`${MAIN_API}/api/top10/stats?type=${type}&period=${period}`, { signal: options?.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.success && filtersKeyRef.current === requestKey) {
        applyOverviewPayload(
          type,
          { stats: data.stats ?? null },
          { background: options?.background },
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error(`[Top10] Error fetching stats ${type}:`, err);
    } finally {
      statsRequestsRef.current.delete(type);
    }
  }, [applyOverviewPayload, period, algo]);

  const fetchOverview = useCallback(async (type: TabType, options?: { background?: boolean; signal?: AbortSignal }) => {
    if (loadedTabsRef.current[type] || overviewRequestsRef.current.has(type)) return;

    const requestKey = `${period}:${algo}`;
    overviewRequestsRef.current.add(type);
    setLoadingTabs(prev => ({ ...prev, [type]: true }));

    try {
      const response = await fetch(`${MAIN_API}/api/top10/overview?type=${type}&period=${period}&algo=${algo}`, { signal: options?.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: Top10OverviewResponse = await response.json();
      if (data.success && filtersKeyRef.current === requestKey) {
        applyOverviewPayload(
          type,
          {
            top10: data.top10,
            stats: data.stats ?? null,
            updatedAt: data.updatedAt ?? null,
          },
          { background: options?.background, markLoaded: true, clearError: true },
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error(`[Top10] Error fetching overview ${type}:`, err);
      if (filtersKeyRef.current === requestKey) {
        setErrorsByTab(prev => ({ ...prev, [type]: 'top10.loadError' }));
      }
    } finally {
      overviewRequestsRef.current.delete(type);
      setLoadingTabs(prev => ({ ...prev, [type]: false }));
    }
  }, [applyOverviewPayload, period, algo]);

  // Chargement initial uniquement — au changement de filtre c'est l'effect
  // ci-dessous qui refetch l'onglet actif (sinon on relançait movies à chaque
  // changement même depuis un autre onglet = agrégat SQL lourd gaspillé).
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    const controller = new AbortController();
    void fetchTop10('movies', { signal: controller.signal });
    void fetchStats('movies', { background: true, signal: controller.signal });
    return () => controller.abort();
  }, [fetchTop10, fetchStats]);

  useEffect(() => {
    if (!loadedTabs[activeTab]) {
      if (top10RequestsRef.current.has(activeTab) || overviewRequestsRef.current.has(activeTab)) return;
      void fetchOverview(activeTab);
      return;
    }

    if (!statsByTab[activeTab] && !statsRequestsRef.current.has(activeTab)) {
      void fetchStats(activeTab, { background: true });
    }
  }, [activeTab, loadedTabs, statsByTab, fetchOverview, fetchStats]);

  useEffect(() => {
    if (!loadedTabs[activeTab]) return;
    // Prefetch des autres onglets seulement sur le combo par défaut (cache
    // serveur chaud). Avec des filtres actifs, chaque combo est potentiellement
    // froid : précharger 2 onglets = 2 gros agrégats SQL en plus pour rien.
    if (period !== 'all' || algo !== 'viewers') return;

    const remainingTabs = tabIds.filter(tab => tab !== activeTab && !loadedTabs[tab]);
    if (remainingTabs.length === 0) return;

    const timers = remainingTabs.map((tab, index) =>
      window.setTimeout(() => {
        if (!loadedTabsRef.current[tab]) {
          void fetchOverview(tab, { background: true });
        }
      }, 400 + index * 250),
    );

    return () => {
      timers.forEach(timer => window.clearTimeout(timer));
    };
  }, [activeTab, loadedTabs, fetchOverview, period, algo]);

  const currentData = top10Data[activeTab];
  const currentStats = statsByTab[activeTab];
  const currentError = errorsByTab[activeTab];
  const isCurrentTabLoading = loadingTabs[activeTab] && !loadedTabs[activeTab];
  const lastUpdated = updatedAtByTab[activeTab];

  // Compute average vote from current tab's data
  const avgVote = (() => {
    const rated = currentData.filter(e => e.voteAverage && e.voteAverage > 0);
    if (rated.length === 0) return '0.00';
    const avg = rated.reduce((sum, e) => sum + (e.voteAverage || 0), 0) / rated.length;
    return avg.toFixed(2);
  })();

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="container mx-auto px-4 sm:px-6 py-8 sm:py-12 relative z-10 h-full overflow-y-auto">
        {/* Back */}
        <Link to="/" className="inline-flex items-center text-ink-muted hover:text-white transition-colors mb-8 group/icon">
          <ArrowLeft className="w-5 h-5 mr-2 opacity-70 group-hover/icon:opacity-100 transition-[color,opacity]" />
          {t('common.backToHome')}
        </Link>

        {/* Hero */}
        <div className="max-w-4xl mx-auto text-center mb-14">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mb-6">
            <div className="inline-flex items-center justify-center p-3 bg-surface rounded-full mb-4">
              <Trophy className="w-8 h-8 text-ink-faint" />
            </div>
            <h1 className="text-4xl md:text-6xl font-semibold mb-4 pb-4 flex flex-col items-center gap-1">
              <span className="py-2 leading-tight text-white">Top 10 Movix</span>
              <span className="py-2 leading-tight text-ink-muted">{t('top10.ranking')}</span>
            </h1>
            <p className="text-lg text-ink-muted max-w-2xl mx-auto">
              {t('top10.description')}
            </p>
          </motion.div>

          {/* Badge: logged-in users only */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-control mt-2"
          >
            <Users className="w-4 h-4 text-ink-faint" />
            <span className="text-ink-muted text-sm font-medium">{t('top10.loggedInOnly')}</span>
          </motion.div>
        </div>

        {/* Category stats bar */}
        {currentStats && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="max-w-4xl mx-auto mb-12"
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { icon: <Eye className="w-4 h-4" />, label: t('top10.views'), value: formatNumber(currentStats.totalSessions, true), accent: false },
                { icon: <Clock className="w-4 h-4" />, label: t('top10.hoursWatched'), value: formatHours(currentStats.totalHoursWatched), accent: false },
                { icon: <Star className="w-4 h-4" />, label: t('top10.avgRating'), value: avgVote, accent: true },
                { icon: <Timer className="w-4 h-4" />, label: t('top10.avgSessionDuration'), value: `${currentStats.avgSessionMinutes}min`, accent: false },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="p-4 rounded-lg bg-surface text-center"
                >
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <span className={stat.accent ? 'text-accent' : 'text-ink-faint'}>{stat.icon}</span>
                    <span className={`text-xl font-semibold tabular-nums ${stat.accent ? 'text-accent' : 'text-white'}`}>{stat.value}</span>
                  </div>
                  <p className="text-xs text-ink-faint">{stat.label}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="max-w-4xl mx-auto mb-8"
        >
          <div className="flex items-center justify-center gap-2 p-1.5 rounded-lg bg-surface border border-rule w-fit mx-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-300"
              >
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="activeTabBg"
                    className="absolute inset-0 rounded-lg bg-raised"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                  />
                )}
                <span className={`relative z-10 flex items-center gap-2 ${activeTab === tab.id ? 'text-white' : 'text-ink-muted hover:text-white'}`}>
                  {tab.icon}
                  {t(tab.labelKey)}
                </span>
              </button>
            ))}
          </div>
        </motion.div>

        {/* Filters: period + ranking algorithm */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="max-w-4xl mx-auto mb-10 flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          <div className="flex items-center gap-1 p-1 pl-2.5 rounded-lg bg-surface border border-rule flex-wrap justify-center">
                              <CalendarDays className="w-3.5 h-3.5 text-ink-faint mr-1" />
            {periodOptions.map((p) => (
              <button
                key={p.id}
                onClick={() => applyFilters(p.id, algo)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  period === p.id ? 'bg-raised text-white' : 'text-ink-muted hover:text-white'
                }`}
              >
                {t(p.labelKey)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 p-1 pl-2.5 rounded-lg bg-surface border border-rule flex-wrap justify-center">
                              <BarChart3 className="w-3.5 h-3.5 text-ink-faint mr-1" />
            {algoOptions.map((a) => (
              <button
                key={a.id}
                onClick={() => applyFilters(period, a.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  algo === a.id ? 'bg-raised text-white' : 'text-ink-muted hover:text-white'
                }`}
              >
                {a.icon}
                {t(a.labelKey)}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Top 10 List */}
        <div className="max-w-4xl mx-auto mb-20">
          {isCurrentTabLoading ? (
            <div className="space-y-3" aria-hidden="true">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="bg-surface rounded-lg">
                  <div className="flex items-center gap-4 p-4 sm:p-5">
                    <div className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14"><Skeleton height="100%" className="!rounded-lg" /></div>
                    <div className="flex-shrink-0 w-16 h-24 sm:w-20 sm:h-28"><Skeleton height="100%" className="!rounded-lg" /></div>
                    <div className="flex-1 min-w-0">
                      <Skeleton width="75%" className="h-6 sm:h-7" />
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5"><Skeleton width={72} height={16} /><Skeleton width={32} height={16} /></div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5"><Skeleton width={88} height={16} /><Skeleton width={112} height={16} /></div>
                    </div>
                    <div className="flex-shrink-0 hidden sm:block w-5 h-5" />
                  </div>
                </div>
              ))}
            </div>
          ) : currentError ? (
            <div className="bg-surface rounded-lg p-8 text-center">
              <p className="text-negative">{t(currentError)}</p>
            </div>
          ) : currentData.length === 0 ? (
            <div className="bg-surface rounded-lg p-12 text-center">
              <Trophy className="w-12 h-12 text-ink-faint mx-auto mb-4" />
              <p className="text-ink-muted text-lg">{t('top10.noData')}</p>
              <p className="text-ink-faint text-sm mt-2">{t('top10.fillsUp')}</p>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                className="space-y-3"
              >
                {currentData.map((entry) => {
                  return (
                    <motion.div key={entry.contentId} variants={itemVariants}>
                      <Link
                        to={activeTab === 'movies' ? `/movie/${entry.contentId}` : `/tv/${entry.contentId}`}
                        className="block"
                      >
                        <div className="group bg-surface rounded-lg transition-all duration-300 hover:brightness-110">
                          <div className="flex items-center gap-4 p-4 sm:p-5">
                            {/* Rank */}
                            <div className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-lg flex items-center justify-center font-semibold text-xl sm:text-2xl text-accent tabular-nums">
                              {entry.rank}
                            </div>

                            {/* Poster */}
                            <div className="flex-shrink-0 w-16 h-24 sm:w-20 sm:h-28 rounded-lg overflow-hidden bg-rule relative">
                              {entry.posterPath ? (
                                <img
                                  src={`${TMDB_IMAGE_URL}/w185${entry.posterPath}`}
                                  alt={entry.title}
                                  className="w-full h-full object-cover group-hover:brightness-110 transition-[filter] duration-500"
                                  decoding="async"
                                  {...{ fetchpriority: entry.rank <= 3 ? 'high' : 'low' }}
                                  loading="lazy"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Film className="w-6 h-6 text-ink-faint" />
                                </div>
                              )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-white text-base sm:text-lg truncate">
                                {entry.title}
                              </h3>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                                {entry.genres.length > 0 && (
                                  <span className="text-xs text-ink-muted truncate max-w-[200px]">
                                    {entry.genres.slice(0, 3).join(' · ')}
                                  </span>
                                )}
                                {entry.releaseDate && (
                                  <span className="text-xs text-ink-faint tabular-nums">
                                    {new Date(entry.releaseDate).getFullYear()}
                                  </span>
                                )}
                                {entry.voteAverage && entry.voteAverage > 0 && (
                                  <span className="flex items-center gap-0.5 text-xs text-white tabular-nums">
                                    <Star className="w-3 h-3 fill-current text-accent" />
                                    {entry.voteAverage.toFixed(1)}
                                  </span>
                                )}
                              </div>

                              {/* Stats row */}
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5">
                                <div className="flex items-center gap-1 text-xs text-ink-muted">
                                  <Eye className="w-3.5 h-3.5 text-ink-faint" />
                                  <span><strong className="text-white tabular-nums">{formatNumber(entry.uniqueViewers)}</strong> {t('top10.views')}</span>
                                </div>
                                <div className="flex items-center gap-1 text-xs text-ink-muted">
                                  <Clock className="w-3.5 h-3.5 text-ink-faint" />
                                  <span><strong className="text-white tabular-nums">{formatHours(entry.totalHours)}</strong> {t('top10.hoursWatched')}</span>
                                </div>
                                {entry.episodesWatched && (
                                  <div className="hidden sm:flex items-center gap-1 text-xs text-ink-muted">
                                    <BarChart3 className="w-3.5 h-3.5 text-ink-faint" />
                                    <span><strong className="text-white tabular-nums">{formatNumber(entry.episodesWatched)}</strong> {t('top10.episodes')}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Right arrow on hover */}
                            <div className="flex-shrink-0 hidden sm:flex items-center">
                              <TrendingUp
                                className="w-5 h-5 text-ink-faint opacity-0 group-hover:opacity-60 transition-opacity"
                              />
                            </div>
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  );
                })}
              </motion.div>
            </AnimatePresence>
          )}

          {/* Last updated */}
          {lastUpdated && !isCurrentTabLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center mt-6 space-y-1"
            >
              <p className="text-xs text-ink-faint">
                {t('top10.updatedAt', { date: new Date(lastUpdated).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) })}
              </p>
              {currentStats?.dataFrom && currentStats?.dataTo && (
                <p className="text-xs text-ink-faint">
                  {t('top10.dataRange', { from: new Date(currentStats.dataFrom).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }), to: new Date(currentStats.dataTo).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }) })}
                </p>
              )}
            </motion.div>
          )}
        </div>

        {/* Methodology Section */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          className="max-w-4xl mx-auto mb-20"
        >
          <motion.div variants={itemVariants} className="text-center mb-10">
            <div className="inline-flex items-center justify-center p-2.5 bg-surface rounded-full mb-4">
              <BarChart3 className="w-6 h-6 text-ink-faint" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-semibold text-white mb-3">{t('top10.howItWorks')}</h2>
            <p className="text-ink-muted max-w-2xl mx-auto">
              {t('top10.howItWorksDesc')}
            </p>
          </motion.div>

          {/* Explanation cards */}
          <motion.div variants={itemVariants} className="mb-10">
            <div className="bg-surface rounded-lg p-6 sm:p-8">
              <div className="grid md:grid-cols-3 gap-6">
                {/* Card: What counts as a view */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-2 rounded-lg bg-rule">
                      <Eye className="w-5 h-5 text-ink-faint" />
                    </div>
                    <h3 className="text-base font-semibold text-white">{t('top10.whatCounts')}</h3>
                  </div>
                  <div className="space-y-2">
                    <div className="p-3 rounded-lg bg-rule">
                      <div className="flex items-center gap-2 mb-1">
                        <Film className="w-4 h-4 text-ink-faint" />
                        <span className="text-sm font-medium text-white">{t('top10.movies')}</span>
                      </div>
                      <p className="text-xs text-ink-muted" dangerouslySetInnerHTML={{ __html: t('top10.moviesMinWatch') }} />
                    </div>
                    <div className="p-3 rounded-lg bg-rule">
                      <div className="flex items-center gap-2 mb-1">
                        <Tv className="w-4 h-4 text-ink-faint" />
                        <span className="text-sm font-medium text-white">{t('top10.seriesAndAnime')}</span>
                      </div>
                      <p className="text-xs text-ink-muted" dangerouslySetInnerHTML={{ __html: t('top10.seriesMinWatch') }} />
                    </div>
                  </div>
                </div>

                {/* Card: What data we use */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-2 rounded-lg bg-rule">
                      <BarChart3 className="w-5 h-5 text-ink-faint" />
                    </div>
                    <h3 className="text-base font-semibold text-white">{t('top10.theData')}</h3>
                  </div>
                  <div className="space-y-2 text-sm text-ink-muted">
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-rule">
                      <Users className="w-4 h-4 text-ink-faint mt-0.5 flex-shrink-0" />
                      <span>{t('top10.uniqueViewers')}</span>
                    </div>
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-rule">
                      <Clock className="w-4 h-4 text-ink-faint mt-0.5 flex-shrink-0" />
                      <span>{t('top10.totalWatchTime')}</span>
                    </div>
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-rule">
                      <Timer className="w-4 h-4 text-ink-faint mt-0.5 flex-shrink-0" />
                      <span>{t('top10.avgDuration')}</span>
                    </div>
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-rule">
                      <Activity className="w-4 h-4 text-ink-faint mt-0.5 flex-shrink-0" />
                      <span>{t('top10.totalSessions')}</span>
                    </div>
                  </div>
                </div>

                {/* Card: Who is counted */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-2 rounded-lg bg-rule">
                      <Flame className="w-5 h-5 text-ink-faint" />
                    </div>
                    <h3 className="text-base font-semibold text-white">{t('top10.whoIsCounted')}</h3>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="p-3 rounded-lg bg-rule">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full bg-positive" />
                        <span className="text-positive font-medium">{t('top10.loggedInUsers')}</span>
                      </div>
                      <p className="text-xs text-ink-muted">{t('top10.loggedInUsersDesc')}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-rule">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full bg-negative" />
                        <span className="text-negative font-medium">{t('top10.guestsAnonymous')}</span>
                      </div>
                      <p className="text-xs text-ink-muted">{t('top10.guestsAnonymousDesc')}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* FAQ */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          className="max-w-3xl mx-auto mb-20"
        >
          <motion.div variants={itemVariants} className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-semibold text-white mb-3">{t('top10.faq')}</h2>
          </motion.div>

          <div className="space-y-3">
            {methodologyItems.map((faq, index) => (
              <motion.div key={index} variants={itemVariants}>
                <div className="bg-surface rounded-lg overflow-hidden">
                  <button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="w-full p-5 flex items-center justify-between text-left gap-4"
                  >
                    <span className="font-medium text-white text-sm sm:text-base">{t(faq.questionKey)}</span>
                    <motion.div
                      animate={{ rotate: openFaq === index ? 180 : 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex-shrink-0"
                    >
                      <ChevronDown className="w-5 h-5 text-ink-faint" />
                    </motion.div>
                  </button>
                  <motion.div
                    initial={false}
                    animate={{
                      height: openFaq === index ? 'auto' : 0,
                      opacity: openFaq === index ? 1 : 0,
                    }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <p className="px-5 pt-4 pb-5 text-sm text-ink-muted leading-relaxed border-t border-rule">{t(faq.answerKey)}</p>
                  </motion.div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-2xl mx-auto text-center pb-12"
        >
          <div className="bg-surface rounded-lg p-8">
            <Trophy className="w-10 h-10 text-ink-faint mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">{t('top10.evolvingRanking')}</h3>
            <p className="text-ink-muted text-sm mb-6 max-w-md mx-auto">
              {t('top10.evolvingRankingDesc')}
            </p>
            <Link to="/">
              <button className="inline-flex items-center gap-2 bg-white text-black hover:bg-neutral-200 px-6 py-3 rounded-full font-semibold transition-colors">
                <ArrowLeft className="w-4 h-4" />
                {t('top10.exploreCatalog')}
              </button>
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Top10Page;
