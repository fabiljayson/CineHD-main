import type { AxiosInstance } from 'axios';
import { MAIN_API } from '../config/runtime';

/**
 * Le jeton de session vit dans un cookie HttpOnly : le navigateur l'envoie seul,
 * et aucun script de la page ne peut le lire. Deux conséquences à traiter ici.
 *
 * 1. Un cookie n'est joint que si la requête le demande. Le frontend et l'API
 *    sont deux origines distinctes : `fetch` vaut `same-origin` par défaut, donc
 *    la session serait ignorée sur chaque appel. D'où l'ajout de
 *    `credentials: 'include'` en un seul endroit, plutôt que dans les dizaines
 *    de fichiers qui appellent l'API.
 * 2. Ce qui restait dans `localStorage` ne doit plus servir de jeton. La clé
 *    `auth_token` subsiste comme simple marqueur « connecté » : elle est lue
 *    partout dans l'app pour savoir s'il y a une session, et la remplacer par un
 *    drapeau non secret évite de toucher chaque garde sans changer de
 *    comportement.
 */

/** Valeur non secrète de `auth_token` : présence = session ouverte. */
export const SESSION_MARKER = 'cookie';

const DEV_API_ORIGINS = ['http://localhost:25565', 'http://127.0.0.1:25565'];

function apiOrigins(): string[] {
  const origins = new Set<string>();
  if (MAIN_API) {
    try {
      origins.add(new URL(MAIN_API, window.location.href).origin);
    } catch {
      /* MAIN_API illisible : on se rabat sur les origines de dev */
    }
  }
  if (import.meta.env.DEV) {
    DEV_API_ORIGINS.forEach((origin) => origins.add(origin));
  }
  return [...origins];
}

export function isMainApiUrl(value: string, origins = apiOrigins()): boolean {
  try {
    return origins.includes(new URL(value, window.location.href).origin);
  } catch {
    return false;
  }
}

function urlOf(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') return input;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.href;
  const request = input as Request;
  return request && typeof request.url === 'string' ? request.url : null;
}

/**
 * Enveloppe `window.fetch` : les appels à l'API emportent le cookie de session.
 *
 * Un `credentials` explicite de l'appelant est respecté — le service worker, par
 * exemple, gère son propre cas.
 */
export function installSessionFetchCredentials(): void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  const originalFetch = window.fetch.bind(window);
  const origins = apiOrigins();
  if (origins.length === 0) return;

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (!url || !isMainApiUrl(url, origins)) return originalFetch(input, init);
    if (init?.credentials) return originalFetch(input, init);
    return originalFetch(input, { ...(init ?? {}), credentials: 'include' });
  }) as typeof window.fetch;
}

/**
 * Même règle pour Axios. Chaque instance a ses propres intercepteurs : l'appel
 * doit donc être fait pour l'export global et pour chaque instance qui parle à
 * l'API (voir `main.tsx`).
 */
export function installSessionCredentials(instance: AxiosInstance): void {
  const origins = apiOrigins();
  if (origins.length === 0) return;

  instance.interceptors.request.use((config) => {
    const base = config.baseURL ?? '';
    const url = config.url ?? '';
    // Une URL absolue ignore `baseURL` : c'est elle qu'on teste dans ce cas.
    const target = /^https?:\/\//i.test(url) ? url : `${base}${url}`;
    if (isMainApiUrl(target, origins)) {
      config.withCredentials = true;
    }
    return config;
  });
}
