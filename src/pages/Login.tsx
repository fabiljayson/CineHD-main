import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import cinehdLockup from '../../brand/cinehd-lockup.svg';
import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  Copy,
  KeyRound,
  Loader2,
  Lock,
  MessageCircle,
  Smartphone,
  Tag,
  UserPlus,
  XCircle,
} from 'lucide-react';

import TurnstileWidget from '../components/TurnstileWidget';
import { useTurnstileBypass } from '../hooks/useTurnstileBypass';
import { TURNSTILE_SITE_KEY } from '../utils/turnstileKeys';
import { copyText } from '../utils/clipboard';
import {
  broadcastAuthChange,
  getPendingAuthAction,
  persistResolvedSession,
} from '../utils/accountAuth';
import { CREATE_ACCOUNT_WHATSAPP_URL } from '../config/support';
import {
  checkoutWithCamPay,
  createAccountRequest,
  getAccountPlans,
  getAccountRequestStatus,
  getCheckoutStatus,
  getSubscriptionBargains,
  loginWithAccountCode,
  loginWithAccountPassword,
  type AccountPaymentMethod,
  type AccountPlan,
  type AccountPlanId,
  type AccountRequestStatus,
  type AccountRequestSummary,
  type CamPayCheckoutSession,
  type SubscriptionBargain,
} from '../services/accountRequestsService';

import './Login.css';

type TabKey = 'code' | 'password' | 'create';

const TAB_META: { key: TabKey; labelKey: string }[] = [
  { key: 'code', labelKey: 'login.tabCode' },
  { key: 'password', labelKey: 'login.tabPassword' },
  { key: 'create', labelKey: 'login.tabCreate' },
];

/** Groupe les milliers sans dépendre de la locale du navigateur : 16 000 FCFA. */
const formatFcfa = (value: number) => `${Math.round(value)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const planLabelKey = (id: AccountPlanId) =>
  (id === 'week' ? 'login.planWeek' : id === 'month' ? 'login.planMonth' : 'login.planYear');

/**
 * Marque des opérateurs, sur les couleurs officielles uniquement : le pavé
 * reprend le nom court de l'opérateur, jamais un logo dessiné à la main.
 * Une méthode inconnue retombe sur l'icône Smartphone (voir le rendu).
 */
const methodBrand: Partial<Record<AccountPaymentMethod['id'], { mark: string; bg: string; fg: string }>> = {
  mtn_momo: { mark: 'MTN', bg: '#FFCB05', fg: '#000000' },
  orange_money: { mark: 'O', bg: '#FF7900', fg: '#FFFFFF' },
};

const isNetworkError = (error: unknown) => error instanceof TypeError;

/**
 * Page d'entrée du compte CineHD.
 *
 * Deux volets : « J'ai un code » (le code délivré après paiement sert de mot
 * de passe et ouvre une session normale, réutilisable sur tous les appareils)
 * et « Créer un compte » (offre, curseur de prix, mobile money, référence).
 */
const Login: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const turnstileBypass = useTurnstileBypass();
  const isTurnstileEnabled = typeof TURNSTILE_SITE_KEY === 'string'
    && TURNSTILE_SITE_KEY.trim().length > 0
    && turnstileBypass !== 'bypass';

  const pendingAuthAction = getPendingAuthAction();
  const authorizeReturnPath = pendingAuthAction?.type === 'oauth-authorize'
    ? pendingAuthAction.returnTo || '/'
    : null;

  // `?tab=create` permet d'ouvrir directement le volet de création depuis les
  // boutons « Créer un compte » (profil, Wrapped, autorisation OAuth).
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>(() => {
    const requested = searchParams.get('tab');
    return requested === 'create' || requested === 'password' ? requested : 'code';
  });

  const handleTabChange = (nextTab: TabKey) => {
    setTab(nextTab);
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab !== 'code') {
      nextParams.set('tab', nextTab);
    } else {
      nextParams.delete('tab');
    }
    setSearchParams(nextParams, { replace: true });
  };

  // === Connexion par code ===
  const [code, setCode] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginToken, setLoginToken] = useState('');
  const [loginResetSignal, setLoginResetSignal] = useState(0);

  // === Connexion par pseudo + mot de passe (staff / admin uniquement) ===
  const [staffUsername, setStaffUsername] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [isPasswordLoggingIn, setIsPasswordLoggingIn] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordToken, setPasswordToken] = useState('');
  const [passwordResetSignal, setPasswordResetSignal] = useState(0);

  // === Offres de renouvellement publiques ===
  const [bargains, setBargains] = useState<SubscriptionBargain[]>([]);

  useEffect(() => {
    let mounted = true;
    getSubscriptionBargains()
      .then((result) => {
        if (mounted) setBargains(result);
      })
      .catch(() => {
        // Les offres sont un complément public : leur absence ne bloque jamais
        // la connexion ni la création de compte.
      });

    return () => {
      mounted = false;
    };
  }, []);

  // === Création de compte ===
  const [plans, setPlans] = useState<AccountPlan[]>([]);
  const [methods, setMethods] = useState<AccountPaymentMethod[]>([]);
  const [plansError, setPlansError] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState<AccountPlanId>('month');
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const [payerMsisdn, setPayerMsisdn] = useState('');
  const [reference, setReference] = useState('');
  const [username, setUsername] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitToken, setSubmitToken] = useState('');
  const [submitResetSignal, setSubmitResetSignal] = useState(0);
  const [createdRequest, setCreatedRequest] = useState<AccountRequestSummary | null>(null);
  const [requestStatus, setRequestStatus] = useState<AccountRequestStatus | 'failed' | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  // Paiement en ligne CamPay (collecte push USSD) : session en cours + code de
  // connexion servi une seule fois au moment du paiement confirmé.
  const [campayEnabled, setCampayEnabled] = useState(false);
  const [checkoutSession, setCheckoutSession] = useState<CamPayCheckoutSession | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    getAccountPlans()
      .then((payload) => {
        if (!mounted) return;
        setPlans(payload.plans);
        setMethods(payload.methods);
        setCampayEnabled(Boolean(payload.campay));
        setAmounts(Object.fromEntries(payload.plans.map((plan) => [plan.id, plan.maxFcfa])));
        if (payload.plans.length > 0) {
          const preferred = payload.plans.find((plan) => plan.id === 'month') || payload.plans[0];
          setSelectedPlanId(preferred.id);
        }
      })
      .catch((error) => {
        if (!mounted) return;
        setPlansError(isNetworkError(error) ? t('login.errorNetwork') : t('login.errorGeneric'));
      });

    return () => {
      mounted = false;
    };
  }, [t]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) || plans[0] || null,
    [plans, selectedPlanId]
  );

  const selectedAmount = selectedPlan
    ? (amounts[selectedPlan.id] ?? selectedPlan.maxFcfa)
    : 0;

  const isBelowFloor = Boolean(selectedPlan && selectedAmount < selectedPlan.floorFcfa);

  // Piste du curseur : rouge sous le plancher (zone interdite), or jusqu'au
  // montant choisi, gris ensuite. Un seul gradient, déclaré sur WebKit comme
  // sur Gecko via --login-range-track, pour que la zone bloquée soit identique.
  const rangeTrack = useMemo(() => {
    if (!selectedPlan) return 'rgba(255, 255, 255, 0.15)';
    const span = Math.max(1, selectedPlan.maxFcfa - selectedPlan.sliderMinFcfa);
    const toPct = (value: number) =>
      Math.max(0, Math.min(100, ((value - selectedPlan.sliderMinFcfa) / span) * 100));
    const valuePct = toPct(selectedAmount);
    const floorPct = toPct(selectedPlan.floorFcfa);
    const blockedEnd = isBelowFloor ? Math.min(valuePct, floorPct) : floorPct;
    const goldEnd = Math.max(blockedEnd, valuePct);
    return [
      'linear-gradient(to right,', // taste-skill-ignore: encodes the selected amount and the plan floor on the range control.
      `rgba(239, 68, 68, 0.35) 0%, rgba(239, 68, 68, 0.35) ${blockedEnd}%`,
      `#c89028 ${blockedEnd}%, #c89028 ${goldEnd}%`,
      `rgba(255, 255, 255, 0.15) ${goldEnd}%, rgba(255, 255, 255, 0.15) 100%)`,
    ].join(', ');
  }, [isBelowFloor, selectedAmount, selectedPlan]);

  const selectedMethod = useMemo(
    () => methods.find((method) => method.id === selectedMethodId) || methods[0] || null,
    [methods, selectedMethodId]
  );

  const handleAmountChange = (planId: string, value: number) => {
    setAmounts((current) => ({ ...current, [planId]: value }));
  };

  const canSubmit = Boolean(
    selectedPlan
    && selectedMethod
    && !isBelowFloor
    && payerMsisdn.trim().length >= 9
    // CamPay génère la référence côté serveur : le champ n'est plus saisi.
    && (campayEnabled || reference.trim().length >= 4)
    && username.trim().length >= 3
    && !isSubmitting
    && (!isTurnstileEnabled || submitToken)
  );

  const handleLogin = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      setLoginError(t('login.codeTooShort'));
      return;
    }
    if (isTurnstileEnabled && !loginToken) {
      setLoginError(t('auth.captchaRequired'));
      return;
    }

    setIsLoggingIn(true);
    setLoginError('');

    try {
      const payload = await loginWithAccountCode({ code: trimmed, turnstileToken: loginToken });
      const userId = payload.account?.userId || payload.userId;
      if (!payload.token || !userId) {
        throw new Error(t('login.codeInvalid'));
      }

      persistResolvedSession('bip39', payload);
      broadcastAuthChange();
      window.setTimeout(() => {
        window.location.href = authorizeReturnPath || '/';
      }, 100);
    } catch (error) {
      setLoginError(isNetworkError(error) ? t('login.errorNetwork') : t('login.codeInvalid'));
    } finally {
      setIsLoggingIn(false);
      setLoginToken('');
      setLoginResetSignal((value) => value + 1);
    }
  }, [authorizeReturnPath, code, isTurnstileEnabled, loginToken, t]);

  const handlePasswordLogin = useCallback(async () => {
    const trimmedUsername = staffUsername.trim();
    if (!trimmedUsername || !staffPassword) {
      setPasswordError(t('login.passwordRequired'));
      return;
    }
    if (isTurnstileEnabled && !passwordToken) {
      setPasswordError(t('auth.captchaRequired'));
      return;
    }

    setIsPasswordLoggingIn(true);
    setPasswordError('');

    try {
      const payload = await loginWithAccountPassword({
        username: trimmedUsername,
        password: staffPassword,
        turnstileToken: passwordToken,
      });
      const userId = payload.account?.userId || payload.userId;
      if (!payload.token || !userId) {
        throw new Error(t('login.passwordInvalid'));
      }

      persistResolvedSession('bip39', payload);
      broadcastAuthChange();
      window.setTimeout(() => {
        window.location.href = authorizeReturnPath || '/';
      }, 100);
    } catch (error) {
      setPasswordError(isNetworkError(error) ? t('login.errorNetwork') : t('login.passwordInvalid'));
    } finally {
      setIsPasswordLoggingIn(false);
      setPasswordToken('');
      setPasswordResetSignal((value) => value + 1);
    }
  }, [authorizeReturnPath, isTurnstileEnabled, passwordToken, staffPassword, staffUsername, t]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !selectedPlan || !selectedMethod) return;

    setIsSubmitting(true);
    setSubmitError('');

    try {
      if (campayEnabled) {
        // Collecte CamPay : le serveur génère la référence et déclenche
        // l'invitation USSD sur le téléphone de l'acheteur.
        const session = await checkoutWithCamPay({
          planId: selectedPlan.id,
          amountFcfa: selectedAmount,
          paymentMethod: selectedMethod.id as AccountPaymentMethod['id'],
          payerMsisdn: payerMsisdn.trim(),
          username: username.trim(),
          turnstileToken: submitToken,
        });
        setCheckoutSession(session);
        setCreatedRequest(session.request);
        setRequestStatus('pending');
        return;
      }

      const created = await createAccountRequest({
        planId: selectedPlan.id,
        amountFcfa: selectedAmount,
        paymentMethod: selectedMethod.id as AccountPaymentMethod['id'],
        payerMsisdn: payerMsisdn.trim(),
        reference: reference.trim(),
        username: username.trim(),
        turnstileToken: submitToken,
      });
      setCreatedRequest(created);
      setRequestStatus(created.status || 'pending');
    } catch (error) {
      const message = error instanceof Error ? error.message : null;
      setSubmitError(
        isNetworkError(error) ? t('login.errorNetwork') : (message || t('login.errorGeneric'))
      );
      setSubmitResetSignal((value) => value + 1);
    } finally {
      setIsSubmitting(false);
      setSubmitToken('');
    }
  }, [campayEnabled, canSubmit, payerMsisdn, reference, selectedAmount, selectedMethod, selectedPlan, submitToken, t, username]);

  const handleCheckStatus = useCallback(async () => {
    if (!createdRequest) return;

    setIsCheckingStatus(true);
    try {
      // Collecte CamPay : le suivi interroge l'opérateur (le serveur règle la
      // demande et ne resert le code qu'une seule fois, au moment de l'approval).
      if (checkoutSession) {
        const result = await getCheckoutStatus(checkoutSession.camPay.reference);
        setRequestStatus(result.status);
        if (result.status === 'approved' && result.code) setIssuedCode(result.code);
        return;
      }

      const status = await getAccountRequestStatus({
        reference: createdRequest.reference,
        payerMsisdn: createdRequest.payerMsisdn,
      });
      setRequestStatus(status);
    } catch (error) {
      // Le serveur répond 404 quand la référence et le numéro ne correspondent
      // à aucune demande — un message générique ferait croire à une panne.
      const isMissing =
        typeof error === 'object' && error !== null && (error as { statusCode?: number }).statusCode === 404;
      setSubmitError(
        isNetworkError(error)
          ? t('login.errorNetwork')
          : (isMissing ? t('login.statusNotFound') : t('login.errorGeneric'))
      );
    } finally {
      setIsCheckingStatus(false);
    }
  }, [checkoutSession, createdRequest, t]);

  const handleResetRequest = () => {
    setCreatedRequest(null);
    setRequestStatus(null);
    setCheckoutSession(null);
    setIssuedCode(null);
    setSubmitError('');
    setPayerMsisdn('');
    setReference('');
    setUsername('');
  };

  // Le code de connexion servi une fois au paiement confirmé s'utilise
  // aussitôt : on bascule sur l'onglet connexion avec le code pré-rempli (le
  // Turnstile de l'onglet gère son propre jeton, aucun token de l'onglet
  // création n'est réutilisé).
  const handleLoginWithIssuedCode = () => {
    if (!issuedCode) return;
    setCode(issuedCode);
    handleTabChange('code');
  };

  // Suivi automatique d'une collecte CamPay : CamPay ne propose aucun webhook,
  // on interroge l'état toutes les 4 s (décroissance jusqu'à 10 s) tant que la
  // demande est en attente — l'invitation USSD est confirmée en général en
  // moins de deux minutes. Le code de connexion n'arrive qu'une fois.
  useEffect(() => {
    if (!checkoutSession || issuedCode || requestStatus !== 'pending') return;

    let cancelled = false;
    let delay = 4000;
    let timer = 0;

    const poll = async () => {
      try {
        const result = await getCheckoutStatus(checkoutSession.camPay.reference);
        if (cancelled) return;
        if (result.status === 'approved') {
          setRequestStatus('approved');
          if (result.code) setIssuedCode(result.code);
          return;
        }
        if (result.status === 'rejected' || result.status === 'failed') {
          setRequestStatus(result.status);
          return;
        }
      } catch {
        // Erreur réseau ponctuelle : on rejoue, le backoff suffit à lisser.
      }
      delay = Math.min(delay + 1000, 10000);
      timer = window.setTimeout(() => void poll(), delay);
    };

    timer = window.setTimeout(() => void poll(), delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [checkoutSession, issuedCode, requestStatus]);

  const statusMessage = requestStatus === 'approved'
    ? (checkoutSession ? t('login.statusApprovedCampay') : t('login.statusApproved'))
    : requestStatus === 'rejected'
      ? t('login.statusRejected')
      : requestStatus === 'failed'
        ? t('login.statusPaymentFailed')
        : (checkoutSession ? t('login.statusPendingCampay') : t('login.statusPending'));

  const statusIcon = requestStatus === 'approved'
    ? <CheckCircle2 className="h-5 w-5 text-emerald-300" aria-hidden="true" />
    : (requestStatus === 'rejected' || requestStatus === 'failed')
      ? <XCircle className="h-5 w-5 text-red-300" aria-hidden="true" />
      : <CircleDashed className="h-5 w-5 text-amber-200" aria-hidden="true" />;

  // Opérateur tel que renvoyé par CamPay ('mtn' | 'orange' | libellé brut).
  const campayOperator = checkoutSession?.camPay.operator
    ? (/orange/i.test(checkoutSession.camPay.operator)
      ? 'Orange Money'
      : /mtn/i.test(checkoutSession.camPay.operator)
        ? 'MTN MoMo'
        : checkoutSession.camPay.operator)
    : null;

  return (
    <div className="min-h-svh bg-ground text-ink">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-6 sm:py-10 lg:grid-cols-[minmax(13rem,0.72fr)_minmax(0,1.28fr)] lg:gap-16">
        <section className="lg:sticky lg:top-10 lg:self-start">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mb-8 inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-ink-muted transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('common.back')}
          </button>

          <img src={cinehdLockup} alt="CineHD" className="mb-8 h-auto w-40" />
          <header className="max-w-md">
            <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {t('login.title')}
            </h1>
            <p className="mt-4 text-base leading-relaxed text-ink-muted">
              {t('login.subtitle')}
            </p>
          </header>
        </section>

        <div className="w-full min-w-0">

          {/* Sélecteur de volet */}
          <div
            role="tablist"
            aria-label={t('login.title')}
            className="mb-6 grid grid-cols-3 gap-1 rounded-lg border border-rule bg-surface p-1"
          >
            {TAB_META.map(({ key, labelKey }) => {
              const isActive = tab === key;
              const Icon = key === 'code' ? KeyRound : key === 'password' ? Lock : UserPlus;
              return (
                <button
                  key={key}
                  type="button"
                  id={`login-tab-${key}`}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => handleTabChange(key)}
                  className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-1.5 text-xs font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:gap-2 sm:px-3 sm:text-sm ${
                    isActive ? 'bg-white text-black' : 'text-ink-muted hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{t(labelKey)}</span>
                </button>
              );
            })}
          </div>

            {tab === 'code' ? (
              <section
                role="tabpanel"
                id="login-panel-code"
                aria-labelledby="login-tab-code"
                className="rounded-lg bg-surface p-6 sm:p-8"
              >
                <label htmlFor="account-code" className="mb-2 block text-sm font-medium text-white/80">
                  {t('login.codeLabel')}
                </label>
                <input
                  id="account-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleLogin();
                    }
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('login.codePlaceholder')}
                  aria-describedby="account-code-hint"
                  className="w-full rounded-md border border-control bg-ground px-4 py-3 font-mono text-base uppercase tracking-widest text-white outline-none transition-colors placeholder:text-ink-faint focus:border-white focus-visible:ring-2 focus-visible:ring-white"
                />
                <p id="account-code-hint" className="mt-2 text-sm leading-relaxed text-ink-muted">{t('login.codeHint')}</p>

                {loginError && (
                  <p role="alert" className="mt-4 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {loginError}
                  </p>
                )}

                {isTurnstileEnabled && (
                  <div className="mt-5 flex justify-center overflow-hidden">
                    <TurnstileWidget onTokenChange={setLoginToken} resetSignal={loginResetSignal} />
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handleLogin()}
                  disabled={!code.trim() || isLoggingIn || (isTurnstileEnabled && !loginToken)}
                  className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-6 font-semibold text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  {isLoggingIn ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      {t('login.codeConnecting')}
                    </>
                  ) : (
                    <>
                      <KeyRound className="h-4 w-4" aria-hidden="true" />
                      {t('login.codeSubmit')}
                    </>
                  )}
                </button>

                <div className="mt-6 pt-5">
                  <p className="text-sm font-medium text-white/80">{t('login.alreadyTitle')}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">{t('login.alreadyBody')}</p>
                </div>
              </section>
            ) : tab === 'password' ? (
              <section
                role="tabpanel"
                id="login-panel-password"
                aria-labelledby="login-tab-password"
                className="space-y-4 rounded-lg bg-surface p-6 sm:p-8"
              >
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs leading-relaxed text-white/55">{t('login.passwordHint')}</p>
                </div>

                <div>
                  <label htmlFor="staff-username" className="mb-2 block text-sm font-medium text-white/80">
                    {t('login.passwordUsername')}
                  </label>
                  <input
                    id="staff-username"
                    value={staffUsername}
                    onChange={(event) => setStaffUsername(event.target.value)}
                    autoComplete="username"
                    maxLength={64}
                    placeholder={t('login.passwordUsernamePlaceholder')}
                    className="w-full rounded-md border border-control bg-ground px-4 py-3 text-white outline-none transition-colors placeholder:text-ink-faint focus:border-white focus-visible:ring-2 focus-visible:ring-white"
                  />
                </div>

                <div>
                  <label htmlFor="staff-password" className="mb-2 block text-sm font-medium text-white/80">
                    {t('login.passwordLabel')}
                  </label>
                  <input
                    id="staff-password"
                    type="password"
                    value={staffPassword}
                    onChange={(event) => setStaffPassword(event.target.value)}
                    autoComplete="current-password"
                    maxLength={256}
                    placeholder={t('login.passwordPlaceholder')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handlePasswordLogin();
                      }
                    }}
                    className="w-full rounded-md border border-control bg-ground px-4 py-3 text-white outline-none transition-colors placeholder:text-ink-faint focus:border-white focus-visible:ring-2 focus-visible:ring-white"
                  />
                </div>

                {passwordError && (
                  <p role="alert" className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {passwordError}
                  </p>
                )}

                {isTurnstileEnabled && (
                  <div className="flex justify-center overflow-hidden">
                    <TurnstileWidget onTokenChange={setPasswordToken} resetSignal={passwordResetSignal} />
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handlePasswordLogin()}
                  disabled={
                    !staffUsername.trim()
                    || !staffPassword
                    || isPasswordLoggingIn
                    || (isTurnstileEnabled && !passwordToken)
                  }
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-6 font-semibold text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  {isPasswordLoggingIn ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      {t('login.codeConnecting')}
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4" aria-hidden="true" />
                      {t('login.passwordSubmit')}
                    </>
                  )}
                </button>
              </section>
            ) : (
              <section
                role="tabpanel"
                id="login-panel-create"
                aria-labelledby="login-tab-create"
                className="space-y-6 rounded-lg bg-surface p-6 sm:p-8"
              >
                <div>
                  <h2 className="text-xl font-semibold">{t('login.createTitle')}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-white/55">{t('login.createIntro')}</p>
                </div>

                {plansError && (
                  <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {plansError}
                  </p>
                )}

                {/* 1. Offre */}
                <fieldset>
                  <legend className="mb-3 text-sm font-medium text-white/80">{t('login.choosePlan')}</legend>
                  <div className="grid gap-4 sm:grid-cols-3">
                    {plans.map((plan) => {
                      const isActive = plan.id === selectedPlan?.id;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => setSelectedPlanId(plan.id)}
                          aria-pressed={isActive}
                          className={`relative rounded-lg border p-5 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
                            isActive
                              ? 'border-white bg-white/5'
                              : 'border-rule bg-ground hover:border-control'
                          }`}
                        >
                          {isActive && (
                            <span
                              aria-hidden="true"
                              className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-white text-black"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </span>
                          )}
                          <span className="block pr-7 text-sm font-medium text-white/70">
                            {t(planLabelKey(plan.id))}
                          </span>
                          <span className="mt-2 flex items-baseline gap-1.5">
                            <span className="font-display text-3xl font-bold leading-none text-brand-gold">
                              {formatFcfa(plan.maxFcfa)}
                            </span>
                            <span className="text-xs font-medium text-brand-gold/80">
                              FCFA
                            </span>
                          </span>
                          <span className="mt-3 inline-block max-w-full rounded-full border border-rule bg-raised px-3 py-1.5 text-xs font-medium leading-snug text-ink-muted">
                            {t('login.planDays', { days: plan.days })}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                {/* 2. Curseur de prix */}
                {selectedPlan && (
                  <fieldset>
                    <legend className="mb-3 text-sm font-medium text-white/80">{t('login.amountLabel')}</legend>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                      <p className="flex items-baseline gap-2">
                        <span className="font-display text-4xl font-bold leading-none text-brand-gold">
                          {formatFcfa(selectedAmount)}
                        </span>
                        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-gold/70">
                          FCFA
                        </span>
                      </p>

                      <input
                        type="range"
                        min={selectedPlan.sliderMinFcfa}
                        max={selectedPlan.maxFcfa}
                        step={50}
                        value={selectedAmount}
                        onChange={(event) => handleAmountChange(selectedPlan.id, Number(event.target.value))}
                        aria-label={t('login.amountLabel')}
                        aria-valuetext={t('login.amountValue', { amount: formatFcfa(selectedAmount) })}
                        className="login-amount-range mt-4"
                        style={{ '--login-range-track': rangeTrack } as React.CSSProperties}
                      />

                      <div className="mt-1 flex justify-between text-xs text-white/40">
                        <span>{formatFcfa(selectedPlan.floorFcfa)} FCFA</span>
                        <span>{formatFcfa(selectedPlan.maxFcfa)} FCFA</span>
                      </div>

                      <p className="mt-2 text-xs leading-relaxed text-white/40">{t('login.amountHint')}</p>

                      {isBelowFloor && (
                        <div
                          role="alert"
                          className="mt-3 rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100"
                        >
                          <p className="font-medium">{t('login.amountBelowFloorJoke')}</p>
                          <p className="mt-1 text-xs text-amber-100/70">
                            {t('login.amountBelowFloor', { floor: formatFcfa(selectedPlan.floorFcfa) })}
                          </p>
                        </div>
                      )}
                    </div>
                  </fieldset>
                )}

                {/* 3. Moyen de paiement */}
                <fieldset>
                  <legend className="mb-3 text-sm font-medium text-white/80">{t('login.methodLabel')}</legend>
                  {methods.length === 0 ? (
                    <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/60">
                      {t('login.methodMissing')}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        {methods.map((method) => {
                          const isActive = method.id === selectedMethod?.id;
                          const brand = methodBrand[method.id];
                          return (
                            <button
                              key={method.id}
                              type="button"
                              onClick={() => setSelectedMethodId(method.id)}
                              aria-pressed={isActive}
                              className={`relative flex min-h-14 items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
                                isActive
                                  ? 'border-white bg-white/5'
                                  : 'border-rule bg-ground hover:border-control'
                              }`}
                            >
                              <span
                                aria-hidden="true"
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[11px] font-black uppercase tracking-tight text-white/70"
                                style={brand ? { backgroundColor: brand.bg, color: brand.fg } : undefined}
                              >
                                {brand ? brand.mark : <Smartphone className="h-5 w-5" />}
                              </span>
                              <span className="min-w-0 pr-6 text-sm font-semibold text-white">
                                {method.label}
                              </span>
                              {isActive && (
                                <CheckCircle2
                                  aria-hidden="true"
                                  className="absolute right-3 top-3 h-4 w-4 text-white"
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {selectedMethod && (
                        <div className="rounded-lg bg-raised p-5">
                          <p className="text-xs text-ink-muted">
                            {t('login.methodNumber')}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
                            <a
                              href={`tel:${selectedMethod.number}`}
                              className="break-all text-2xl font-semibold tabular-nums tracking-wide text-brand-gold"
                            >
                              {selectedMethod.number}
                            </a>
                            <button
                              type="button"
                              onClick={() => void copyText(selectedMethod.number)}
                              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-control px-3.5 text-xs font-semibold text-white transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                            >
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              {t('common.copy')}
                            </button>
                          </div>
                          <p className="mt-3 text-xs leading-relaxed text-white/60">
                            {t('login.methodSendTo', { amount: formatFcfa(selectedAmount) })}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </fieldset>

                {/* 4-6. Coordonnées */}
                <div className="grid gap-4">
                  <div>
                    <label htmlFor="payer-msisdn" className="mb-2 block text-sm font-medium text-white/80">
                      {t('login.msisdnLabel')}
                    </label>
                    <input
                      id="payer-msisdn"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={payerMsisdn}
                      onChange={(event) => setPayerMsisdn(event.target.value)}
                      placeholder={t('login.msisdnPlaceholder')}
                      className="w-full rounded-md border border-control bg-ground px-4 py-3 text-white outline-none transition-colors placeholder:text-ink-faint focus:border-white focus-visible:ring-2 focus-visible:ring-white"
                    />
                    <p className="mt-1 text-xs text-white/40">{t('login.msisdnHint')}</p>
                  </div>

                  {/* CamPay génère la référence côté serveur : le champ n'apparaît
                      que pour la collecte manuelle (fallback sans agrégateur). */}
                  {!campayEnabled && (
                    <div>
                      <label htmlFor="payment-reference" className="mb-2 block text-sm font-medium text-white/80">
                        {t('login.referenceLabel')}
                      </label>
                      <input
                        id="payment-reference"
                        value={reference}
                        onChange={(event) => setReference(event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={t('login.referencePlaceholder')}
                        className="w-full rounded-md border border-control bg-ground px-4 py-3 font-mono text-white outline-none transition-colors placeholder:text-ink-faint focus:border-white focus-visible:ring-2 focus-visible:ring-white"
                      />
                      <p className="mt-1 text-xs text-white/40">{t('login.referenceHint')}</p>
                    </div>
                  )}

                  <div>
                    <label htmlFor="account-username" className="mb-2 block text-sm font-medium text-white/80">
                      {t('login.usernameLabel')}
                    </label>
                    <input
                      id="account-username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      autoComplete="username"
                      maxLength={32}
                      placeholder={t('login.usernamePlaceholder')}
                      className="w-full rounded-md border border-control bg-ground px-4 py-3 text-white outline-none transition-colors placeholder:text-ink-faint focus:border-white focus-visible:ring-2 focus-visible:ring-white"
                    />
                    <p className="mt-1 text-xs text-white/40">{t('login.usernameHint')}</p>
                  </div>
                </div>

                {submitError && (
                  <p role="alert" className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {submitError}
                  </p>
                )}

                {isTurnstileEnabled && (
                  <div className="flex justify-center overflow-hidden">
                    <TurnstileWidget onTokenChange={setSubmitToken} resetSignal={submitResetSignal} />
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={!canSubmit}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-6 font-semibold text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      {t('login.submitting')}
                    </>
                  ) : (
                    campayEnabled ? t('login.submitCheckout') : t('login.submit')
                  )}
                </button>
              </section>
            )}

          {/* Offres de renouvellement publiques */}
          {bargains.length > 0 && (
            <section className="mt-6 rounded-lg bg-surface p-6">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Tag className="h-5 w-5 text-ink-faint" aria-hidden="true" />
                {t('login.bargainsTitle')}
              </h2>
              <p className="mt-1 text-sm text-white/55">{t('login.bargainsBody')}</p>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {bargains.map((bargain) => (
                  <li key={bargain.id} className="rounded-xl border border-white/10 bg-black/40 p-4">
                    <p className="text-sm font-semibold text-white">{bargain.title}</p>
                    {bargain.description && (
                      <p className="mt-1 text-xs leading-relaxed text-white/50">{bargain.description}</p>
                    )}
                    <p className="mt-2 flex items-baseline gap-2">
                      <span className="font-display text-xl font-bold leading-none text-brand-gold">
                        {formatFcfa(bargain.priceFcfa)}
                      </span>
                      <span className="text-xs font-medium text-brand-gold/80">
                        FCFA
                      </span>
                      <span className="text-xs text-white/45">· {t(planLabelKey(bargain.planId))}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Suivi d'une demande */}
          {tab === 'create' && createdRequest && (
            <section className="mt-6 rounded-2xl border border-emerald-400/25 bg-emerald-500/5 p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <CheckCircle2 className="h-5 w-5 text-emerald-300" aria-hidden="true" />
                {checkoutSession ? t('login.createdTitleCampay') : t('login.createdTitle')}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-white/65">
                {checkoutSession ? t('login.createdBodyCampay') : t('login.createdBody')}
              </p>

              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                  <dt className="text-xs text-ink-muted">{t('login.createdReference')}</dt>
                  <dd className="mt-1 font-mono text-sm text-brand-gold">{createdRequest.reference}</dd>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                  <dt className="text-xs text-ink-muted">{t('login.createdAmount')}</dt>
                  <dd className="mt-1 text-sm tabular-nums text-brand-gold">
                    {t('login.amountValue', { amount: formatFcfa(createdRequest.amountFcfa) })}
                  </dd>
                </div>
              </dl>

              {/* Invite de paiement CamPay en attente : l'invitation USSD est
                  déjà partie sur le téléphone de l'acheteur. */}
              {checkoutSession && requestStatus === 'pending' && (
                <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-500/10 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                    <Smartphone className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {t('login.campayPrompt', { operator: campayOperator || t('login.campayOperatorAny') })}
                  </p>
                  {checkoutSession.camPay.ussdCode && (
                    <p className="mt-2 text-sm text-white/75">
                      {t('login.campayUssdCode')}{' '}
                      <span className="font-mono font-semibold text-brand-gold">
                        {checkoutSession.camPay.ussdCode}
                      </span>
                    </p>
                  )}
                  <p className="mt-2 text-xs leading-relaxed text-white/60">
                    {t('login.campayPromptHint')}
                  </p>
                </div>
              )}

              <p className="mt-4 flex items-center gap-2 text-sm text-white/70">
                {statusIcon}
                {statusMessage}
              </p>

              {/* Code de connexion servi une seule fois, au moment où CamPay
                  confirme le paiement : affiché ici, jamais ressert ensuite. */}
              {issuedCode && (
                <div className="mt-4 rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-4">
                  <p className="text-sm font-semibold text-emerald-200">
                    {t('login.issuedCodeTitle')}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <span className="font-mono text-xl font-bold tracking-widest text-white">
                      {issuedCode}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void copyText(issuedCode)}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-control px-4 text-sm font-semibold text-white transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      >
                        <Copy className="h-4 w-4" aria-hidden="true" />
                        {t('common.copy')}
                      </button>
                      <button
                        type="button"
                        onClick={handleLoginWithIssuedCode}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                      >
                        <KeyRound className="h-4 w-4" aria-hidden="true" />
                        {t('login.loginNow')}
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-white/60">
                    {t('login.issuedCodeHint')}
                  </p>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleCheckStatus()}
                  disabled={isCheckingStatus}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-control px-4 text-sm font-medium text-white transition-colors hover:bg-raised disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {isCheckingStatus
                    ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    : <CircleDashed className="h-4 w-4" aria-hidden="true" />}
                  {isCheckingStatus
                    ? t('login.statusChecking')
                    : (checkoutSession ? t('login.checkStatusCampay') : t('login.checkStatus'))}
                </button>
                <button
                  type="button"
                  onClick={handleResetRequest}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-control px-4 text-sm font-medium text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {t('login.anotherRequest')}
                </button>
              </div>
            </section>
          )}

          {/* Support */}
          <section className="mt-6 rounded-lg bg-surface p-6">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <MessageCircle className="h-5 w-5 text-[#25D366]" aria-hidden="true" />
              {t('login.supportTitle')}
            </h2>
            <p className="mt-1 text-sm text-white/55">{t('login.supportBody')}</p>
            <a
              href={CREATE_ACCOUNT_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#25D366] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#1ebe5b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              {t('login.supportLink')}
            </a>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Login;
