import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import groupeIxLogo from '@/assets/brand/groupe-ix.svg';
import { useIntro } from '../context/IntroContext';
import { readLocalStorage, writeLocalStorage } from '../utils/browserStorage';
import { getOverlayPortalRoot } from '../utils/overlayPortal';
import { SUPPORT_WHATSAPP_DISPLAY, SUPPORT_WHATSAPP_URL } from '../config/support';

export const IX_WHATSAPP_URL = SUPPORT_WHATSAPP_URL;
// Une fois fermé ou suivi, le popup ne revient plus. Clé distincte de l'ancien
// popup Telegram : le changement de canal est une annonce à réafficher.
const SEEN_KEY = 'ix_whatsapp_announcement_seen_v1';
const SHOW_DELAY_MS = 1500;

interface WhatsAppAnnouncementPopupProps {
  /** Vrai là où le popup doit attendre : lecteur, Wrapped, OAuth, autre popup. */
  suspended: boolean;
}

/**
 * Popup d'arrivée qui annonce que le support est désormais sur WhatsApp.
 * Attend la fin de l'intro et des routes suspendues avant de s'ouvrir.
 */
const WhatsAppAnnouncementPopup: React.FC<WhatsAppAnnouncementPopupProps> = ({ suspended }) => {
  const { t } = useTranslation();
  const { introCompleted } = useIntro();
  const [seen, setSeen] = useState(() => readLocalStorage(SEEN_KEY) === 'true');
  const [open, setOpen] = useState(false);
  const joinRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (seen || suspended || !introCompleted) return;
    const timer = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [seen, suspended, introCompleted]);

  const dismiss = useCallback(() => {
    setOpen(false);
    setSeen(true);
    writeLocalStorage(SEEN_KEY, 'true');
  }, []);

  // Pendant l'ouverture : Échap ferme, la page ne défile plus et le bouton
  // principal prend le focus.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    joinRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, dismiss]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="ix-whatsapp-announcement"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/80 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) dismiss();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ix-whatsapp-announcement-title"
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 text-center shadow-2xl sm:p-8"
          >
            <button
              type="button"
              onClick={dismiss}
              aria-label={t('common.close')}
              className="absolute right-3 top-3 rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>

            <img src={groupeIxLogo} alt="" className="mx-auto mb-5 h-20 w-20" />

            <h2 id="ix-whatsapp-announcement-title" className="text-2xl font-bold text-white">
              {t('whatsapp.announcementTitle')}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-gray-300 sm:text-base">
              <Trans t={t} i18nKey="whatsapp.announcementBody" components={{ strong: <strong className="text-white" /> }} />
            </p>
            <p className="mt-2 font-mono text-sm text-emerald-300">{SUPPORT_WHATSAPP_DISPLAY}</p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <a
                ref={joinRef}
                href={SUPPORT_WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={dismiss}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#25D366] px-5 py-3 font-semibold text-white transition-colors hover:bg-[#1ebe5b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="h-5 w-5 shrink-0" aria-hidden="true">
                  <path d="M13.601 2.326A7.85 7.85 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.9 7.9 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.9 7.9 0 0 0 13.6 2.326zM7.994 14.521a6.6 6.6 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.56 6.56 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592m3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.73.73 0 0 0-.529.247c-.182.198-.691.677-.691 1.654s.71 1.916.81 2.049c.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232" />
                </svg>
                {t('whatsapp.announcementJoin')}
              </a>
              <button
                type="button"
                onClick={dismiss}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white/10 px-5 py-3 font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {t('whatsapp.announcementLater')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    getOverlayPortalRoot(),
  );
};

export default WhatsAppAnnouncementPopup;
