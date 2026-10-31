import React from 'react';
import { useTranslation } from 'react-i18next';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import cinehdLockup from '../../brand/cinehd-lockup.svg';
import LandingBackground from '../components/LandingBackground';
import { LANDING_BACKGROUNDS, LANDING_BACKGROUND_CREDITS } from '../data/backgroundImages';

const LandingPage: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="relative isolate flex min-h-svh flex-col bg-ground text-ink">
      <LandingBackground images={LANDING_BACKGROUNDS} />
      <header className="relative z-10 flex w-full items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <Link
          to="/"
          aria-label="CineHD"
          className="font-wordmark text-lg tracking-[0.12em] text-white"
        >
          CINEHD
        </Link>
        <Link
          to="/login"
          className="min-h-11 inline-flex items-center text-sm font-medium text-white/85 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {t('landing.ctaLogin')}
        </Link>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-screen-2xl flex-1 flex-col px-5 sm:px-8 lg:px-12">
        <section className="grid flex-1 items-center gap-8 py-10 sm:gap-12 lg:grid-cols-2 lg:gap-16 lg:py-12">
          <div className="order-2 lg:order-1">
            <h1 className="max-w-[12ch] text-balance font-display text-5xl font-semibold leading-[0.98] tracking-[-0.04em] sm:text-7xl">
              {t('landing.title')}
            </h1>
            <p className="mt-6 max-w-lg text-base leading-relaxed text-white/85 sm:text-lg">
              {t('landing.subtitle')}
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link
                to="/home"
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              >
                {t('landing.ctaExplore')}
              </Link>
              <Link
                to="/login?tab=create"
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-control px-6 text-sm font-medium text-white transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              >
                {t('landing.ctaCreate')}
              </Link>
            </div>
          </div>

          <div className="order-1 flex items-center justify-center lg:order-2">
            <img
              src={cinehdLockup}
              alt=""
              aria-hidden="true"
              className="h-auto w-full max-w-[28rem]"
            />
          </div>
        </section>

        <section
          aria-label={t('landing.catalogue')}
          className="flex flex-wrap gap-x-8 gap-y-3 pb-8 text-base font-medium text-white/85 sm:gap-x-12 sm:text-lg"
        >
          <span>{t('landing.films')}</span>
          <span>{t('landing.series')}</span>
          <span>{t('landing.anime')}</span>
        </section>
      </main>

      <footer className="relative z-10 flex flex-col gap-3 px-5 py-6 text-sm text-white/85 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
        <span>{t('landing.footerNote')}</span>
        <details>
          <summary className="cursor-pointer transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            {t('landing.imageCredits')}
          </summary>
          <ul className="mt-2 space-y-1">
            {LANDING_BACKGROUND_CREDITS.map((credit) => (
              <li key={credit.href}>
                <a
                  href={credit.href}
                  target="_blank"
                  rel="noreferrer"
                  className="transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {t(credit.translationKey)}
                </a>
              </li>
            ))}
          </ul>
        </details>
        <nav aria-label={t('landing.legalLinks')} className="flex gap-5">
          <Link
            to="/terms-of-service"
            className="transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {t('landing.footerTerms')}
          </Link>
          <Link
            to="/privacy"
            className="transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {t('landing.footerPrivacy')}
          </Link>
        </nav>
      </footer>
    </div>
  );
};

export default LandingPage;
