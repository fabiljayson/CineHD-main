import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Pré-order — page de prise de commande future (offre VIP / bundles).
 * Route : /pre-order — accessible sans session (site public).
 */
const PreOrder: React.FC = () => {
  const { t } = useTranslation();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
      <h1 className="text-4xl font-bold text-white">{t('preorder.title')}</h1>
      <p className="mt-4 text-lg text-gray-400">{t('preorder.description')}</p>
      <a
        href="/login"
        className="mt-8 inline-block rounded-full bg-red-600 px-8 py-3 font-semibold text-white hover:bg-red-700"
      >
        {t('preorder.loginCta')}
      </a>
    </main>
  );
};

export default PreOrder;
