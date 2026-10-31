import React, { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Clapperboard, UserPlus } from 'lucide-react';

/**
 * Mur de lecture : affiché à la place d'une page de lecture quand le visiteur
 * n'est pas connecté.
 *
 * On n'interdit pas le catalogue — un visiteur peut chercher, ouvrir une fiche,
 * consulter les détails. On refuse seulement le lecteur, qui est la seule chose
 * qui coûte de l'argent à servir. C'est aussi la meilleure façon de convertir :
 * la personne voit le titre, comprend pourquoi, et reprend exactement là où
 * elle s'était arrêtée grâce à `returnTo`.
 *
 * Style : tokens CineHD (.taste-skill/DIRECTION.md) — fond noir, une seule
 * action pleine (blanc), l'or réservé aux données. Pas de halo, pas de dégradé.
 */
interface PlaybackWallProps {
  /** URL à reprendre après connexion (chemin interne uniquement). */
  returnTo?: string;
  /** Titre du média, si la page le connaît déjà. */
  contextLabel?: string;
}

const PlaybackWall: React.FC<PlaybackWallProps> = ({ returnTo, contextLabel }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const primaryRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  const handleBack = useCallback(() => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/');
  }, [navigate]);

  // Un `returnTo` ouvert (//evil.tld, javascript:, data:) permettrait de renvoyer
  // l'utilisateur vers l'extérieur après connexion. On n'accepte qu'un chemin
  // relatif de l'application.
  const safeReturnTo = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
    ? returnTo
    : undefined;

  const loginHref = safeReturnTo ? `/login?returnTo=${encodeURIComponent(safeReturnTo)}` : '/login';
  const createHref = safeReturnTo
    ? `/login?tab=create&returnTo=${encodeURIComponent(safeReturnTo)}`
    : '/login?tab=create';

  return (
    <main data-playback-wall className="flex min-h-screen flex-col items-center justify-center bg-ground px-6 py-16">
      <div className="w-full max-w-md rounded-lg bg-surface p-8 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-raised">
          <Clapperboard className="h-6 w-6 text-ink-faint" aria-hidden="true" />
        </div>

        <h1 className="text-xl font-semibold text-ink">
          {t('playback.gate.title', 'Connexion requise pour regarder')}
        </h1>

        <p className="mt-3 text-sm leading-6 text-ink-muted">
          {contextLabel
            ? t('playback.gate.bodyNamed', '« {{title}} » est réservé aux membres connectés. Le catalogue, les détails et la recherche restent librement accessibles.', { title: contextLabel })
            : t('playback.gate.body', 'La lecture est réservée aux membres connectés. Le catalogue, les détails et la recherche restent librement accessibles.')}
        </p>

        <a
          ref={primaryRef}
          href={loginHref}
          className="mt-7 inline-flex h-9 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-[#e5e5e5]"
        >
          {t('playback.gate.signIn', 'Se connecter')}
        </a>

        <div className="mt-3">
          <a
            href={createHref}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-control px-6 text-sm font-medium text-ink transition-colors hover:bg-raised"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            {t('playback.gate.createAccount', 'Créer un compte')}
          </a>
        </div>

        <button
          type="button"
          onClick={handleBack}
          className="mt-6 inline-flex items-center gap-2 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('playback.gate.goBack', 'Revenir en arrière')}
        </button>
      </div>

      <p className="mt-6 max-w-md text-center text-xs leading-5 text-ink-faint">
        {t('playback.gate.freeNote', 'Un compte est gratuit et permet aussi de garder votre progression et vos listes.')}
      </p>
    </main>
  );
};

export default PlaybackWall;
