import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Cookie } from 'lucide-react';
import { getCookieConsent, setCookieConsent, type CookieConsent } from '../utils/cookieConsent';
import { initAnalytics } from '../utils/analytics';

/**
 * Bannière de consentement RGPD (choix unique par appareil).
 *
 * Non modale : elle ne bloque jamais la navigation. "Accepter" autorise le
 * chargement des mesures tierces (`initAnalytics` est idempotent — `main.tsx`
 * a déjà tenté au chargement et n'a rien chargé sans consentement) ;
 * "Refuser" (ou aucune réponse) laisse les scripts tiers coupés.
 */
const CookieConsentBanner: React.FC = () => {
  const { t } = useTranslation();
  const [consent, setConsent] = useState<CookieConsent | null>(() => getCookieConsent());

  if (consent !== null) return null;

  const decide = (value: CookieConsent) => {
    // Écrire d'abord : `initAnalytics` relit le stockage.
    setCookieConsent(value);
    setConsent(value);
    if (value === 'accepted') initAnalytics();
  };

  return (
    <div
      role="region"
      aria-label={t('cookieConsent.title')}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-control bg-surface/95 backdrop-blur-md"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Cookie className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">{t('cookieConsent.title')}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              {t('cookieConsent.message')}{' '}
              <Link
                to="/privacy"
                className="text-white underline underline-offset-2 hover:text-white/80"
              >
                {t('cookieConsent.learnMore')}
              </Link>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-3">
          <button
            type="button"
            onClick={() => decide('declined')}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-control px-5 font-medium text-white transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {t('cookieConsent.decline')}
          </button>
          <button
            type="button"
            onClick={() => decide('accepted')}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 font-semibold text-black transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {t('cookieConsent.accept')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CookieConsentBanner;
