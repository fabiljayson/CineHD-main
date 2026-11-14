import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { isNoIndexPath } from '../routing/registry';

/**
 * Unique propriétaire de `meta[name=robots]`.
 *
 * La balise existe en dur dans `index.html` (valeur « publique ») : ce
 * composant la met à jour à chaque changement de route plutôt que d'en
 * injecter une seconde via Helmet — deux balises robots concurrentes
 * (« index » statique et « noindex » côté client) laisseraient le choix du
 * résultat au moteur de recherche.
 *
 * Les robots non-JS lisent la balise statique (index) ; les moteurs qui
 * exécutent le JavaScript — Googlebot inclus — voient la valeur finale.
 */
const PUBLIC_ROBOTS =
  'index, follow, noarchive, max-snippet:-1, max-image-preview:large, max-video-preview:-1';
const PRIVATE_ROBOTS = 'noindex, nofollow';

const RouteRobots: React.FC = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    const content = isNoIndexPath(pathname) ? PRIVATE_ROBOTS : PUBLIC_ROBOTS;
    let meta = document.querySelector('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'robots');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', content);
  }, [pathname]);

  return null;
};

export default RouteRobots;
