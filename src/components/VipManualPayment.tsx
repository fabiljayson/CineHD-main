import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle2, Clock3, Copy, Crown, Smartphone, XCircle } from 'lucide-react';

import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import {
  getAccountPlans,
  type AccountPaymentMethodId,
  type AccountPlan,
  type AccountPlanId,
  type AccountPlansPayload,
} from '../services/accountRequestsService';
import {
  applyApprovedVipKey,
  hasAuthSession,
  listMyVipPayments,
  submitVipPayment,
  type VipPaymentRequest,
} from '../services/vipPaymentsService';
import { checkVipStatus } from '../utils/vipUtils';
import { formatVipDateTime } from '../utils/vipDonationsUi';
import { copyText } from '../utils/clipboard';
import AnimatedBorderCard from './ui/animated-border-card';
import { Button } from './ui/button';

const PENDING_POLL_MS = 60 * 1000;

const formatFcfa = (value: number) => `${Math.round(value)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * Abonnement VIP par Orange Money / MTN MoMo, confirmé à la main par un admin.
 *
 * 1. L'utilisateur connecté choisit une offre et envoie l'argent au numéro
 *    affiché (configuré côté serveur).
 * 2. Il déclare la transaction (opérateur, référence, numéro payeur, montant).
 * 3. Après validation admin, la clé VIP est rattachée au compte et activée
 *    automatiquement sur cet appareil : aucune saisie de clé.
 */
const VipManualPayment: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [isLoggedIn] = useState(() => hasAuthSession());
  const [plansPayload, setPlansPayload] = useState<AccountPlansPayload | null>(null);
  const [requests, setRequests] = useState<VipPaymentRequest[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [planId, setPlanId] = useState<AccountPlanId>('month');
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState<AccountPaymentMethodId | ''>('');
  const [payerMsisdn, setPayerMsisdn] = useState('');
  const [reference, setReference] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const plans = plansPayload?.plans ?? [];
  const methods = plansPayload?.methods ?? [];
  const selectedPlan: AccountPlan | undefined = plans.find((plan) => plan.id === planId);
  const selectedMethod = methods.find((method) => method.id === methodId);
  const pendingRequest = requests.find((request) => request.status === 'pending') || null;
  const latestRequest = requests[0] || null;
  const latestApproved = requests.find((request) => request.status === 'approved' && request.accessKey) || null;

  const planLabel = useCallback((id: AccountPlanId) => (
    id === 'week' ? t('accountRequests.planWeek') : id === 'year' ? t('accountRequests.planYear') : t('accountRequests.planMonth')
  ), [t]);

  const methodLabel = useCallback((id: AccountPaymentMethodId) => (
    id === 'orange_money' ? t('accountRequests.methodOrange') : t('accountRequests.methodMtn')
  ), [t]);

  const refreshRequests = useCallback(async () => {
    const mine = await listMyVipPayments();
    setRequests(mine);
    const approved = mine.find((request) => request.status === 'approved' && request.accessKey);
    if (approved && applyApprovedVipKey(approved)) {
      void checkVipStatus(true).catch(() => { /* vérification de fond */ });
      toast.success(t('vipManualPayment.unlocked'));
    }
  }, [t]);

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const [payload] = await Promise.all([getAccountPlans(), refreshRequests()]);
        if (cancelled) return;
        setPlansPayload(payload);
        const firstMethod = payload.methods[0];
        if (firstMethod) setMethodId(firstMethod.id);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : t('vipManualPayment.loadError'));
      }
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn, refreshRequests, t]);

  // Suivi automatique tant qu'une demande attend la vérification admin.
  useEffect(() => {
    if (!pendingRequest) return undefined;
    const timer = window.setInterval(() => {
      void refreshRequests().catch(() => { /* nouvel essai au prochain tick */ });
    }, PENDING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [pendingRequest, refreshRequests]);

  useEffect(() => {
    if (selectedPlan) setAmount(String(selectedPlan.maxFcfa));
  }, [selectedPlan]);

  const amountValue = Number.parseInt(amount, 10);
  const amountError = useMemo(() => {
    if (!selectedPlan) return null;
    if (!Number.isInteger(amountValue)) return t('vipManualPayment.amountInvalid');
    if (amountValue < selectedPlan.floorFcfa || amountValue > selectedPlan.maxFcfa) {
      return t('vipManualPayment.amountRange', {
        min: formatFcfa(selectedPlan.floorFcfa),
        max: formatFcfa(selectedPlan.maxFcfa),
      });
    }
    return null;
  }, [amountValue, selectedPlan, t]);

  const canSubmit = Boolean(selectedPlan && selectedMethod && !amountError && payerMsisdn.trim() && reference.trim().length >= 4);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !selectedPlan || !selectedMethod) return;
    try {
      setIsSubmitting(true);
      const created = await submitVipPayment({
        planId: selectedPlan.id,
        amountFcfa: amountValue,
        paymentMethod: selectedMethod.id,
        payerMsisdn: payerMsisdn.trim(),
        reference: reference.trim(),
      });
      setRequests((current) => [created, ...current]);
      setReference('');
      toast.success(t('vipManualPayment.submitted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('vipManualPayment.submitError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyKey = async (key: string) => {
    if (await copyText(key)) toast.success(t('vipManualPayment.keyCopied'));
    else toast.error(t('common.error'));
  };

  const inputClass = 'w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-yellow-500/60 focus-visible:ring-2 focus-visible:ring-yellow-500';

  return (
    <AnimatedBorderCard highlightColor="234 179 8" backgroundColor="10 10 10" className="p-6 md:p-8 text-left space-y-6 backdrop-blur-sm">
      <div className="flex items-start gap-4">
        <div className="rounded-lg bg-yellow-500/10 p-3">
          <Smartphone className="h-6 w-6 text-yellow-500" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">{t('vipManualPayment.title')}</h2>
          <p className="mt-1 text-sm leading-6 text-white/60">{t('vipManualPayment.description')}</p>
        </div>
      </div>

      {!isLoggedIn ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
          <p className="text-sm text-white/70">{t('vipManualPayment.loginRequired')}</p>
          <Link
            to="/login"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-yellow-500 px-6 text-black transition-colors hover:bg-yellow-400"
          >
            {t('vipManualPayment.loginCta')}
          </Link>
        </div>
      ) : loadError ? (
        <p className="text-sm text-red-300">{loadError}</p>
      ) : !plansPayload ? (
        <p className="text-sm text-white/50">{t('common.loading')}</p>
      ) : (
        <>
          {latestApproved && (
            <div className="rounded-2xl border border-emerald-400/35 bg-emerald-500/10 p-5 space-y-3">
              <p className="flex items-center gap-2 font-semibold text-emerald-100">
                <CheckCircle2 className="h-5 w-5" />
                {t('vipManualPayment.approvedTitle')}
              </p>
              <p className="text-sm text-white/70">
                {t('vipManualPayment.approvedDesc', {
                  date: formatVipDateTime(i18n.language, latestApproved.keyExpiresAt),
                })}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <code className="rounded-xl bg-black/40 px-3 py-1.5 font-mono text-sm font-semibold tracking-wider text-yellow-400">
                  {latestApproved.accessKey}
                </code>
                <Button size="sm" variant="outline" onClick={() => void handleCopyKey(latestApproved.accessKey as string)}>
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  {t('vipManualPayment.copyKey')}
                </Button>
              </div>
              <p className="text-xs text-white/45">{t('vipManualPayment.keyHint')}</p>
            </div>
          )}

          {pendingRequest ? (
            <div className="rounded-2xl border border-amber-400/35 bg-amber-500/10 p-5 space-y-2">
              <p className="flex items-center gap-2 font-semibold text-amber-100">
                <Clock3 className="h-5 w-5" />
                {t('vipManualPayment.pendingTitle')}
              </p>
              <p className="text-sm text-white/70">
                {t('vipManualPayment.pendingDesc', {
                  reference: pendingRequest.reference,
                  plan: planLabel(pendingRequest.planId),
                  amount: formatFcfa(pendingRequest.amountFcfa),
                })}
              </p>
            </div>
          ) : (
            <>
              {latestRequest?.status === 'rejected' && (
                <div className="rounded-2xl border border-red-400/35 bg-red-500/10 p-5 space-y-2">
                  <p className="flex items-center gap-2 font-semibold text-red-100">
                    <XCircle className="h-5 w-5" />
                    {t('vipManualPayment.rejectedTitle', { reference: latestRequest.reference })}
                  </p>
                  {latestRequest.adminNote && (
                    <p className="text-sm text-white/70">
                      {t('vipManualPayment.rejectedReason', { note: latestRequest.adminNote })}
                    </p>
                  )}
                </div>
              )}

              {methods.length === 0 ? (
                <p className="text-sm text-white/55">{t('vipManualPayment.unavailable')}</p>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <fieldset className="space-y-2">
                    <legend className="mb-2 text-sm font-medium text-white/80">{t('vipManualPayment.step1')}</legend>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {plans.map((plan) => (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => setPlanId(plan.id)}
                          aria-pressed={plan.id === planId}
                          className={`rounded-xl border p-4 text-left transition-colors ${plan.id === planId ? 'border-yellow-500 bg-yellow-500/10' : 'border-white/10 hover:bg-white/5'}`}
                        >
                          <p className="font-semibold text-white">{planLabel(plan.id)}</p>
                          <p className="text-sm text-white/55">{t('login.amountValue', { amount: formatFcfa(plan.maxFcfa) })}</p>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className="space-y-3">
                    <legend className="mb-2 text-sm font-medium text-white/80">{t('vipManualPayment.step2')}</legend>
                    <div className="flex flex-wrap gap-2">
                      {methods.map((method) => (
                        <button
                          key={method.id}
                          type="button"
                          onClick={() => setMethodId(method.id)}
                          aria-pressed={method.id === methodId}
                          className={`rounded-lg border px-4 py-2 text-sm transition-colors ${method.id === methodId ? 'border-yellow-500 bg-yellow-500/10 text-white' : 'border-white/10 text-white/70 hover:bg-white/5'}`}
                        >
                          {methodLabel(method.id)}
                        </button>
                      ))}
                    </div>
                    {selectedMethod && selectedPlan && (
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/75">
                        {t('vipManualPayment.sendInstructions', {
                          amount: formatFcfa(Number.isInteger(amountValue) ? amountValue : selectedPlan.maxFcfa),
                          method: methodLabel(selectedMethod.id),
                        })}
                        <p className="mt-2 font-mono text-lg font-bold tracking-wider text-yellow-400">{selectedMethod.number}</p>
                      </div>
                    )}
                  </fieldset>

                  <fieldset className="grid gap-4 sm:grid-cols-2">
                    <legend className="mb-2 text-sm font-medium text-white/80 sm:col-span-2">{t('vipManualPayment.step3')}</legend>
                    <label className="space-y-1 text-sm text-white/70">
                      <span>{t('vipManualPayment.reference')}</span>
                      <input
                        type="text"
                        value={reference}
                        onChange={(event) => setReference(event.target.value)}
                        placeholder={t('vipManualPayment.referencePlaceholder')}
                        maxLength={128}
                        autoComplete="off"
                        className={inputClass}
                      />
                    </label>
                    <label className="space-y-1 text-sm text-white/70">
                      <span>{t('vipManualPayment.payerNumber')}</span>
                      <input
                        type="tel"
                        inputMode="tel"
                        value={payerMsisdn}
                        onChange={(event) => setPayerMsisdn(event.target.value)}
                        placeholder="6XX XX XX XX"
                        maxLength={20}
                        className={inputClass}
                      />
                    </label>
                    <label className="space-y-1 text-sm text-white/70">
                      <span>{t('vipManualPayment.amountSent')}</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={amount}
                        min={selectedPlan?.floorFcfa}
                        max={selectedPlan?.maxFcfa}
                        onChange={(event) => setAmount(event.target.value)}
                        className={inputClass}
                      />
                      {amountError && <span className="block text-xs text-red-300">{amountError}</span>}
                    </label>
                  </fieldset>

                  <Button
                    type="submit"
                    disabled={!canSubmit || isSubmitting}
                    className="h-11 w-full bg-yellow-500 text-black hover:bg-yellow-400 sm:w-auto"
                  >
                    <Crown className="mr-2 h-4 w-4" />
                    {isSubmitting ? t('common.loading') : t('vipManualPayment.submit')}
                  </Button>
                  <p className="text-xs text-white/45">{t('vipManualPayment.reviewDelay')}</p>
                </form>
              )}
            </>
          )}
        </>
      )}
    </AnimatedBorderCard>
  );
};

export default VipManualPayment;
