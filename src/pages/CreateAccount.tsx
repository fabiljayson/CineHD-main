import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, Eye, EyeOff, ArrowLeft, Camera, Shield, RefreshCw } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AvatarSelector from '../components/AvatarSelector';
import {
  broadcastAuthChange,
  clearPendingAuthAction,
  getPendingAuthAction,
  persistResolvedSession,
} from '../utils/accountAuth';
import { getSessionCreationHeaders } from '../utils/sessionClientId';
import { useTurnstileBypass } from '../hooks/useTurnstileBypass';
import { TURNSTILE_SITE_KEY } from '../utils/turnstileKeys';
import { copyText } from '../utils/clipboard';

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

interface Step {
  id: number;
  title: string;
  description: string;
}

interface CreateAccountProps {
  mode?: 'create' | 'link';
}

const CreateAccount: React.FC<CreateAccountProps> = ({ mode = 'create' }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isLinkMode = mode === 'link';
  const [currentStep, setCurrentStep] = useState(1);
  const [mnemonic, setMnemonic] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [username, setUsername] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('');
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [verificationMnemonic, setVerificationMnemonic] = useState('');
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
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
  const pendingAction = getPendingAuthAction();
  const hasValidLinkAction = pendingAction?.type === 'link' && pendingAction.provider === 'bip39';
  const stateReturnTo = typeof location.state === 'object' && location.state && 'returnTo' in location.state && typeof location.state.returnTo === 'string'
    ? location.state.returnTo
    : null;
  const returnPath = stateReturnTo || (hasValidLinkAction ? (pendingAction.returnTo || '/profile') : '/profile');
  const authorizeReturnPath = !isLinkMode && pendingAction?.type === 'oauth-authorize'
    ? pendingAction.returnTo || '/'
    : null;
  const hasLinkSession = Boolean(localStorage.getItem('auth_token'));

  const steps: Step[] = [
    {
      id: 1,
      title: t('auth.bip39.generateTitle'),
      description: t('auth.bip39.generateDesc')
    },
    {
      id: 2,
      title: t('auth.bip39.saveTitle'),
      description: t('auth.bip39.saveDesc')
    },
    {
      id: 3,
      title: t('auth.bip39.profileTitle'),
      description: t('auth.bip39.profileDesc')
    },
    {
      id: 4,
      title: t('auth.bip39.verificationTitle'),
      description: t('auth.bip39.verificationDesc')
    }
  ];

  useEffect(() => {
    if (currentStep === 1 && !mnemonic) {
      generateMnemonic();
    }
  }, [currentStep, mnemonic]);

  useEffect(() => {
    if (!isLinkMode || hasLinkSession) return;
    toast.error(t('auth.bip39.linkSessionMissing', 'Link session not found. Start again from your profile.'));
    navigate('/profile', { replace: true });
  }, [hasLinkSession, isLinkMode, navigate, t]);

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

    if (currentStep === 4) {
      // Rendre Turnstile quand on arrive à l'étape 4
      setTimeout(() => {
        if (window.turnstile) {
          renderTurnstile();
        } else {
          const interval = setInterval(() => {
            if (window.turnstile) {
              clearInterval(interval);
              renderTurnstile();
            }
          }, 200);
        }
      }, 300); // Attendre que le DOM soit rendu
    }
    return () => {
      if (currentStep !== 4 && widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
        setTurnstileToken('');
      }
    };
  }, [currentStep, isTurnstileEnabled, renderTurnstile]);

  const generateMnemonic = async () => {
    setIsGenerating(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/bip39/generate`);
      const data = await response.json();
      
      if (data.success) {
        setMnemonic(data.mnemonic);
      } else {
        console.error('Erreur lors de la génération:', data.error);
      }
    } catch (error) {
      console.error('Erreur réseau:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = async () => {
    if (await copyText(mnemonic)) {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } else {
      console.error('Erreur lors de la copie');
    }
  };

  const handleConfirmed = () => {
    setIsConfirmed(true);
    setCurrentStep(3);
  };

  const handleAvatarSelect = (avatarUrl: string) => {
    // Les URLs dans avatars.ts sont déjà au bon format
    setSelectedAvatar(avatarUrl);
    setShowAvatarModal(false);
  };

  const createAccount = async () => {
    if (!verificationMnemonic || verificationMnemonic !== mnemonic) {
      toast.error(t('auth.secretPhraseMismatch'));
      return;
    }

    if (isTurnstileEnabled && !turnstileToken) {
      toast.error(t('auth.captchaRequired', 'Veuillez compléter la vérification de sécurité'));
      return;
    }

    setIsCreating(true);
    try {
      const currentAuthToken = isLinkMode ? localStorage.getItem('auth_token') : null;
      if (isLinkMode && !currentAuthToken) {
        clearPendingAuthAction();
        throw new Error(t('auth.bip39.linkSessionMissing', 'Link session not found. Start again from your profile.'));
      }

      const response = await fetch(`${API_URL}/api/auth/bip39/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getSessionCreationHeaders(),
        },
        body: JSON.stringify({
          mnemonic,
          username,
          avatar: selectedAvatar,
          turnstileToken
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        if (isLinkMode) {
          const linkResponse = await fetch(`${API_URL}/api/auth/links/bip39`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${currentAuthToken}`,
            },
            body: JSON.stringify({ mnemonic }),
          });

          const linkData = await linkResponse.json();
          if (!linkResponse.ok || !linkData.success) {
            throw new Error(linkData.error || t('auth.bip39.linkFailed', 'Impossible de lier ce compte BIP39.'));
          }

          clearPendingAuthAction();
          navigate(returnPath);
          return;
        }

        // Sauvegarder les informations d'authentification
        persistResolvedSession('bip39', {
          sessionId: data.sessionId || null,
          token: data.token || null,
          account: {
            userType: 'bip39',
            userId: data.userProfile?.id || null,
          },
          authData: {
            userProfile: data.userProfile,
            provider: 'bip39',
          },
        });


        // Déclencher l'événement de changement d'authentification
        broadcastAuthChange();

        // Rediriger vers la page d'accueil ou reprendre le flow OAuth
        navigate(authorizeReturnPath || '/');
      } else {
        toast.error(data.error || t('auth.bip39.creationError'));
      }
    } catch (error) {
      console.error('Erreur lors de la création du compte:', error);
      const message = error instanceof Error ? error.message : null;
      toast.error(message || t('auth.bip39.networkCreationError'));
    } finally {
      setIsCreating(false);
      setTurnstileToken('');
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
    }
  };

  const renderStep1 = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center space-y-6"
    >
      <div className="rounded-lg border border-rule bg-surface p-6">
        <Shield className="mx-auto mb-4 h-10 w-10 text-ink-muted" aria-hidden="true" />
        <h3 className="mb-2 text-base font-semibold text-white">{t('auth.bip39.maxSecurity')}</h3>
        <p className="text-sm leading-relaxed text-ink-muted">
          {t('auth.bip39.maxSecurityDesc')}
        </p>
      </div>

      {isGenerating ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-white motion-reduce:animate-none" aria-hidden="true"></div>
          <span className="ml-3 text-ink-muted">{t('auth.bip39.generating')}</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCurrentStep(2)}
          disabled={!mnemonic || isGenerating}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-white px-6 font-semibold text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          {isGenerating ? t('auth.bip39.generating') : t('common.continue')}
        </button>
      )}
    </motion.div>
  );

  const renderStep2 = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="rounded-lg border border-control/50 bg-surface p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
          <Shield className="h-4 w-4 text-ink-muted" aria-hidden="true" />
          {t('common.important')}
        </h3>
        <p className="text-sm leading-relaxed text-ink-muted">
          {t('auth.bip39.saveWarningDesc')}
        </p>
      </div>

      <div className="rounded-lg border border-rule bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-ink-muted">{t('auth.bip39.yourPhrase12')}</span>
          <button
            type="button"
            onClick={() => setShowMnemonic(!showMnemonic)}
            aria-label={showMnemonic ? t('auth.hidePhrase', 'Masquer la phrase') : t('auth.showPhrase', 'Afficher la phrase')}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-muted transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {showMnemonic ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
        
        <div className="mb-4 rounded-md bg-ground p-4">
          <div className="grid grid-cols-3 gap-2 text-sm">
            {(showMnemonic ? mnemonic.split(' ') : Array(12).fill('•••••')).map((word, index) => (
              <div key={index} className="rounded bg-raised px-2 py-1 text-center">
                <span className="text-xs text-ink-faint">{index + 1}.</span>
                <span className="ml-1 text-white">{word}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={copyToClipboard}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full border border-control px-4 text-sm font-medium text-white transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {isCopied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            {isCopied ? t('common.copied') : t('common.copy')}
          </button>

          <button
            type="button"
            onClick={() => {
              setMnemonic('');
              setIsCopied(false);
              setIsConfirmed(false);
              generateMnemonic();
            }}
            disabled={isGenerating}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-control px-4 text-white transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            title={t('auth.generateNewPhrase')}
            aria-label={t('auth.generateNewPhrase')}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-control/50 bg-surface p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={isConfirmed}
            onChange={(e) => setIsConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-control bg-ground accent-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          />
          <span className="text-sm leading-relaxed text-ink-muted">
            {t('auth.bip39.savedConfirmation')}
          </span>
        </label>
      </div>

      <button
        type="button"
        onClick={handleConfirmed}
        disabled={!isConfirmed}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-white px-6 font-semibold text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        {t('auth.bip39.notedContinue')}
      </button>
    </motion.div>
  );

  const renderStep3 = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Avatar Selection */}
      <div className="text-center">
        <span className="mb-3 block text-sm font-medium text-white/80">{t('auth.bip39.profilePicture')}</span>
        <div className="relative inline-block">
          <button
            type="button"
            aria-label={t('auth.selectAvatar')}
            className="block h-24 w-24 overflow-hidden rounded-full border-2 border-control transition-colors hover:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            onClick={() => setShowAvatarModal(true)}
          >
            <img
              src={selectedAvatar || 'https://as2.ftcdn.net/v2/jpg/05/89/93/27/1000_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.webp'}
              alt={t('common.avatar')}
              className="h-full w-full object-cover"
            />
          </button>
          <button
            type="button"
            aria-label={t('auth.selectAvatar')}
            onClick={() => setShowAvatarModal(true)}
            className="absolute bottom-0 right-0 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Username Input */}
      <div>
        <label htmlFor="bip39-username" className="mb-2 block text-sm font-medium text-white/80">{t('auth.username', "Nom d'utilisateur")}</label>
        <input
          id="bip39-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full rounded-md border border-control bg-ground px-4 py-3 text-white outline-none transition-colors placeholder:text-ink-faint focus:border-white focus-visible:ring-2 focus-visible:ring-white"
          placeholder={t('auth.bip39.usernamePlaceholder')}
          maxLength={20}
        />
      </div>

      <button
        type="button"
        onClick={() => setCurrentStep(4)}
        disabled={!username.trim() || !selectedAvatar}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-white px-6 font-semibold text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        {t('common.continue')}
      </button>
    </motion.div>
  );

  const renderStep4 = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="rounded-lg border border-rule bg-surface p-4">
        <h3 className="mb-2 text-sm font-semibold text-white">{t('auth.bip39.lastStep')}</h3>
        <p className="text-sm leading-relaxed text-ink-muted">
          {t('auth.bip39.confirmDesc')}
        </p>
      </div>

      <div>
        <label htmlFor="bip39-confirm" className="mb-2 block text-sm font-medium text-white/80">
          {t('auth.bip39.confirmPhrase')}
        </label>
        <textarea
          id="bip39-confirm"
          value={verificationMnemonic}
          onChange={(e) => setVerificationMnemonic(e.target.value)}
          className="w-full resize-none rounded-md border border-control bg-ground px-4 py-3 text-white outline-none transition-colors placeholder:text-ink-faint focus:border-white focus-visible:ring-2 focus-visible:ring-white"
          placeholder={t('auth.bip39.phrasePlaceholder')}
          rows={3}
        />
      </div>

      {/* Turnstile CAPTCHA */}
      {isTurnstileEnabled && (
        <div className="flex justify-center overflow-hidden w-full" style={{ maxWidth: '100%' }}>
          <div ref={turnstileRef} className="origin-center scale-[0.85] sm:scale-100" />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => setCurrentStep(3)}
          className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full border border-control px-6 font-medium text-white transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {t('common.back')}
        </button>
        <button
          type="button"
          onClick={createAccount}
          disabled={!verificationMnemonic.trim() || isCreating || (isTurnstileEnabled && !turnstileToken)}
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-white px-6 font-semibold text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          {isCreating ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-b-2 border-black motion-reduce:animate-none" aria-hidden="true"></span>
              {isLinkMode
                ? t('auth.bip39.createAndLinkLoading', 'Création et liaison en cours...')
                : t('auth.bip39.creating')}
            </>
          ) : (
            isLinkMode
              ? t('auth.bip39.createAndLinkButtonShort', 'Créer et lier')
              : t('auth.createAccount', 'Créer le compte')
          )}
        </button>
      </div>
    </motion.div>
  );

  return (
    <div className="min-h-svh bg-ground text-ink">
      <div className="mx-auto w-full max-w-md px-4 py-6 sm:py-10">
        {/* Header */}
        <div className="relative mb-8 text-center">
          <button
            type="button"
            onClick={() => navigate(isLinkMode ? '/link-bip39' : (authorizeReturnPath || '/'))}
            aria-label={t('common.back')}
            className="absolute left-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-full border border-control text-ink-muted transition-colors hover:bg-raised hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {isLinkMode
              ? t('auth.bip39.linkCreateTitle', 'Créer et lier un compte BIP39')
              : t('auth.createAccount', 'Créer un compte')}
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-muted">
            {isLinkMode
              ? t('auth.bip39.linkCreateDescription', 'Générez une phrase secrète puis liez ce nouveau compte BIP39 à votre compte actuel.')
              : t('auth.bip39.secureConnectionDesc')}
          </p>
        </div>

        {/* Progress Steps */}
        <div className="mb-8 flex items-center justify-center gap-2" aria-hidden="true">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                currentStep >= step.id
                  ? 'bg-white text-black'
                  : 'bg-raised text-ink-faint'
              }`}>
                {step.id}
              </div>
              {index < steps.length - 1 && (
                <div className={`mx-2 h-0.5 w-8 transition-colors ${
                  currentStep > step.id ? 'bg-white' : 'bg-raised'
                }`} />
              )}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="rounded-lg bg-surface p-6">
          <div className="mb-6">
            <h2 className="mb-2 text-lg font-semibold text-white">
              {steps[currentStep - 1]?.title}
            </h2>
            <p className="text-sm leading-relaxed text-ink-muted">
              {steps[currentStep - 1]?.description}
            </p>
          </div>

          <AnimatePresence mode="wait">
            {currentStep === 1 && renderStep1()}
            {currentStep === 2 && renderStep2()}
            {currentStep === 3 && renderStep3()}
            {currentStep === 4 && renderStep4()}
          </AnimatePresence>
        </div>
      </div>

      {/* Avatar Selection Modal */}
      <AvatarSelector
        isOpen={showAvatarModal}
        onClose={() => setShowAvatarModal(false)}
        onAvatarSelect={handleAvatarSelect}
        currentAvatar={selectedAvatar}
      />
    </div>
  );
};

export default CreateAccount;
