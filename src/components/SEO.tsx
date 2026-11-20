import React, { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { SITE_URL, buildSiteUrl } from '../config/runtime';

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  ogImage?: string;
  ogUrl?: string;
  ogType?: 'website' | 'video.movie' | 'video.tv_show' | 'article';
  twitterCard?: 'summary' | 'summary_large_image';
  canonical?: string;
  hreflangLinks?: Array<{
    lang: string;
    href: string;
  }>;
}

/**
 * URL de la page courante sur le domaine de référence (`SITE_URL`) : sans ça,
 * le canonique par défaut désignait la page d'accueil pour toutes les pages
 * (signal de contenu dupliqué), y compris les miroirs du domaine.
 */
const currentPageUrl = (): string => {
  if (typeof window === 'undefined') return SITE_URL;
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '' ? SITE_URL : buildSiteUrl(path);
};

const SEO: React.FC<SEOProps> = (props) => {
  const { t } = useTranslation();
  const pageUrl = currentPageUrl();

  // Les balises og/twitter statiques d'index.html (data-fallback) servent aux
  // crawlers sans JavaScript et aux pages sans <SEO>. Une page qui fournit ses
  // propres balises doit les retirer : Helmet n'écrase pas les balises étrangères
  // au DOM, donc deux og:url cohabiteraient et les scrapers qui retiennent la
  // première partageraient toujours la racine du site. Au démontage, les
  // replis reviennent : une page sans <SEO> atteinte par navigation SPA ne
  // doit pas se retrouver sans aucune balise og.
  useEffect(() => {
    const fallbacks = Array.from(document.querySelectorAll('meta[data-fallback]'));
    fallbacks.forEach((meta) => meta.remove());
    return () => {
      fallbacks.forEach((meta) => document.head.appendChild(meta));
    };
  }, []);
  const {
    title = t('seo.defaultTitle'),
    description = t('seo.defaultDescription'),
    keywords = t('seo.defaultKeywords'),
    ogImage = '/movix.png',
    ogUrl = pageUrl,
    ogType = 'website',
    twitterCard = 'summary_large_image',
    canonical = pageUrl,
    hreflangLinks = [
      { lang: 'fr-FR', href: pageUrl },
      { lang: 'fr-BE', href: pageUrl },
      { lang: 'fr-CH', href: pageUrl },
      { lang: 'fr-CA', href: pageUrl },
      { lang: 'x-default', href: pageUrl },
    ],
  } = props;
  const siteName = 'CineHD';
  
  return (
    <Helmet>
      {/* Balises Title et Meta de base */}
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords} />
      <link rel="canonical" href={canonical} />
      
      {/* Balises hreflang */}
      {hreflangLinks.map((link) => (
        <link key={link.lang} rel="alternate" hrefLang={link.lang} href={link.href} />
      ))}
      
      {/* Open Graph */}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={ogUrl} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:site_name" content={siteName} />
      
      {/* Twitter Card */}
      <meta name="twitter:card" content={twitterCard} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
      
      {/* Autres balises importantes.
          `robots` est volontairement absent : RouteRobots est son unique
          propriétaire (mêmes raisons pour le viewport et charset statiques). */}
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta httpEquiv="Content-Type" content="text/html; charset=utf-8" />
    </Helmet>
  );
};

export default SEO; 
