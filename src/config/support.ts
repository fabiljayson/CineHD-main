/**
 * Point de contact support unique de CineHD.
 *
 * Le canal Telegram n'existe plus : tout le front-point (header, footer, pages
 * d'aide, popups, message hors-ligne du service worker…) passe par ce module.
 * Une seule constante à changer pour retargeter le support.
 */

/** Numéro WhatsApp au format international sans « + » (pays + numéro). */
export const SUPPORT_WHATSAPP_PHONE = '237678426969';

/** Numéro affiché aux utilisateurs, pour les textes non cliquables. */
export const SUPPORT_WHATSAPP_DISPLAY = '+237 678 42 69 69';

/** Message pré-rempli par défaut des liens de support. */
export const SUPPORT_WHATSAPP_MESSAGE = "Bonjour, j'ai besoin d'aide sur CineHD.";

/** Message pré-rempli dédié à la création de compte depuis la page /login. */
export const CREATE_ACCOUNT_WHATSAPP_MESSAGE = 'Bonjour, je souhaite créer un compte CineHD.';

const envUrl = import.meta.env.VITE_SUPPORT_WHATSAPP_URL;
const hasEnvUrl = typeof envUrl === 'string' && envUrl.trim().length > 0;

/** Construit un lien wa.me avec un message pré-rempli. */
export function buildWhatsAppUrl(message: string): string {
  return `https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`;
}

/** Lien de support général (env prioritaire, sinon message par défaut). */
export const SUPPORT_WHATSAPP_URL: string = hasEnvUrl ? envUrl.trim() : buildWhatsAppUrl(SUPPORT_WHATSAPP_MESSAGE);

/** Lien « créer un compte » affiché sur la page de connexion. */
export const CREATE_ACCOUNT_WHATSAPP_URL: string = buildWhatsAppUrl(CREATE_ACCOUNT_WHATSAPP_MESSAGE);
