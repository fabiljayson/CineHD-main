import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Clock3,
  Copy,
  RefreshCcw,
  Search,
  ShieldAlert,
  XCircle
} from 'lucide-react';

import {
  adminApproveAccountRequest,
  adminRejectAccountRequest,
  adminRegenerateAccountCode,
  listAccountRequests,
  type AccountPaymentMethodId,
  type AccountPlanId,
  type AccountRequestStatus,
  type AccountRequestSummary
} from '../services/accountRequestsService';
import { formatVipDateTime } from '../utils/vipDonationsUi';
import { copyText } from '../utils/clipboard';
import ReusableModal from './ui/reusable-modal';
import AnimatedBorderCard from './ui/animated-border-card';
import BlurText from './ui/blur-text';
import ShinyText from './ui/shiny-text';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select';

const PAGE_SIZE = 20;

const formatFcfa = (value: number) => `${Math.round(value)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const statusClassMap: Record<AccountRequestStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-200 border-amber-400/35',
  approved: 'bg-emerald-500/15 text-emerald-100 border-emerald-300/35',
  rejected: 'bg-red-500/15 text-red-100 border-red-400/35'
};

const statusHighlightMap: Record<AccountRequestStatus, string> = {
  pending: '245 158 11',
  approved: '34 197 94',
  rejected: '239 68 68'
};

type PendingAction =
  | { kind: 'approve'; request: AccountRequestSummary }
  | { kind: 'reject'; request: AccountRequestSummary; note: string }
  | { kind: 'regenerate'; request: AccountRequestSummary };

/**
 * Validation des demandes de compte : l'admin vérifie le paiement mobile
 * money, approuve (le serveur génère alors le code de connexion) ou refuse,
 * et peut régénérer un code perdu.
 */
const AccountRequestsManager: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [requests, setRequests] = useState<AccountRequestSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [issuedCode, setIssuedCode] = useState<{ request: AccountRequestSummary; code: string } | null>(null);

  const statusOptions = useMemo(
    () => [
      { value: 'all', label: t('accountRequests.allStatuses') },
      { value: 'pending', label: t('accountRequests.pending') },
      { value: 'approved', label: t('accountRequests.approved') },
      { value: 'rejected', label: t('accountRequests.rejected') }
    ],
    [t]
  );

  const filteredLabel = useMemo(
    () => statusOptions.find((option) => option.value === statusFilter)?.label || t('accountRequests.allStatuses'),
    [statusFilter, statusOptions, t]
  );

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);
  const visiblePages = useMemo(() => {
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, start + 4);
    const normalizedStart = Math.max(1, end - 4);

    return Array.from({ length: end - normalizedStart + 1 }, (_, index) => normalizedStart + index);
  }, [page, totalPages]);

  const loadRequests = useCallback(async (requestedPage: number) => {
    try {
      setIsLoading(true);
      const result = await listAccountRequests({
        status: statusFilter,
        search,
        page: requestedPage,
        limit: PAGE_SIZE
      });

      setRequests(result.requests);
      setTotal(result.total);
      setHasMore(result.hasMore);
      setPage(result.page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('accountRequests.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, t]);

  useEffect(() => {
    void loadRequests(1);
  }, [loadRequests, statusFilter]);

  const planLabel = (planId: AccountPlanId) => (
    planId === 'week'
      ? t('accountRequests.planWeek')
      : planId === 'year'
        ? t('accountRequests.planYear')
        : t('accountRequests.planMonth')
  );

  const methodLabel = (methodId: AccountPaymentMethodId) => (
    methodId === 'orange_money' ? t('accountRequests.methodOrange') : t('accountRequests.methodMtn')
  );

  const statusLabel = (status: AccountRequestStatus) => (
    status === 'approved'
      ? t('accountRequests.approved')
      : status === 'rejected'
        ? t('accountRequests.rejected')
        : t('accountRequests.pending')
  );

  const handleCopy = async (value: string, successMessage: string) => {
    if (await copyText(value)) {
      toast.success(successMessage);
    } else {
      toast.error(t('common.error'));
    }
  };

  const applyUpdatedRequest = (updated: AccountRequestSummary) => {
    setRequests((current) => current.map((request) => (
      request.id === updated.id ? updated : request
    )));
  };

  const runPendingAction = async (action: PendingAction) => {
    try {
      setProcessingId(action.request.id);
      setPendingAction(null);

      if (action.kind === 'approve') {
        const result = await adminApproveAccountRequest(action.request.id);
        applyUpdatedRequest(result.request);
        setIssuedCode({ request: result.request, code: result.code });
        toast.success(t('accountRequests.approveDone'));
      } else if (action.kind === 'reject') {
        const result = await adminRejectAccountRequest(action.request.id, action.note);
        applyUpdatedRequest(result.request);
        setIssuedCode(null);
        toast.success(t('accountRequests.rejectDone'));
      } else {
        const result = await adminRegenerateAccountCode(action.request.id);
        applyUpdatedRequest(result.request);
        setIssuedCode({ request: result.request, code: result.code });
        toast.success(t('accountRequests.regenerated'));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('accountRequests.loadError'));
    } finally {
      setProcessingId(null);
    }
  };

  const confirmAction = (action: PendingAction | null) => {
    if (action) void runPendingAction(action);
  };

  return (
    <div className="space-y-6">
      <AnimatedBorderCard highlightColor="200 144 40" backgroundColor="10 10 10" className="p-6 md:p-7">
        <div className="space-y-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-gold/30 bg-brand-gold/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-amber-100">
                <ShieldAlert className="h-4 w-4" />
                {t('accountRequests.sectionTitle')}
              </div>
              <div>
                <ShinyText
                  text={t('accountRequests.sectionTitle')}
                  speed={2}
                  color="#c89028"
                  shineColor="#ffffff"
                  className="text-3xl font-bold"
                />
                <p className="mt-2 text-sm leading-6 text-white/55">{t('accountRequests.sectionDesc')}</p>
              </div>
            </div>

            <div className="text-right xl:max-w-xs">
              <p className="text-xs uppercase tracking-[0.22em] text-white/30">{filteredLabel}</p>
              <BlurText
                text={t('accountRequests.total', { count: total })}
                delay={40}
                className="mt-2 text-sm font-medium text-white/75"
              />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_auto]">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <Search className="h-4 w-4 text-white opacity-[0.35]" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('accountRequests.searchPlaceholder')}
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
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => void loadRequests(page)} disabled={isLoading}>
                <RefreshCcw className={`mr-1 h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                {t('common.refresh')}
              </Button>
            </div>
          </div>
        </div>
      </AnimatedBorderCard>

      {isLoading && requests.length === 0 ? (
        <AnimatedBorderCard highlightColor="200 144 40" backgroundColor="10 10 10" className="p-10 text-center">
          <p className="text-white/55">{t('common.loading')}</p>
        </AnimatedBorderCard>
      ) : requests.length === 0 ? (
        <AnimatedBorderCard highlightColor="148 163 184" backgroundColor="10 10 10" className="p-10 text-center">
          <p className="text-white/45">{t('accountRequests.empty')}</p>
        </AnimatedBorderCard>
      ) : (
        <div className="space-y-4">
          {requests.map((request) => (
            <AnimatedBorderCard
              key={request.id}
              highlightColor={statusHighlightMap[request.status]}
              backgroundColor="10 10 10"
              className="p-5"
            >
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-mono text-sm font-semibold text-brand-gold">{request.reference}</p>
                    <p className="text-sm text-white/60">{request.username}</p>
                  </div>
                  <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusClassMap[request.status]}`}>
                    {statusLabel(request.status)}
                  </span>
                </div>

                <div className="grid gap-3 text-sm text-white/58 md:grid-cols-2 xl:grid-cols-4">
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
                    <p className="font-semibold text-white">{formatVipDateTime(i18n.language, request.createdAt || null)}</p>
                  </div>
                  {request.adminNote && (
                    <div className="md:col-span-2 xl:col-span-3">
                      <p className="text-white/30">{t('accountRequests.note')}</p>
                      <p className="font-semibold text-white">{request.adminNote}</p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 xl:justify-end">
                  <Button
                    size="sm"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={() => setPendingAction({ kind: 'approve', request })}
                    disabled={processingId === request.id || request.status !== 'pending'}
                  >
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                    {t('accountRequests.approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setPendingAction({ kind: 'reject', request, note: '' })}
                    disabled={processingId === request.id || request.status !== 'pending'}
                  >
                    <XCircle className="mr-1 h-3.5 w-3.5" />
                    {t('accountRequests.reject')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPendingAction({ kind: 'regenerate', request })}
                    disabled={processingId === request.id || request.status !== 'approved'}
                  >
                    <RefreshCcw className="mr-1 h-3.5 w-3.5" />
                    {t('accountRequests.regenerate')}
                  </Button>
                </div>
              </div>
            </AnimatedBorderCard>
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-white/45">
            {t('accountRequests.pageSummary', { page, total })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1 || isLoading} onClick={() => void loadRequests(page - 1)}>
              {t('common.previous')}
            </Button>
            {visiblePages.map((pageNumber) => (
              <Button
                key={pageNumber}
                size="sm"
                variant={pageNumber === page ? 'default' : 'outline'}
                className={pageNumber === page ? 'bg-brand-gold text-black hover:bg-brand-gold-bright' : undefined}
                disabled={isLoading}
                onClick={() => void loadRequests(pageNumber)}
              >
                {pageNumber}
              </Button>
            ))}
            <Button size="sm" variant="outline" disabled={!hasMore || isLoading || page >= totalPages} onClick={() => void loadRequests(page + 1)}>
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}

      {/* Confirmation (approve / reject / regenerate) */}
      <ReusableModal
        isOpen={Boolean(pendingAction)}
        onClose={() => setPendingAction(null)}
        title={t('common.confirm')}
        className="max-w-lg"
      >
        {pendingAction ? (
          <div className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <code className="rounded-xl bg-black/30 px-3 py-1.5 text-xs font-semibold text-white">
                {pendingAction.request.reference}
              </code>

              {pendingAction.kind === 'reject' ? (
                <div className="mt-4">
                  <label htmlFor="reject-note" className="mb-2 block text-sm text-white/70">
                    {t('accountRequests.rejectNote')}
                  </label>
                  <textarea
                    id="reject-note"
                    value={pendingAction.note}
                    onChange={(event) => setPendingAction({ ...pendingAction, note: event.target.value })}
                    rows={3}
                    maxLength={255}
                    className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-brand-gold/60 focus-visible:ring-2 focus-visible:ring-brand-gold"
                  />
                </div>
              ) : (
                <p className="mt-4 text-sm leading-6 text-white/70">
                  {pendingAction.kind === 'approve' ? t('accountRequests.approveWarning') : t('accountRequests.regenerateWarning')}
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setPendingAction(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={() => confirmAction(pendingAction)}
                variant={pendingAction.kind === 'reject' ? 'destructive' : 'default'}
                className={pendingAction.kind === 'approve' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : undefined}
              >
                {pendingAction.kind === 'approve'
                  ? t('accountRequests.approve')
                  : pendingAction.kind === 'reject'
                    ? t('accountRequests.rejectConfirm')
                    : t('accountRequests.regenerateConfirm')}
              </Button>
            </div>
          </div>
        ) : null}
      </ReusableModal>

      {/* Code de connexion : affiché une seule fois */}
      <ReusableModal
        isOpen={Boolean(issuedCode)}
        onClose={() => setIssuedCode(null)}
        title={t('accountRequests.approveTitle')}
        className="max-w-md"
      >
        {issuedCode ? (
          <div className="space-y-5">
            <div className="rounded-2xl border border-brand-gold/40 bg-brand-gold/10 p-5 text-center">
              <p className="font-mono text-lg font-bold tracking-[0.12em] text-brand-gold">{issuedCode.code}</p>
              <p className="mt-3 text-xs leading-relaxed text-white/65">{t('accountRequests.approveWarning')}</p>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => void handleCopy(issuedCode.code, t('accountRequests.approveCopied'))}
              >
                <Copy className="mr-1 h-3.5 w-3.5" />
                {t('accountRequests.approveCopy')}
              </Button>
              <Button onClick={() => setIssuedCode(null)} className="bg-brand-gold text-black hover:bg-brand-gold-bright">
                <Clock3 className="mr-1 h-3.5 w-3.5" />
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        ) : null}
      </ReusableModal>
    </div>
  );
};

export default AccountRequestsManager;
