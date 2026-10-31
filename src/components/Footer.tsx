import { Globe, Scale, Shield, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import './Footer.css';

type FooterLink = {
  label: string;
  icon: LucideIcon;
} & ({ to: string; href?: never } | { href: string; to?: never });

/**
 * Pied de page minimal : uniquement les pages d'information.
 * Les colonnes de marque, la colonne communauté, le bloc « Built with »,
 * l'avertissement sur le contenu et les crédits ont été retirés.
 */
const informationLinks: FooterLink[] = [
  { label: 'nav.privacy', to: '/privacy', icon: Shield },
  { label: 'auth.termsOfService', to: '/terms-of-service', icon: Scale },
  { label: 'footer.ourUrls', href: 'https://movix.online', icon: Globe },
];

const linkClassName = 'inline-flex min-h-11 items-center gap-2.5 rounded-sm py-2 text-sm text-ink-muted transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white motion-reduce:transition-none';

const Footer = () => {
  const { t } = useTranslation();

  return (
    <footer className="relative z-10 border-t border-rule bg-black py-4 text-ink-muted">
      <div className="mx-auto max-w-6xl px-6 sm:px-10 lg:px-12">
        <nav aria-label={t('footer.information')}>
          <ul className="flex flex-wrap items-center justify-center gap-x-6 sm:justify-start">
            {informationLinks.map(({ label, icon: Icon, to, href }) => (
              <li key={label}>
                {to !== undefined ? (
                  <Link to={to} className={`footer-navigation-link ${linkClassName}`}>
                    <Icon size={20} absoluteStrokeWidth className="footer-navigation-icon shrink-0" aria-hidden="true" />
                    <span>{t(label)}</span>
                  </Link>
                ) : (
                  <a href={href} target="_blank" rel="noopener noreferrer" className={`footer-navigation-link ${linkClassName}`}>
                    <Icon size={20} absoluteStrokeWidth className="footer-navigation-icon shrink-0" aria-hidden="true" />
                    <span>{t(label)}</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
};

export default Footer;
