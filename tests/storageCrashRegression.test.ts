import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceFunction } from './helpers/sourceFunction.mjs';

test('les logos restent affichés lorsque le cache de session est plein', async () => {
  const memoryCache = new Map([['movie_42_fr', {
    logoUrl: 'https://image.tmdb.org/t/p/w300/logo.png', posterUrl: null,
  }]]);
  // L'écriture sessionStorage est best-effort : une erreur de quota ne doit
  // jamais remonter, sinon le handler pagehide / le differeur de persistance
  // lèverait hors du cycle React.
  const persistCache = sourceFunction('src/hooks/useTmdbImages.ts', 'persistCache', {
    cacheWriteTimer: undefined, cacheWriteIdle: undefined, clearTimeout: () => {},
    window: { cancelIdleCallback: undefined },
    memoryCache, memoryCacheTimestamp: Date.now(),
    sessionStorage: { setItem() { throw new DOMException('Full', 'QuotaExceededError'); } },
    CACHE_KEY: 'movix_tmdb_images_cache_v7',
    CACHE_TIMESTAMP_KEY: 'movix_tmdb_images_cache_v7_timestamp',
  });
  assert.doesNotThrow(persistCache);

  // L'affichage lit la copie mémoire : elle doit rester servable.
  const getCache = sourceFunction('src/hooks/useTmdbImages.ts', 'getCache', {
    memoryCache, memoryCacheTimestamp: Date.now(), CACHE_DURATION_MS: 24 * 60 * 60 * 1000,
    sessionStorage: { getItem: () => null },
    CACHE_KEY: 'movix_tmdb_images_cache_v7',
    CACHE_TIMESTAMP_KEY: 'movix_tmdb_images_cache_v7_timestamp',
    trimCache: () => {}, normalizeEntry: (raw: unknown) => raw,
  });
  assert.equal(getCache().get('movie_42_fr')?.logoUrl, 'https://image.tmdb.org/t/p/w300/logo.png');
});

test('un cache de logos invalide ne bloque pas leur chargement', async () => {
  const getCache = sourceFunction('src/hooks/useTmdbImages.ts', 'getCache', {
    memoryCache: null, memoryCacheTimestamp: 0, CACHE_DURATION_MS: 24 * 60 * 60 * 1000,
    sessionStorage: {
      getItem: (key: string) => key.endsWith('timestamp') ? String(Date.now()) : '{invalid',
      setItem() {},
    },
    CACHE_KEY: 'movix_tmdb_images_cache_v7',
    CACHE_TIMESTAMP_KEY: 'movix_tmdb_images_cache_v7_timestamp',
    trimCache: () => {}, normalizeEntry: (raw: unknown) => raw,
  });
  let cache: Map<string, unknown> | undefined;
  assert.doesNotThrow(() => { cache = getCache(); });
  // Un blob corrompu est jeté, pas propagé : on repart d'un cache vide.
  assert.equal(cache?.size, 0);
});

test('une liste non enregistrée ne change pas le statut affiché et signale le refus', () => {
  const setters: boolean[] = [];
  const errors: string[] = [];
  const useWatchStatus = sourceFunction('src/hooks/useWatchStatus.ts', 'useWatchStatus', {
    useState: () => [false, (value: boolean) => setters.push(value)], useEffect() {},
    useTranslation: () => ({ t: (key: string) => key }), toast: { error: (message: string) => errors.push(message) },
    localStorage: { getItem: () => '[]', setItem() { throw new DOMException('Full', 'QuotaExceededError'); } },
  });
  const status = useWatchStatus({ id: 42, type: 'movie', title: 'Test', poster_path: '' });
  assert.doesNotThrow(status.toggleWatched);
  assert.deepEqual(setters, []);
  assert.equal(errors.length, 1);
});

test('une liste enregistrée conserve les autres entrées et actualise le statut', () => {
  const setters: boolean[] = [];
  let stored = JSON.stringify([{ id: 7, title: 'déjà présent' }]);
  const useWatchStatus = sourceFunction('src/hooks/useWatchStatus.ts', 'useWatchStatus', {
    useState: () => [false, (value: boolean) => setters.push(value)], useEffect() {},
    useTranslation: () => ({ t: (key: string) => key }), toast: { error() { assert.fail('écriture valide'); } },
    localStorage: { getItem: () => stored, setItem(_key: string, value: string) { stored = value; } },
  });
  useWatchStatus({ id: 42, type: 'movie', title: 'Test', poster_path: '' }).toggleWatched();
  assert.deepEqual(JSON.parse(stored).map((item: { id: number }) => item.id), [7, 42]);
  assert.deepEqual(setters, [true]);
});

test('Wrapped renonce à la collecte quand le stockage de confidentialité est fermé', () => {
  const bindings = {
    useCallback: (callback: unknown) => callback,
    localStorage: { getItem() { throw new DOMException('Closed', 'NS_ERROR_ABORT'); } },
  };
  const isEnabled = sourceFunction('src/hooks/useWrappedTracker.ts', 'isDataCollectionEnabled', bindings);
  const getUserInfo = sourceFunction('src/hooks/useWrappedTracker.ts', 'getUserInfo', bindings);
  assert.equal(isEnabled(), false);
  assert.deepEqual(getUserInfo(), { authToken: null, profileId: null, userId: null });
});
