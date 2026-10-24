import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { SUPPORT_WHATSAPP_URL } from '../config/support';

const WhatsAppPromotion: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="px-5 md:px-10">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 rounded-xl border border-white/10 bg-white/5 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-6 sm:py-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#25D366] text-white" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" className="h-6 w-6" viewBox="0 0 16 16">
            <path d="M13.601 2.326A7.85 7.85 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.9 7.9 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.9 7.9 0 0 0 13.6 2.326zM7.994 14.521a6.6 6.6 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.56 6.56 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592m3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.73.73 0 0 0-.529.247c-.182.198-.691.677-.691 1.654s.71 1.916.81 2.049c.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232" />
          </svg>
        </div>

        <div className="min-w-0">
          <h2 className="text-base font-bold leading-snug text-white sm:text-lg">
            {t('whatsapp.joinCommunity')}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-gray-400">
            <Trans t={t} i18nKey="whatsapp.officialAnnouncements" components={{ strong: <strong /> }} />
            <br />
            👉 <strong>{t('whatsapp.joinUsNow')}</strong>
          </p>
        </div>

        <a
          href={SUPPORT_WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('whatsapp.joinWhatsApp')}
          className="col-start-2 inline-flex min-h-11 items-center justify-center justify-self-start rounded-lg bg-[#1ebe5b] px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#16a54e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black motion-reduce:transition-none sm:col-start-auto sm:justify-self-end"
        >
          {t('whatsapp.joinWhatsApp')}
        </a>
      </div>
    </div>
  );
};

export default WhatsAppPromotion;
