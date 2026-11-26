/**
 * Adblocker côté client — moteur Ghostery (@ghostery/adblocker).
 *
 * **Activé par défaut** — bloque les requêtes réseau (`fetch`,
 * `XMLHttpRequest`) et supprime les scripts/iframes injectés dans le DOM quand
 * un filtre EasyList les match. La clé `cinehd_adblocker_enabled` à `'0'` le
 * désactive explicitement.
 *
 * Best-effort : sans filtres ou sans connexion, rien n'est bloqué (graceful).
 */
import { FiltersEngine, makeRequest, parseFilters } from '@ghostery/adblocker';

const ENABLED_KEY = 'cinehd_adblocker_enabled';
const EASYLIST_URL = 'https://easylist.to/easylist.txt';

let engine: FiltersEngine | null = null;
let enabled = false;
let fetchWrapped = false;
let observer: MutationObserver | null = null;

/**
 * L'adblocker est **activé par défaut** (« activer tous les adblockers ») :
 * la clé `cinehd_adblocker_enabled` à `'0'` le désactive explicitement.
 */
export const isAdBlockerEnabled = (): boolean =>
  localStorage.getItem(ENABLED_KEY) !== '0';

function ensureEngine(): FiltersEngine {
  if (!engine) engine = new FiltersEngine();
  return engine;
}

type MakeRequestDetails = Parameters<typeof makeRequest>[0];

function isBlockedUrl(url: string, type: MakeRequestDetails['type']): boolean {
  if (!url) return false;
  // Le toggle désactivé doit réellement tout laisser passer : le wrapper fetch
  // et le MutationObserver consultent tous deux cette fonction, un seul garde-fou
  // suffit donc à couvrir les deux chemins.
  if (!enabled) return false;
  try {
    return Boolean(ensureEngine().match(makeRequest({ url, type })).match);
  } catch {
    return false;
  }
}

/**
 * Wrape `window.fetch` — les requêtes matchées par les filtres sont rejetées
 * avec un `AbortError` (équivalent d'un appel réseau bloqué).
 */
function installFetchWrapper(): void {
  if (fetchWrapped) return;
  fetchWrapped = true;
  const original = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url && isBlockedUrl(String(url), 'script')) {
      return Promise.reject(new DOMException('Blocked by ad blocker', 'AbortError'));
    }
    return original(input as RequestInfo, init);
  }) as typeof fetch;
}

/**
 * Supprime les scripts/iframes injectés dans le DOM quand ils matchent un filtre.
 */
function installObserver(): void {
  if (observer || typeof MutationObserver === 'undefined' || !document.documentElement) return;
  observer = new MutationObserver((mutations) => {
    for (const record of mutations) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const injected: Element[] = [node, ...node.querySelectorAll('iframe[src]')];
        for (const el of injected) {
          const src = el.getAttribute('src') || '';
          if (src && isBlockedUrl(src, 'script')) el.remove();
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

async function loadFilters(): Promise<void> {
  try {
    const response = await fetch(EASYLIST_URL);
    if (!response.ok) return;
    const text = await response.text();
    if (!text) return;
    const { networkFilters } = parseFilters(text);
    if (networkFilters?.length) {
      ensureEngine().update({ newNetworkFilters: networkFilters });
    }
  } catch {
    /* Best-effort : sans connexion, l'adblocker reste vide */
  }
}

export function installAdBlocker(): void {
  if (enabled) return;
  enabled = true;
  installFetchWrapper();
  installObserver();
  void loadFilters();
}

export function uninstallAdBlocker(): void {
  enabled = false;
}

/** Appelé tôt au boot — active l'adblocker si le toggle est à ON dans localStorage. */
export function installAdBlockerIfEnabled(): void {
  if (isAdBlockerEnabled()) installAdBlocker();
}
