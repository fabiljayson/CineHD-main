import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  Copy,
  KeyRound,
  Loader2,
  MessageCircle,
  Smartphone,
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
  createAccountRequest,
  getAccountPlans,
  getAccountRequestStatus,
  loginWithAccountCode,
  type AccountPaymentMethod,
  type AccountPlan,
  type AccountPlanId,
  type AccountRequestStatus,
  type AccountRequestSummary,
} from '../services/accountRequestsService';

import './Login.css';

type TabKey = 'code' | 'create';

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
  const reducedMotion = useReducedMotion();

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
  const [tab, setTab] = useState<TabKey>(searchParams.get('tab') === 'create' ? 'create' : 'code');

  const handleTabChange = (nextTab: TabKey) => {
    setTab(nextTab);
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === 'create') {
      nextParams.set('tab', 'create');
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
  const [requestStatus, setRequestStatus] = useState<AccountRequestStatus | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  useEffect(() => {
    let mounted = true;
    getAccountPlans()
      .then((payload) => {
        if (!mounted) return;
        setPlans(payload.plans);
        setMethods(payload.methods);
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
      'linear-gradient(to right,',
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
    && reference.trim().length >= 4
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

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !selectedPlan || !selectedMethod) return;

    setIsSubmitting(true);
    setSubmitError('');

    try {
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
  }, [canSubmit, payerMsisdn, reference, selectedAmount, selectedMethod, selectedPlan, submitToken, t, username]);

  const handleCheckStatus = useCallback(async () => {
    if (!createdRequest) return;

    setIsCheckingStatus(true);
    try {
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
  }, [createdRequest, t]);

  const handleResetRequest = () => {
    setCreatedRequest(null);
    setRequestStatus(null);
    setSubmitError('');
    setPayerMsisdn('');
    setReference('');
    setUsername('');
  };

  const statusMessage = requestStatus === 'approved'
    ? t('login.statusApproved')
    : requestStatus === 'rejected'
      ? t('login.statusRejected')
      : t('login.statusPending');

  const statusIcon = requestStatus === 'approved'
    ? <CheckCircle2 className="h-5 w-5 text-emerald-300" aria-hidden="true" />
    : requestStatus === 'rejected'
      ? <XCircle className="h-5 w-5 text-red-300" aria-hidden="true" />
      : <CircleDashed className="h-5 w-5 text-amber-200" aria-hidden="true" />;

  const entrance = reducedMotion
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } };

  return (
    <div className="relative min-h-screen bg-black text-white pb-16">
      {/* Halo doré discret, sans déplacement : neutre en prefers-reduced-motion. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(200,144,40,0.16),transparent_70%)]"
      />

      <div className="relative mx-auto w-full max-w-3xl px-4 pt-6 sm:pt-10">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mb-6 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/60 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('common.back')}
        </button>

        <header className="mb-8 text-center">
          <p className="text-xs uppercase tracking-[0.35em] text-brand-gold">CineHD</p>
          <h1 className="mt-3 font-display text-3xl sm:text-4xl">
            {t('login.title')}
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-white/55">
            {t('login.subtitle')}
          </p>
        </header>

        {/* Sélecteur de volet */}
        <div
          role="tablist"
          aria-label={t('login.title')}
          className="mx-auto mb-8 grid max-w-md grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/5 p-1"
        >
          {(['code', 'create'] as TabKey[]).map((key) => {
            const isActive = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => handleTabChange(key)}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold ${
                  isActive ? 'bg-brand-gold text-black' : 'text-white/70 hover:text-white'
                }`}
              >
                {key === 'code' ? <KeyRound className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {key === 'code' ? t('login.tabCode') : t('login.tabCreate')}
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {tab === 'code' ? (
            <motion.section
              key="code"
              {...entrance}
              transition={{ duration: 0.2 }}
              role="tabpanel"
              aria-label={t('login.tabCode')}
              className="rounded-2xl border border-white/10 bg-neutral-950/60 p-6 backdrop-blur-sm sm:p-8"
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
                className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 font-mono text-base uppercase tracking-widest text-white outline-none transition-colors placeholder:text-white/25 focus:border-brand-gold/60 focus-visible:ring-2 focus-visible:ring-brand-gold"
              />
              <p className="mt-2 text-xs leading-relaxed text-white/45">{t('login.codeHint')}</p>

              {loginError && (
                <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
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
                className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-gold px-6 font-semibold text-black transition-colors hover:bg-brand-gold-bright disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-black"
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

              <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm font-medium text-white/80">{t('login.alreadyTitle')}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/50">{t('login.alreadyBody')}</p>
              </div>
            </motion.section>
          ) : (
            <motion.section
              key="create"
              {...entrance}
              transition={{ duration: 0.2 }}
              role="tabpanel"
              aria-label={t('login.tabCreate')}
              className="space-y-6 rounded-2xl border border-white/10 bg-neutral-950/60 p-6 backdrop-blur-sm sm:p-8"
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
                        className={`relative rounded-2xl border p-5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
                          isActive
                            ? 'border-brand-gold bg-brand-gold/10 shadow-[0_0_28px_-8px_rgba(200,144,40,0.7)]'
                            : 'border-white/10 bg-white/5 hover:border-white/25'
                        }`}
                      >
                        {isActive && (
                          <span
                            aria-hidden="true"
                            className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-brand-gold text-black"
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
                          <span className="text-[11px] font-semibold uppercase tracking-widest text-brand-gold/70">
                            FCFA
                          </span>
                        </span>
                        <span className="mt-3 inline-block max-w-full rounded-full border border-brand-gold/40 bg-brand-gold/10 px-3 py-1.5 text-[11px] font-medium leading-snug text-brand-gold">
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
                            className={`relative flex min-h-14 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
                              isActive
                                ? 'border-brand-gold bg-brand-gold/10 shadow-[0_0_24px_-10px_rgba(200,144,40,0.7)]'
                                : 'border-white/10 bg-white/5 hover:border-white/25'
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
                                className="absolute right-3 top-3 h-4 w-4 text-brand-gold"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {selectedMethod && (
                      <div className="rounded-2xl border border-brand-gold/40 bg-brand-gold/[0.07] p-5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">
                          {t('login.methodNumber')}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
                          <a
                            href={`tel:${selectedMethod.number}`}
                            className="break-all font-mono text-2xl font-bold tracking-wide text-brand-gold"
                          >
                            {selectedMethod.number}
                          </a>
                          <button
                            type="button"
                            onClick={() => void copyText(selectedMethod.number)}
                            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-brand-gold/40 bg-brand-gold/15 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-brand-gold/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-black"
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
                    className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-white outline-none transition-colors placeholder:text-white/25 focus:border-brand-gold/60 focus-visible:ring-2 focus-visible:ring-brand-gold"
                  />
                  <p className="mt-1 text-xs text-white/40">{t('login.msisdnHint')}</p>
                </div>

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
                    className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 font-mono text-white outline-none transition-colors placeholder:text-white/25 focus:border-brand-gold/60 focus-visible:ring-2 focus-visible:ring-brand-gold"
                  />
                  <p className="mt-1 text-xs text-white/40">{t('login.referenceHint')}</p>
                </div>

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
                    className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-white outline-none transition-colors placeholder:text-white/25 focus:border-brand-gold/60 focus-visible:ring-2 focus-visible:ring-brand-gold"
                  />
                  <p className="mt-1 text-xs text-white/40">{t('login.usernameHint')}</p>
                </div>
              </div>

              {submitError && (
                <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
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
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-gold px-6 font-semibold text-black transition-colors hover:bg-brand-gold-bright disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    {t('login.submitting')}
                  </>
                ) : (
                  t('login.submit')
                )}
              </button>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Suivi d'une demande */}
        {tab === 'create' && createdRequest && (
          <section className="mt-6 rounded-2xl border border-emerald-400/25 bg-emerald-500/5 p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <CheckCircle2 className="h-5 w-5 text-emerald-300" aria-hidden="true" />
              {t('login.createdTitle')}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-white/65">{t('login.createdBody')}</p>

            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                <dt className="text-xs uppercase tracking-widest text-white/45">{t('login.createdReference')}</dt>
                <dd className="mt-1 font-mono text-sm text-brand-gold">{createdRequest.reference}</dd>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                <dt className="text-xs uppercase tracking-widest text-white/45">{t('login.createdAmount')}</dt>
                <dd className="mt-1 font-mono text-sm text-brand-gold">
                  {t('login.amountValue', { amount: formatFcfa(createdRequest.amountFcfa) })}
                </dd>
              </div>
            </dl>

            <p className="mt-4 flex items-center gap-2 text-sm text-white/70">
              {statusIcon}
              {statusMessage}
            </p>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleCheckStatus()}
                disabled={isCheckingStatus}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/15 px-4 text-sm font-medium text-white transition-colors hover:border-white/30 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
              >
                {isCheckingStatus
                  ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  : <CircleDashed className="h-4 w-4" aria-hidden="true" />}
                {isCheckingStatus ? t('login.statusChecking') : t('login.checkStatus')}
              </button>
              <button
                type="button"
                onClick={handleResetRequest}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/10 px-4 text-sm font-medium text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
              >
                {t('login.anotherRequest')}
              </button>
            </div>
          </section>
        )}

        {/* Support */}
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6">
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
  );
};

export default Login;
