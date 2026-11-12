import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle2, Copy, RefreshCcw, Search, Smartphone, XCircle } from 'lucide-react';

import type {
  AccountPaymentMethodId,
  AccountPlanId,
  AccountRequestStatus,
} from '../services/accountRequestsService';
import {
  adminConfirmVipPayment,
  adminListVipPayments,
  adminRejectVipPayment,
  type VipPaymentRequest,
} from '../services/vipPaymentsService';
import { formatVipDateTime } from '../utils/vipDonationsUi';
import { copyText } from '../utils/clipboard';
import ReusableModal from './ui/reusable-modal';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select';

const PAGE_SIZE = 20;

const formatFcfa = (value: number) => `${Math.round(value)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const statusClassMap: Record<AccountRequestStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-200 border-amber-400/35',
  approved: 'bg-emerald-500/15 text-emerald-100 border-emerald-300/35',
  rejected: 'bg-red-500/15 text-red-100 border-red-400/35',
};

type PendingAction =
  | { kind: 'confirm'; request: VipPaymentRequest; note: string }
  | { kind: 'reject'; request: VipPaymentRequest; note: string };

/**
 * Déclarations de paiement VIP (Orange Money / MTN MoMo) à vérifier.
 *
 * Affiché au-dessus de la gestion des clés VIP : l'admin compare la
 * référence et le montant avec son relevé opérateur, puis valide (une clé
 * est générée avec la durée de l'offre et rattachée au compte) ou refuse
 * avec un motif visible par l'utilisateur.
 */
const VipPaymentRequestsManager: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [requests, setRequests] = useState<VipPaymentRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [issuedKey, setIssuedKey] = useState<{ request: VipPaymentRequest; key: string; linked: boolean } | null>(null);

  const statusOptions = useMemo(() => [
    { value: 'pending', label: t('accountRequests.pending') },
    { value: 'approved', label: t('accountRequests.approved') },
    { value: 'rejected', label: t('accountRequests.rejected') },
    { value: 'all', label: t('accountRequests.allStatuses') },
  ], [t]);

  const filteredLabel = statusOptions.find((option) => option.value === statusFilter)?.label || '';

  const planLabel = (id: AccountPlanId) => (
    id === 'week' ? t('accountRequests.planWeek') : id === 'year' ? t('accountRequests.planYear') : t('accountRequests.planMonth')
  );
  const methodLabel = (id: AccountPaymentMethodId) => (
    id === 'orange_money' ? t('accountRequests.methodOrange') : t('accountRequests.methodMtn')
  );
  const statusLabel = (status: AccountRequestStatus) => (
    status === 'approved' ? t('accountRequests.approved') : status === 'rejected' ? t('accountRequests.rejected') : t('accountRequests.pending')
  );

  const loadRequests = useCallback(async (requestedPage: number) => {
    try {
      setIsLoading(true);
      const result = await adminListVipPayments({ status: statusFilter, search, page: requestedPage, limit: PAGE_SIZE });
      setRequests(result.requests);
      setTotal(result.total);
      setHasMore(result.hasMore);
      setPage(result.page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('vipManualPayment.admin.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, t]);

  useEffect(() => {
    void loadRequests(1);
  }, [loadRequests]);

  const applyUpdated = (updated: VipPaymentRequest) => {
    setRequests((current) => current.map((request) => (request.id === updated.id ? updated : request)));
  };

  const runAction = async (action: PendingAction) => {
    try {
      setProcessingId(action.request.id);
      setPendingAction(null);
      if (action.kind === 'confirm') {
        const result = await adminConfirmVipPayment(action.request.id, action.note);
        applyUpdated(result.request);
        setIssuedKey({ request: result.request, key: result.accessKey, linked: result.accountLinked });
        toast.success(t('vipManualPayment.admin.confirmDone'));
      } else {
        const result = await adminRejectVipPayment(action.request.id, action.note);
        applyUpdated(result.request);
        toast.success(t('vipManualPayment.admin.rejectDone'));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('vipManualPayment.admin.loadError'));
      void loadRequests(page);
    } finally {
      setProcessingId(null);
    }
  };

  const handleCopy = async (value: string) => {
    if (await copyText(value)) toast.success(t('vipManualPayment.keyCopied'));
    else toast.error(t('common.error'));
  };

  return (
    <div className="mb-10 space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-semibold text-white">
            <Smartphone className="h-5 w-5 text-emerald-300" />
            {t('vipManualPayment.admin.title')}
          </h3>
          <p className="mt-1 text-sm text-white/55">{t('vipManualPayment.admin.description')}</p>
        </div>
        <p className="text-sm text-white/60">{t('accountRequests.total', { count: total })}</p>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_auto]">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          <Search className="h-4 w-4 text-white opacity-[0.35]" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('vipManualPayment.admin.searchPlaceholder')}
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-[180px] rounded-md border-white/10 bg-transparent px-3 text-xs hover:bg-white/10">
              <span className="truncate">{filteredLabel}</span>
            </SelectTrigger>
            <SelectContent className="rounded-md border-white/10 bg-[#111111]/95">
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => void loadRequests(page)} disabled={isLoading}>
            <RefreshCcw className={`mr-1 h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {isLoading && requests.length === 0 ? (
        <p className="py-6 text-center text-white/55">{t('common.loading')}</p>
      ) : requests.length === 0 ? (
        <p className="py-6 text-center text-white/45">{t('accountRequests.empty')}</p>
      ) : (
        <div className="space-y-3">
          {requests.map((request) => (
            <div key={request.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-mono text-sm font-semibold text-emerald-200">{request.reference}</p>
                  <p className="text-sm text-white/60">
                    {request.username || request.userId}
                    <span className="ml-2 text-xs text-white/35">{request.userType}:{request.userId}</span>
                  </p>
                </div>
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusClassMap[request.status]}`}>
                  {statusLabel(request.status)}
                </span>
              </div>

              <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-5">
                <div>
                  <p className="text-white/30">{t('accountRequests.plan')}</p>
                  <p className="font-semibold text-white">{planLabel(request.planId)}</p>
                </div>
                <div>
                  <p className="text-white/30">{t('accountRequests.amount')}</p>
                  <p className="font-semibold text-white">{t('login.amountValue', { amount: formatFcfa(request.amountFcfa) })}</p>
                </div>
                <div>
                  <p className="text-white/30">{t('accountRequests.method')}</p>
                  <p className="font-semibold text-white">{methodLabel(request.paymentMethod)}</p>
                </div>
                <div>
                  <p className="text-white/30">{t('accountRequests.payer')}</p>
                  <p className="break-all font-semibold text-white">{request.payerMsisdn}</p>
                </div>
                <div>
                  <p className="text-white/30">{t('accountRequests.submittedAt')}</p>
                  <p className="font-semibold text-white">{formatVipDateTime(i18n.language, request.createdAt)}</p>
                </div>
                {request.accessKey && (
                  <div className="md:col-span-2 xl:col-span-3">
                    <p className="text-white/30">{t('vipManualPayment.admin.generatedKey')}</p>
                    <p className="break-all font-mono font-semibold text-yellow-400">
                      {request.accessKey}
                      <span className="ml-2 font-sans text-xs text-white/45">
                        {t('vipManualPayment.admin.expiresOn', { date: formatVipDateTime(i18n.language, request.keyExpiresAt) })}
                      </span>
                    </p>
                  </div>
                )}
                {request.adminNote && (
                  <div className="md:col-span-2">
                    <p className="text-white/30">{t('accountRequests.note')}</p>
                    <p className="font-semibold text-white">{request.adminNote}</p>
                  </div>
                )}
              </div>

              {request.status === 'pending' && (
                <div className="flex flex-wrap gap-2 xl:justify-end">
                  <Button
                    size="sm"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={() => setPendingAction({ kind: 'confirm', request, note: '' })}
                    disabled={processingId === request.id}
                  >
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                    {t('vipManualPayment.admin.confirm')}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setPendingAction({ kind: 'reject', request, note: '' })}
                    disabled={processingId === request.id}
                  >
                    <XCircle className="mr-1 h-3.5 w-3.5" />
                    {t('accountRequests.reject')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1 || isLoading} onClick={() => void loadRequests(page - 1)}>
            {t('common.previous')}
          </Button>
          <span className="text-sm text-white/50">{page}</span>
          <Button size="sm" variant="outline" disabled={!hasMore || isLoading} onClick={() => void loadRequests(page + 1)}>
            {t('common.next')}
          </Button>
        </div>
      )}

      <ReusableModal
        isOpen={Boolean(pendingAction)}
        onClose={() => setPendingAction(null)}
        title={t('common.confirm')}
        className="max-w-lg"
      >
        {pendingAction ? (
          <div className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
              <code className="rounded-xl bg-black/30 px-3 py-1.5 text-xs font-semibold text-white">
                {pendingAction.request.reference}
              </code>
              <p className="text-sm leading-6 text-white/70">
                {pendingAction.kind === 'confirm'
                  ? t('vipManualPayment.admin.confirmWarning', {
                    amount: formatFcfa(pendingAction.request.amountFcfa),
                    method: methodLabel(pendingAction.request.paymentMethod),
                    plan: planLabel(pendingAction.request.planId),
                  })
                  : t('vipManualPayment.admin.rejectWarning')}
              </p>
              <label htmlFor="vip-payment-note" className="block text-sm text-white/70">
                {pendingAction.kind === 'confirm' ? t('vipManualPayment.admin.confirmNote') : t('vipManualPayment.admin.rejectNote')}
              </label>
              <textarea
                id="vip-payment-note"
                value={pendingAction.note}
                onChange={(event) => setPendingAction({ ...pendingAction, note: event.target.value })}
                rows={3}
                maxLength={500}
                className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
              />
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setPendingAction(null)}>{t('common.cancel')}</Button>
              <Button
                onClick={() => void runAction(pendingAction)}
                variant={pendingAction.kind === 'reject' ? 'destructive' : 'default'}
                className={pendingAction.kind === 'confirm' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : undefined}
              >
                {pendingAction.kind === 'confirm' ? t('vipManualPayment.admin.confirm') : t('accountRequests.rejectConfirm')}
              </Button>
            </div>
          </div>
        ) : null}
      </ReusableModal>

      <ReusableModal
        isOpen={Boolean(issuedKey)}
        onClose={() => setIssuedKey(null)}
        title={t('vipManualPayment.admin.keyTitle')}
        className="max-w-md"
      >
        {issuedKey ? (
          <div className="space-y-5">
            <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-5 text-center">
              <p className="font-mono text-lg font-bold tracking-[0.12em] text-yellow-400">{issuedKey.key}</p>
              <p className="mt-3 text-xs leading-relaxed text-white/65">
                {issuedKey.linked ? t('vipManualPayment.admin.linked') : t('vipManualPayment.admin.notLinked')}
              </p>
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => void handleCopy(issuedKey.key)}>
                <Copy className="mr-1 h-3.5 w-3.5" />
                {t('vipManualPayment.copyKey')}
              </Button>
              <Button onClick={() => setIssuedKey(null)} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        ) : null}
      </ReusableModal>
    </div>
  );
};

export default VipPaymentRequestsManager;
