import { useEffect, useState } from 'react';

export interface SubscriptionCountdown {
  /** Minuteur d'abonnement armé — affiché par le Header (session bip39). */
  hasExpiry: boolean;
  /** Durée restante en ms, au moins 0. */
  remainingMs: number;
  /** true à 0. */
  expired: boolean;
}

export function readSubscriptionExpiryMs(): number | null {
  if (typeof window === 'undefined') return null;

  // Le minuteur ne concerne que les sessions de codes de connexion — même
  // convention que persistResolvedSession (`subscription_expires_at`).
  if (window.localStorage.getItem('auth_method') !== 'bip39') return null;

  const raw = window.localStorage.getItem('subscription_expires_at');
  if (!raw) return null;

  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function computeRemainingMs(): number | null {
  const expiryMs = readSubscriptionExpiryMs();
  return expiryMs === null ? null : expiryMs - Date.now();
}

/**
 * Minuteur d'abonnement dans le Header : lit `subscription_expires_at`
 * (stocké par `persistResolvedSession` — seedé uniquement au login par code).
 * Intervallé à 1 s, écoute les événements `storage` et `auth_changed`
 * (login/logout) — reste actif après rechargement, valeur en localStorage.
 */
export function useSubscriptionCountdown(): SubscriptionCountdown {
  const [remainingMs, setRemainingMs] = useState<number | null>(computeRemainingMs);

  useEffect(() => {
    let mounted = true;

    const tick = () => {
      if (!mounted) return;
      const next = computeRemainingMs();
      setRemainingMs((prev) => (prev === next ? prev : next));
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    window.addEventListener('storage', tick);
    window.addEventListener('auth_changed', tick);

    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener('storage', tick);
      window.removeEventListener('auth_changed', tick);
    };
  }, []);

  if (remainingMs === null) return { hasExpiry: false, remainingMs: 0, expired: false };
  const clamped = Math.max(0, remainingMs);
  return { hasExpiry: true, remainingMs: clamped, expired: clamped <= 0 };
}

/** Format de la pignose dans le Header : `1h20m`, `5m` ou `30s`. */
export function formatSubscriptionCountdown(
  ms: number,
  expired: boolean,
  t: (key: string) => string
): string {
  if (expired) return t('admin.subscriptionExpired');

  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}
