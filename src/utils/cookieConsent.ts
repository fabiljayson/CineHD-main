// Consentement aux cookies non essentiels (RGPD).
//
// Une seule décision par appareil, prise dans la bannière
// (`components/CookieConsentBanner`) : "accepted" autorise le chargement des
// mesures tierces (voir `utils/analytics.ts`), "declined" les bloque. Le choix
// n'est jamais revu automatiquement : pas de rallumage silencieux, pas de
// fenêtre de re-consentement.
import { readLocalStorage, writeLocalStorage } from './browserStorage';

export type CookieConsent = 'accepted' | 'declined';

const STORAGE_KEY = 'cookieConsent';

/** `null` = aucune décision (bannière à afficher, aucun script tiers autorisé). */
export function getCookieConsent(): CookieConsent | null {
  const value = readLocalStorage(STORAGE_KEY);
  return value === 'accepted' || value === 'declined' ? value : null;
}

export function setCookieConsent(value: CookieConsent): boolean {
  return writeLocalStorage(STORAGE_KEY, value);
}
