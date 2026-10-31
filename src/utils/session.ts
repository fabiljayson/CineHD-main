import { useCallback, useEffect, useState } from 'react';
import { readLocalStorage } from './browserStorage';

/**
 * Vrai si le visiteur porte une session que l'application reconnaît.
 *
 * C'est LA définition de « connecté » côté client, partagée par la racine
 * (`/`), les routes protégées et la lecture. Elle lit les mêmes drapeaux que
 * le reste de l'app : les trois méthodes (Discord, Google, phrase secrète) plus
 * l'ancien couplet VIP par code d'accès, conservé pour les comptes hérités.
 *
 * Ce n'est PAS une autorisation : le serveur revalide chaque requête protégée
 * contre `user_sessions` (`validateAuthRequest`). Ici on décide seulement ce
 * qu'on affiche — inutile de monter un lecteur à quelqu'un qui ne peut pas
 * l'utiliser.
 */
export const isSessionAuthenticated = (): boolean => {
  if (readLocalStorage('discord_auth') === 'true') return true;
  if (readLocalStorage('google_auth') === 'true') return true;
  if (readLocalStorage('bip39_auth') === 'true') return true;
  if (readLocalStorage('is_vip') === 'true') return true;

  const authStr = readLocalStorage('auth');
  if (authStr) {
    try {
      const authObj = JSON.parse(authStr);
      if (authObj.userProfile && authObj.userProfile.provider === 'access_code') return true;
    } catch { /* stockage corrompu : on considère le visiteur comme anonyme */ }
  }
  return false;
};

// Les événements émis par le reste de l'app quand la session change.
// `storage` couvre un onglet qui se connecte pendant qu'un autre est ouvert ;
// `focus` rattrape un changement fait dans un autre onglet sans événement.
const AUTH_EVENTS = ['storage', 'auth-changed', 'authStateChanged', 'sync_storage_updated', 'focus'] as const;

/** Version réactive de `isSessionAuthenticated` — re-rend si la session bouge. */
export function useSessionAuthenticated(): boolean {
  const [authenticated, setAuthenticated] = useState(isSessionAuthenticated);

  const refresh = useCallback(() => {
    setAuthenticated(isSessionAuthenticated());
  }, []);

  useEffect(() => {
    AUTH_EVENTS.forEach((event) => window.addEventListener(event, refresh));
    // On relit une fois après le montage : la session peut avoir été posée
    // entre le render initial et l'abonnement.
    refresh();
    return () => AUTH_EVENTS.forEach((event) => window.removeEventListener(event, refresh));
  }, [refresh]);

  return authenticated;
}
