import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Eye, EyeOff, Shield, LogIn, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  broadcastAuthChange,
  clearPendingAuthAction,
  getPendingAuthAction,
  persistResolvedSession,
} from '../utils/accountAuth';
import { getSessionCreationHeaders } from '../utils/sessionClientId';
import { useTurnstileBypass } from '../hooks/useTurnstileBypass';
import { TURNSTILE_SITE_KEY } from '../utils/turnstileKeys';
const API_URL = import.meta.env.VITE_MAIN_API;

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

interface LoginBip39Props {
  mode?: 'login' | 'link';
}

const LoginBip39: React.FC<LoginBip39Props> = ({ mode = 'login' }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mnemonic, setMnemonic] = useState('');
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Dispense admin. Elle ne joue que pour une session déjà ouverte — se
  // connecter ou créer un compte se fait avant que le serveur ne sache qui
  // frappe, donc le challenge reste entier dans le cas courant. Voir
  // `utils/turnstileBypass.ts`.
  const turnstileBypass = useTurnstileBypass();
  const isTurnstileEnabled = typeof TURNSTILE_SITE_KEY === 'string'
    && TURNSTILE_SITE_KEY.trim().length > 0
    && turnstileBypass !== 'bypass';
  const isLinkMode = mode === 'link';
  const pendingAction = getPendingAuthAction();
  const hasValidLinkAction = pendingAction?.type === 'link' && pendingAction.provider === 'bip39';
  const returnPath = hasValidLinkAction ? (pendingAction.returnTo || '/profile') : '/profile';
  const authorizeReturnPath = !isLinkMode && pendingAction?.type === 'oauth-authorize'
    ? pendingAction.returnTo || '/'
    : null;
  const hasLinkSession = Boolean(localStorage.getItem('auth_token'));

  const renderTurnstile = useCallback(() => {
    if (!isTurnstileEnabled) return;
    if (window.turnstile && turnstileRef.current && !widgetIdRef.current) {
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'dark',
        callback: (token: string) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
      });
    }
  }, [isTurnstileEnabled]);

  useEffect(() => {
    if (!isTurnstileEnabled) return;

    if (window.turnstile) {
      renderTurnstile();
    } else {
      const interval = setInterval(() => {
        if (window.turnstile) {
          clearInterval(interval);
          renderTurnstile();
        }
      }, 200);
      return () => clearInterval(interval);
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [isTurnstileEnabled, renderTurnstile]);

  useEffect(() => {
    if (!isLinkMode) return;
    if (hasLinkSession) return;
    setError(t('auth.bip39.linkSessionMissing', 'Link session not found. Start again from your profile.'));
  }, [hasLinkSession, isLinkMode, t]);

  const handleBack = () => {
    if (isLinkMode) {
      clearPendingAuthAction();
    }
    navigate(isLinkMode ? returnPath : (authorizeReturnPath || '/'));
  };

  const handleLogin = async () => {
    if (!mnemonic.trim()) {
      setError(t('auth.bip39.enterPhrasePlease'));
      return;
    }

    if (isTurnstileEnabled && !turnstileToken) {
      setError(t('auth.captchaRequired', 'Veuillez compléter la vérification de sécurité'));
      return;
    }

    if (isLinkMode && !hasLinkSession) {
      setError(t('auth.bip39.linkSessionMissing', 'Link session not found. Start again from your profile.'));
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      if (isLinkMode) {
        const authToken = localStorage.getItem('auth_token');
        if (!authToken) {
          clearPendingAuthAction();
          throw new Error(t('auth.bip39.linkSessionMissing', 'Link session not found. Start again from your profile.'));
        }

        const linkResponse = await fetch(`${API_URL}/api/auth/links/bip39`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify({ mnemonic: mnemonic.trim() }),
        });

        const linkData = await linkResponse.json();
        if (!linkResponse.ok || !linkData.success) {
          throw new Error(linkData.error || t('auth.bip39.linkFailed', 'Impossible de lier ce compte BIP39.'));
        }

        clearPendingAuthAction();
        navigate(returnPath);
        return;
      }

      const loginResponse = await fetch(`${API_URL}/api/auth/bip39/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getSessionCreationHeaders(),
        },
        body: JSON.stringify({ mnemonic: mnemonic.trim(), turnstileToken }),
      });

      const loginData = await loginResponse.json();

      if (loginData.success) {
        const userId = loginData.account?.userId || loginData.userId;
        const token = loginData.token;

        if (!token || !userId) {
            throw new Error('Réponse de connexion incomplète');
        }

        persistResolvedSession('bip39', loginData);
        broadcastAuthChange();
        setTimeout(() => {
          window.location.href = authorizeReturnPath || '/';
        }, 100);
      } else {
        setError(loginData.error || t('auth.bip39.invalidPhrase'));
      }
    } catch (loginError) {
      console.error('Erreur lors de la connexion:', loginError);
      const message = loginError instanceof Error ? loginError.message : null;
      setError(message || t('auth.bip39.networkError'));
    } finally {
      setIsLoading(false);
      setTurnstileToken('');
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
    }
  };

  return (
    <div className="min-h-svh bg-ground text-ink">
      <div className="mx-auto w-full max-w-md px-4 py-6 sm:py-10">
        <div className="relative mb-8 text-center">
          <button
            type="button"
            onClick={handleBack}
            aria-label={t('common.back')}
            className="absolute left-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-full border border-control text-ink-muted transition-colors hover:bg-raised hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>

          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {isLinkMode
              ? t('auth.bip39.linkTitle', 'Lier un compte BIP39')
              : t('auth.secureLogin')}
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-muted">
            {isLinkMode
              ? t('auth.bip39.linkDescription', 'Vérifiez votre phrase secrète pour lier ce compte BIP39.')
              : t('auth.connectWithSecretPhrase')}
          </p>
        </div>

        <div className="rounded-lg bg-surface p-6">
          <div className="mb-6">
            <div className="mb-6 rounded-lg border border-rule bg-ground p-4">
              <Shield className="mx-auto mb-3 h-8 w-8 text-ink-muted" aria-hidden="true" />
              <p className="mb-3 text-center text-sm leading-relaxed text-ink-muted">
                {isLinkMode
                  ? t('auth.bip39.enter12WordsToLink', 'Entrez vos 12 mots pour lier ce compte BIP39.')
                  : t('auth.bip39.enter12WordsToAccess')}
              </p>
              <div className="rounded-md border border-control/50 bg-surface p-3">
                <p className="text-center text-xs leading-relaxed text-ink-faint">
                  {t('auth.bip39.spaceWarning')}
                </p>
              </div>
            </div>

            <div>
              <label htmlFor="bip39-mnemonic" className="mb-2 block text-sm font-medium text-white/80">
                {t('auth.bip39.phraseLabel')}
              </label>
              <div className="relative">
                <textarea
                  id="bip39-mnemonic"
                  value={mnemonic}
                  onChange={(e) => setMnemonic(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleLogin(); } }}
                  className="w-full resize-none rounded-md border border-control bg-ground px-4 py-3 pr-12 text-white outline-none transition-colors placeholder:text-ink-faint focus:border-white focus-visible:ring-2 focus-visible:ring-white"
                  placeholder={t('auth.bip39.phrasePlaceholder')}
                  rows={3}
                />
                <button
                  type="button"
                  onClick={() => setShowMnemonic(!showMnemonic)}
                  aria-label={showMnemonic ? t('auth.hidePhrase', 'Masquer la phrase') : t('auth.showPhrase', 'Afficher la phrase')}
                  className="absolute right-1 top-1 inline-flex h-10 w-10 items-center justify-center rounded-md text-ink-muted transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {showMnemonic ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="mt-4 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </p>
            )}
          </div>

          <div className="space-y-4">
            {isTurnstileEnabled && (
              <div className="flex justify-center overflow-hidden w-full" style={{ maxWidth: '100%' }}>
                <div ref={turnstileRef} className="origin-center scale-[0.85] sm:scale-100" />
              </div>
            )}

            <button
              type="button"
              onClick={handleLogin}
              disabled={!mnemonic.trim() || isLoading || (isTurnstileEnabled && !turnstileToken) || (isLinkMode && !hasLinkSession)}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-6 font-semibold text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              {isLoading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-b-2 border-black motion-reduce:animate-none" aria-hidden="true"></span>
                  {isLinkMode
                    ? t('auth.bip39.linking', 'Liaison en cours...')
                    : t('auth.bip39.connecting')}
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" aria-hidden="true" />
                  {isLinkMode
                    ? t('auth.bip39.linkButton', 'Lier le compte')
                    : t('auth.login', 'Se connecter')}
                </>
              )}
            </button>

            {!isLinkMode && (
              <div className="space-y-3">
                <p className="text-center text-xs text-ink-faint">
                  {t('auth.dontHaveAccount', "Vous n'avez pas de compte ?")}
                </p>
                <button
                  type="button"
                  onClick={() => { navigate('/create-account'); }}
                  disabled={isLoading}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-control px-4 font-medium text-white transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  {t('auth.createSecureAccount', 'Créer un compte sécurisé')}
                </button>
              </div>
            )}

            {isLinkMode && (
              <div className="space-y-3">
                <p className="text-center text-xs text-ink-faint">
                  {t('auth.bip39.noAccountYet', 'Pas encore de compte BIP39 ? Vous pouvez en créer un puis le lier directement.')}
                </p>
                <button
                  type="button"
                  onClick={() => { navigate('/link-bip39/create', { state: { returnTo: returnPath } }); }}
                  disabled={isLoading || !hasLinkSession}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-control px-4 font-medium text-white transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {t('auth.bip39.createAndLinkButton', 'Créer et lier un nouveau compte BIP39')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginBip39;
