import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  CalendarClock,
  CheckCircle2,
  Copy,
  Gift,
  Plus,
  Power,
  Receipt,
  RefreshCcw,
  RotateCcw,
  Search,
  Tags,
  Trash2,
  Users,
  Wallet
} from 'lucide-react';

import {
  adminCreateSubscriptionBargain,
  adminCreateTransactionReceipt,
  adminDeleteSubscriptionBargain,
  adminUpdateSubscriptionBargain,
  adminUpdateSubscriptionUser,
  listAccountRequests,
  listSubscriptionBargains,
  listSubscriptionReceipts,
  listSubscriptionUsers,
  type AccountPlanId,
  type SubscriptionBargain,
  type SubscriptionReceipt,
  type SubscriptionUser
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
const QUICK_ADD_DAYS = [7, 31, 365];

const formatFcfa = (value: number) => `${Math.round(value)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

type ViewKey = 'users' | 'transactions' | 'receipts' | 'bargains';

type UserAction =
  | { kind: 'extend'; user: SubscriptionUser; days: number; date: string }
  | { kind: 'reset'; user: SubscriptionUser }
  | { kind: 'toggle'; user: SubscriptionUser };

interface BargainDraft {
  id: number | null;
  title: string;
  description: string;
  planId: AccountPlanId;
  priceFcfa: string;
  active: boolean;
  startsAt: string;
  endsAt: string;
}

const EMPTY_DRAFT: BargainDraft = {
  id: null,
  title: '',
  description: '',
  planId: 'month',
  priceFcfa: '',
  active: true,
  startsAt: '',
  endsAt: ''
};

/** Date HTML (YYYY-MM-DD) depuis une ISO, pour pré-remplir un champ de date. */
const toDateInputValue = (iso: string | null): string => {
  if (!iso) return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

/**
 * Console d'abonnements : le cycle de vie commercial des comptes CineHD.
 *   - Comptes : minuteur d'abonnement (prolonger / fixer / réinitialiser), activation.
 *   - Transactions : valider une transaction mobile money → création du compte + reçu.
 *   - Reçus : historique des paiements confirmés.
 *   - Offres : offres de renouvellement publiées sur la page de connexion.
 */
const SubscriptionsConsole: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<ViewKey>('users');

  // === Comptes ===
  const [users, setUsers] = useState<SubscriptionUser[]>([]);
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersHasMore, setUsersHasMore] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [areUsersLoading, setAreUsersLoading] = useState(false);
  const [pendingUserAction, setPendingUserAction] = useState<UserAction | null>(null);
  const [isSavingUser, setIsSavingUser] = useState(false);

  // === Transactions ===
  const [requests, setRequests] = useState<Awaited<ReturnType<typeof listAccountRequests>>['requests']>([]);
  const [requestsTotal, setRequestsTotal] = useState(0);
  const [requestsPage, setRequestsPage] = useState(1);
  const [requestsHasMore, setRequestsHasMore] = useState(false);
  const [onlyPending, setOnlyPending] = useState(true);
  const [areRequestsLoading, setAreRequestsLoading] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState<number | null>(null);
  const [receiptResult, setReceiptResult] = useState<{
    code?: string | null;
    receipt: SubscriptionReceipt | null;
  } | null>(null);

  // === Reçus ===
  const [receipts, setReceipts] = useState<SubscriptionReceipt[]>([]);
  const [receiptsPage, setReceiptsPage] = useState(1);
  const [receiptsTotal, setReceiptsTotal] = useState(0);
  const [receiptsHasMore, setReceiptsHasMore] = useState(false);
  const [receiptSearch, setReceiptSearch] = useState('');
  const [areReceiptsLoading, setAreReceiptsLoading] = useState(false);

  // === Offres ===
  const [bargains, setBargains] = useState<SubscriptionBargain[]>([]);
  const [areBargainsLoading, setAreBargainsLoading] = useState(false);
  const [draft, setDraft] = useState<BargainDraft | null>(null);
  const [isSavingBargain, setIsSavingBargain] = useState(false);
  const [bargainToDelete, setBargainToDelete] = useState<SubscriptionBargain | null>(null);

  const viewOptions = useMemo(
    () => [
      { key: 'users' as ViewKey, label: t('subscriptions.viewUsers'), icon: Users },
      { key: 'transactions' as ViewKey, label: t('subscriptions.viewTransactions'), icon: Wallet },
      { key: 'receipts' as ViewKey, label: t('subscriptions.viewReceipts'), icon: Receipt },
      { key: 'bargains' as ViewKey, label: t('subscriptions.viewBargains'), icon: Tags }
    ],
    [t]
  );

  const loadUsers = useCallback(async (requestedPage: number) => {
    try {
      setAreUsersLoading(true);
      const result = await listSubscriptionUsers({ search: userSearch, page: requestedPage, limit: PAGE_SIZE });
      setUsers(result.items);
      setUsersTotal(result.total);
      setUsersHasMore(result.hasMore);
      setUsersPage(result.page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('subscriptions.usersLoadError'));
    } finally {
      setAreUsersLoading(false);
    }
  }, [t, userSearch]);

  const loadRequests = useCallback(async (requestedPage: number) => {
    try {
      setAreRequestsLoading(true);
      const result = await listAccountRequests({
        status: onlyPending ? 'pending' : 'all',
        page: requestedPage,
        limit: PAGE_SIZE
      });
      setRequests(result.requests);
      setRequestsTotal(result.total);
      setRequestsHasMore(result.hasMore);
      setRequestsPage(result.page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('subscriptions.requestsLoadError'));
    } finally {
      setAreRequestsLoading(false);
    }
  }, [onlyPending, t]);

  const loadReceipts = useCallback(async (requestedPage: number) => {
    try {
      setAreReceiptsLoading(true);
      const result = await listSubscriptionReceipts({ search: receiptSearch, page: requestedPage, limit: PAGE_SIZE });
      setReceipts(result.items);
      setReceiptsTotal(result.total);
      setReceiptsHasMore(result.hasMore);
      setReceiptsPage(result.page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('subscriptions.receiptsLoadError'));
    } finally {
      setAreReceiptsLoading(false);
    }
  }, [receiptSearch, t]);

  const loadBargains = useCallback(async () => {
    try {
      setAreBargainsLoading(true);
      setBargains(await listSubscriptionBargains(true));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('subscriptions.bargainsLoadError'));
    } finally {
      setAreBargainsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (view === 'users') void loadUsers(1);
    if (view === 'transactions') void loadRequests(1);
    if (view === 'receipts') void loadReceipts(1);
    if (view === 'bargains') void loadBargains();
  }, [loadBargains, loadReceipts, loadRequests, loadUsers, view]);

  const planLabel = (planId: AccountPlanId) => (
    planId === 'week'
      ? t('subscriptions.planWeek')
      : planId === 'year'
        ? t('subscriptions.planYear')
        : t('subscriptions.planMonth')
  );

  const methodLabel = (methodId: string) => (
    methodId === 'orange_money' ? t('subscriptions.methodOrange') : t('subscriptions.methodMtn')
  );

  const formatDate = (iso: string | null) => formatVipDateTime(i18n.language, iso);

  /** Restreint le champ date à demain minimum, comme la saisie libre en jours. */
  const todayIsoDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const usersPagination = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(usersTotal / PAGE_SIZE));
    const start = Math.max(1, usersPage - 2);
    const end = Math.min(totalPages, start + 4);
    return Array.from({ length: Math.max(0, end - Math.max(1, end - 4) + 1) }, (_, index) => Math.max(1, end - 4) + index);
  }, [usersPage, usersTotal]);

  const runUserAction = async (action: UserAction) => {
    try {
      setIsSavingUser(true);
      if (action.kind === 'extend') {
        if (action.date) {
          await adminUpdateSubscriptionUser(action.user.id, {
            expiresAt: `${action.date} 23:59:59`
          });
          toast.success(t('subscriptions.expirySet'));
        } else {
          await adminUpdateSubscriptionUser(action.user.id, { addDays: action.days });
          toast.success(t('subscriptions.extended', { days: action.days, username: action.user.username }));
        }
      } else if (action.kind === 'reset') {
        await adminUpdateSubscriptionUser(action.user.id, { expiresAt: null });
        toast.success(t('subscriptions.resetDone', { username: action.user.username }));
      } else {
        await adminUpdateSubscriptionUser(action.user.id, { active: !action.user.active });
        toast.success(
          action.user.active
            ? t('subscriptions.deactivated', { username: action.user.username })
            : t('subscriptions.activated', { username: action.user.username })
        );
      }
      setPendingUserAction(null);
      await loadUsers(usersPage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('subscriptions.actionError'));
    } finally {
      setIsSavingUser(false);
    }
  };

  const generateReceipt = async (requestId: number) => {
    try {
      setProcessingRequestId(requestId);
      const result = await adminCreateTransactionReceipt(requestId);
      setReceiptResult({ code: result.code || null, receipt: result.receipt || null });
      toast.success(t('subscriptions.receiptCreated'));
      await loadRequests(requestsPage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('subscriptions.receiptError'));
    } finally {
      setProcessingRequestId(null);
    }
  };

  const saveBargain = async () => {
    if (!draft) return;
    const title = draft.title.trim();
    const price = Number(draft.priceFcfa);
    if (!title) {
      toast.error(t('subscriptions.bargainTitleRequired'));
      return;
    }
    if (!Number.isInteger(price) || price <= 0) {
      toast.error(t('subscriptions.bargainPriceInvalid'));
      return;
    }

    const payload = {
      title,
      description: draft.description.trim() || null,
      planId: draft.planId,
      priceFcfa: price,
      active: draft.active,
      startsAt: draft.startsAt ? `${draft.startsAt} 00:00:00` : null,
      endsAt: draft.endsAt ? `${draft.endsAt} 23:59:59` : null
    };

    try {
      setIsSavingBargain(true);
      if (draft.id === null) {
        await adminCreateSubscriptionBargain(payload);
        toast.success(t('subscriptions.bargainCreated'));
      } else {
        await adminUpdateSubscriptionBargain(draft.id, payload);
        toast.success(t('subscriptions.bargainUpdated'));
      }
      setDraft(null);
      await loadBargains();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('subscriptions.actionError'));
    } finally {
      setIsSavingBargain(false);
    }
  };

  const deleteBargain = async () => {
    if (!bargainToDelete) return;
    try {
      setIsSavingBargain(true);
      await adminDeleteSubscriptionBargain(bargainToDelete.id);
      toast.success(t('subscriptions.bargainDeleted'));
      setBargainToDelete(null);
      await loadBargains();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('subscriptions.actionError'));
    } finally {
      setIsSavingBargain(false);
    }
  };

  const handleCopy = async (value: string) => {
    if (await copyText(value)) {
      toast.success(t('subscriptions.codeCopied'));
    } else {
      toast.error(t('common.error'));
    }
  };

  const openCreateDraft = () => setDraft({ ...EMPTY_DRAFT });

  const openEditDraft = (bargain: SubscriptionBargain) => setDraft({
    id: bargain.id,
    title: bargain.title,
    description: bargain.description || '',
    planId: bargain.planId,
    priceFcfa: String(bargain.priceFcfa),
    active: bargain.active,
    startsAt: toDateInputValue(bargain.startsAt),
    endsAt: toDateInputValue(bargain.endsAt)
  });

  return (
    <div className="space-y-6">
      <AnimatedBorderCard highlightColor="200 144 40" backgroundColor="10 10 10" className="p-6 md:p-7">
        <div className="space-y-5">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-gold/30 bg-brand-gold/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-amber-100">
              <CalendarClock className="h-4 w-4" />
              {t('subscriptions.sectionTitle')}
            </div>
            <div>
              <ShinyText
                text={t('subscriptions.sectionTitle')}
                speed={2}
                color="#c89028"
                shineColor="#ffffff"
                className="text-3xl font-bold"
              />
              <p className="mt-2 text-sm leading-6 text-white/55">{t('subscriptions.sectionDesc')}</p>
            </div>
          </div>

          <div
            role="tablist"
            aria-label={t('subscriptions.sectionTitle')}
            className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/5 p-1 sm:grid-cols-4"
          >
            {viewOptions.map((option) => {
              const Icon = option.icon;
              const isActive = view === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setView(option.key)}
                  className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold sm:text-sm ${
                    isActive ? 'bg-brand-gold text-black' : 'text-white/70 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </AnimatedBorderCard>

      {/* === Comptes === */}
      {view === 'users' && (
        <>
          <div className="grid gap-4 xl:grid-cols-[1fr_auto]">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <Search className="h-4 w-4 text-white opacity-[0.35]" />
              <input
                type="text"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder={t('subscriptions.usersSearchPlaceholder')}
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25"
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => void loadUsers(usersPage)} disabled={areUsersLoading}>
              <RefreshCcw className={`mr-1 h-3.5 w-3.5 ${areUsersLoading ? 'animate-spin' : ''}`} />
              {t('common.refresh')}
            </Button>
          </div>

          <BlurText
            text={t('subscriptions.usersTotal', { count: usersTotal })}
            delay={40}
            className="text-sm font-medium text-white/75"
          />

          {areUsersLoading && users.length === 0 ? (
            <AnimatedBorderCard highlightColor="200 144 40" backgroundColor="10 10 10" className="p-10 text-center">
              <p className="text-white/55">{t('common.loading')}</p>
            </AnimatedBorderCard>
          ) : users.length === 0 ? (
            <AnimatedBorderCard highlightColor="148 163 184" backgroundColor="10 10 10" className="p-10 text-center">
              <p className="text-white/45">{t('subscriptions.usersEmpty')}</p>
            </AnimatedBorderCard>
          ) : (
            <div className="space-y-4">
              {users.map((user) => {
                const expiresAt = user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) : null;
                const isExpired = Boolean(expiresAt && expiresAt.getTime() <= Date.now());
                return (
                  <AnimatedBorderCard
                    key={user.id}
                    highlightColor={!user.active ? '239 68 68' : isExpired ? '245 158 11' : '34 197 94'}
                    backgroundColor="10 10 10"
                    className="p-5"
                  >
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-white">{user.username}</p>
                          <p className="font-mono text-xs text-white/35">{user.userId}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                              !user.active
                                ? 'border-red-400/35 bg-red-500/15 text-red-100'
                                : isExpired
                                  ? 'border-amber-400/35 bg-amber-500/15 text-amber-200'
                                  : 'border-emerald-300/35 bg-emerald-500/15 text-emerald-100'
                            }`}
                          >
                            {!user.active
                              ? t('subscriptions.statusInactive')
                              : isExpired
                                ? t('subscriptions.statusExpired')
                                : t('subscriptions.statusActive')}
                          </span>
                          {user.hasPassword && (
                            <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/60">
                              {t('subscriptions.hasPassword')}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-3 text-sm text-white/58 md:grid-cols-3">
                        <div>
                          <p className="text-white/30">{t('subscriptions.expiry')}</p>
                          <p className="font-semibold text-white">{formatDate(user.subscriptionExpiresAt)}</p>
                        </div>
                        <div>
                          <p className="text-white/30">{t('subscriptions.lastLogin')}</p>
                          <p className="font-semibold text-white">{formatDate(user.lastLoginAt)}</p>
                        </div>
                        <div>
                          <p className="text-white/30">{t('subscriptions.createdAt')}</p>
                          <p className="font-semibold text-white">{formatDate(user.createdAt)}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 xl:justify-end">
                        <Button
                          size="sm"
                          className="bg-brand-gold text-black hover:bg-brand-gold-bright"
                          onClick={() => setPendingUserAction({ kind: 'extend', user, days: 31, date: '' })}
                        >
                          <CalendarClock className="mr-1 h-3.5 w-3.5" />
                          {t('subscriptions.extend')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPendingUserAction({ kind: 'reset', user })}
                        >
                          <RotateCcw className="mr-1 h-3.5 w-3.5" />
                          {t('subscriptions.reset')}
                        </Button>
                        <Button
                          size="sm"
                          variant={user.active ? 'destructive' : 'default'}
                          onClick={() => setPendingUserAction({ kind: 'toggle', user })}
                        >
                          <Power className="mr-1 h-3.5 w-3.5" />
                          {user.active ? t('subscriptions.deactivate') : t('subscriptions.activate')}
                        </Button>
                      </div>
                    </div>
                  </AnimatedBorderCard>
                );
              })}
            </div>
          )}

          {usersTotal > PAGE_SIZE && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={usersPage <= 1 || areUsersLoading} onClick={() => void loadUsers(usersPage - 1)}>
                {t('common.previous')}
              </Button>
              {usersPagination.map((pageNumber) => (
                <Button
                  key={pageNumber}
                  size="sm"
                  variant={pageNumber === usersPage ? 'default' : 'outline'}
                  className={pageNumber === usersPage ? 'bg-brand-gold text-black hover:bg-brand-gold-bright' : undefined}
                  disabled={areUsersLoading}
                  onClick={() => void loadUsers(pageNumber)}
                >
                  {pageNumber}
                </Button>
              ))}
              <Button size="sm" variant="outline" disabled={!usersHasMore || areUsersLoading} onClick={() => void loadUsers(usersPage + 1)}>
                {t('common.next')}
              </Button>
            </div>
          )}
        </>
      )}

      {/* === Transactions === */}
      {view === 'transactions' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-white/45">
              {t('subscriptions.requestsTotal', { count: requestsTotal })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={onlyPending ? 'default' : 'outline'} onClick={() => setOnlyPending(true)}>
                {t('subscriptions.onlyPending')}
              </Button>
              <Button size="sm" variant={!onlyPending ? 'default' : 'outline'} onClick={() => setOnlyPending(false)}>
                {t('subscriptions.allRequests')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void loadRequests(requestsPage)} disabled={areRequestsLoading}>
                <RefreshCcw className={`mr-1 h-3.5 w-3.5 ${areRequestsLoading ? 'animate-spin' : ''}`} />
                {t('common.refresh')}
              </Button>
            </div>
          </div>

          {areRequestsLoading && requests.length === 0 ? (
            <AnimatedBorderCard highlightColor="200 144 40" backgroundColor="10 10 10" className="p-10 text-center">
              <p className="text-white/55">{t('common.loading')}</p>
            </AnimatedBorderCard>
          ) : requests.length === 0 ? (
            <AnimatedBorderCard highlightColor="148 163 184" backgroundColor="10 10 10" className="p-10 text-center">
              <p className="text-white/45">{t('subscriptions.requestsEmpty')}</p>
            </AnimatedBorderCard>
          ) : (
            <div className="space-y-4">
              {requests.map((request) => (
                <AnimatedBorderCard
                  key={request.id}
                  highlightColor={request.status === 'pending' ? '245 158 11' : request.status === 'approved' ? '34 197 94' : '239 68 68'}
                  backgroundColor="10 10 10"
                  className="p-5"
                >
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-mono text-sm font-semibold text-brand-gold">{request.reference}</p>
                        <p className="text-sm text-white/60">{request.username}</p>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                          request.status === 'pending'
                            ? 'border-amber-400/35 bg-amber-500/15 text-amber-200'
                            : request.status === 'approved'
                              ? 'border-emerald-300/35 bg-emerald-500/15 text-emerald-100'
                              : 'border-red-400/35 bg-red-500/15 text-red-100'
                        }`}
                      >
                        {request.status === 'pending'
                          ? t('subscriptions.requestPending')
                          : request.status === 'approved'
                            ? t('subscriptions.requestApproved')
                            : t('subscriptions.requestRejected')}
                      </span>
                    </div>

                    <div className="grid gap-3 text-sm text-white/58 md:grid-cols-4">
                      <div>
                        <p className="text-white/30">{t('subscriptions.plan')}</p>
                        <p className="font-semibold text-white">{planLabel(request.planId)}</p>
                      </div>
                      <div>
                        <p className="text-white/30">{t('subscriptions.amount')}</p>
                        <p className="font-semibold text-white">{t('login.amountValue', { amount: formatFcfa(request.amountFcfa) })}</p>
                      </div>
                      <div>
                        <p className="text-white/30">{t('subscriptions.method')}</p>
                        <p className="font-semibold text-white">{methodLabel(request.paymentMethod)}</p>
                      </div>
                      <div>
                        <p className="text-white/30">{t('subscriptions.submittedAt')}</p>
                        <p className="font-semibold text-white">{formatDate(request.createdAt || null)}</p>
                      </div>
                    </div>

                    {request.status !== 'rejected' && (
                      <div className="flex flex-wrap gap-2 xl:justify-end">
                        <Button
                          size="sm"
                          className="bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={() => void generateReceipt(request.id)}
                          disabled={processingRequestId === request.id}
                        >
                          <Receipt className="mr-1 h-3.5 w-3.5" />
                          {t('subscriptions.generateReceipt')}
                        </Button>
                      </div>
                    )}
                  </div>
                </AnimatedBorderCard>
              ))}
            </div>
          )}

          {requestsTotal > PAGE_SIZE && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={requestsPage <= 1 || areRequestsLoading} onClick={() => void loadRequests(requestsPage - 1)}>
                {t('common.previous')}
              </Button>
              <Button size="sm" variant="outline" disabled={!requestsHasMore || areRequestsLoading} onClick={() => void loadRequests(requestsPage + 1)}>
                {t('common.next')}
              </Button>
            </div>
          )}
        </>
      )}

      {/* === Reçus === */}
      {view === 'receipts' && (
        <>
          <div className="grid gap-4 xl:grid-cols-[1fr_auto]">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <Search className="h-4 w-4 text-white opacity-[0.35]" />
              <input
                type="text"
                value={receiptSearch}
                onChange={(event) => setReceiptSearch(event.target.value)}
                placeholder={t('subscriptions.receiptsSearchPlaceholder')}
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25"
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => void loadReceipts(receiptsPage)} disabled={areReceiptsLoading}>
              <RefreshCcw className={`mr-1 h-3.5 w-3.5 ${areReceiptsLoading ? 'animate-spin' : ''}`} />
              {t('common.refresh')}
            </Button>
          </div>

          <p className="text-sm text-white/45">{t('subscriptions.receiptsTotal', { count: receiptsTotal })}</p>

          {areReceiptsLoading && receipts.length === 0 ? (
            <AnimatedBorderCard highlightColor="200 144 40" backgroundColor="10 10 10" className="p-10 text-center">
              <p className="text-white/55">{t('common.loading')}</p>
            </AnimatedBorderCard>
          ) : receipts.length === 0 ? (
            <AnimatedBorderCard highlightColor="148 163 184" backgroundColor="10 10 10" className="p-10 text-center">
              <p className="text-white/45">{t('subscriptions.receiptsEmpty')}</p>
            </AnimatedBorderCard>
          ) : (
            <div className="space-y-4">
              {receipts.map((receipt) => (
                <AnimatedBorderCard key={receipt.id} highlightColor="34 197 94" backgroundColor="10 10 10" className="p-5">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-mono text-sm font-semibold text-brand-gold">{receipt.publicId}</p>
                        <p className="text-sm text-white/60">{receipt.username}</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => void handleCopy(receipt.publicId)}>
                        <Copy className="mr-1 h-3.5 w-3.5" />
                        {t('common.copy')}
                      </Button>
                    </div>

                    <div className="grid gap-3 text-sm text-white/58 md:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <p className="text-white/30">{t('subscriptions.plan')}</p>
                        <p className="font-semibold text-white">
                          {planLabel(receipt.planId)} · {t('login.planDays', { days: receipt.planDays })}
                        </p>
                      </div>
                      <div>
                        <p className="text-white/30">{t('subscriptions.amount')}</p>
                        <p className="font-semibold text-white">{t('login.amountValue', { amount: formatFcfa(receipt.amountFcfa) })}</p>
                      </div>
                      <div>
                        <p className="text-white/30">{t('subscriptions.method')}</p>
                        <p className="font-semibold text-white">{methodLabel(receipt.paymentMethod)}</p>
                      </div>
                      <div>
                        <p className="text-white/30">{t('subscriptions.reference')}</p>
                        <p className="break-all font-mono font-semibold text-white">{receipt.paymentReference}</p>
                      </div>
                      <div>
                        <p className="text-white/30">{t('subscriptions.validFrom')}</p>
                        <p className="font-semibold text-white">{formatDate(receipt.validFrom)}</p>
                      </div>
                      <div>
                        <p className="text-white/30">{t('subscriptions.validUntil')}</p>
                        <p className="font-semibold text-white">{formatDate(receipt.validUntil)}</p>
                      </div>
                      <div>
                        <p className="text-white/30">{t('subscriptions.issuedAt')}</p>
                        <p className="font-semibold text-white">{formatDate(receipt.createdAt)}</p>
                      </div>
                    </div>
                  </div>
                </AnimatedBorderCard>
              ))}
            </div>
          )}

          {receiptsTotal > PAGE_SIZE && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={receiptsPage <= 1 || areReceiptsLoading} onClick={() => void loadReceipts(receiptsPage - 1)}>
                {t('common.previous')}
              </Button>
              <Button size="sm" variant="outline" disabled={!receiptsHasMore || areReceiptsLoading} onClick={() => void loadReceipts(receiptsPage + 1)}>
                {t('common.next')}
              </Button>
            </div>
          )}
        </>
      )}

      {/* === Offres === */}
      {view === 'bargains' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-white/45">{t('subscriptions.bargainsIntro')}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void loadBargains()} disabled={areBargainsLoading}>
                <RefreshCcw className={`mr-1 h-3.5 w-3.5 ${areBargainsLoading ? 'animate-spin' : ''}`} />
                {t('common.refresh')}
              </Button>
              <Button size="sm" className="bg-brand-gold text-black hover:bg-brand-gold-bright" onClick={openCreateDraft}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('subscriptions.createBargain')}
              </Button>
            </div>
          </div>

          {areBargainsLoading && bargains.length === 0 ? (
            <AnimatedBorderCard highlightColor="200 144 40" backgroundColor="10 10 10" className="p-10 text-center">
              <p className="text-white/55">{t('common.loading')}</p>
            </AnimatedBorderCard>
          ) : bargains.length === 0 ? (
            <AnimatedBorderCard highlightColor="148 163 184" backgroundColor="10 10 10" className="p-10 text-center">
              <p className="text-white/45">{t('subscriptions.bargainsEmpty')}</p>
            </AnimatedBorderCard>
          ) : (
            <div className="space-y-4">
              {bargains.map((bargain) => (
                <AnimatedBorderCard
                  key={bargain.id}
                  highlightColor={bargain.active ? '200 144 40' : '148 163 184'}
                  backgroundColor="10 10 10"
                  className="p-5"
                >
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-white">{bargain.title}</p>
                        {bargain.description && (
                          <p className="text-xs leading-relaxed text-white/50">{bargain.description}</p>
                        )}
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                          bargain.active
                            ? 'border-emerald-300/35 bg-emerald-500/15 text-emerald-100'
                            : 'border-white/15 bg-white/5 text-white/55'
                        }`}
                      >
                        {bargain.active ? t('subscriptions.bargainActive') : t('subscriptions.bargainInactive')}
                      </span>
                    </div>

                    <div className="grid gap-3 text-sm text-white/58 md:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <p className="text-white/30">{t('subscriptions.plan')}</p>
                        <p className="font-semibold text-white">{planLabel(bargain.planId)}</p>
                      </div>
                      <div>
                        <p className="text-white/30">{t('subscriptions.price')}</p>
                        <p className="font-semibold text-white">{t('login.amountValue', { amount: formatFcfa(bargain.priceFcfa) })}</p>
                      </div>
                      <div>
                        <p className="text-white/30">{t('subscriptions.startsAt')}</p>
                        <p className="font-semibold text-white">{formatDate(bargain.startsAt)}</p>
                      </div>
                      <div>
                        <p className="text-white/30">{t('subscriptions.endsAt')}</p>
                        <p className="font-semibold text-white">{formatDate(bargain.endsAt)}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 xl:justify-end">
                      <Button size="sm" variant="outline" onClick={() => openEditDraft(bargain)}>
                        {t('subscriptions.editBargain')}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setBargainToDelete(bargain)}>
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        {t('subscriptions.deleteBargain')}
                      </Button>
                    </div>
                  </div>
                </AnimatedBorderCard>
              ))}
            </div>
          )}
        </>
      )}

      {/* Action sur le minuteur d'un compte */}
      <ReusableModal
        isOpen={Boolean(pendingUserAction)}
        onClose={() => setPendingUserAction(null)}
        title={
          pendingUserAction?.kind === 'extend'
            ? t('subscriptions.extendTitle')
            : pendingUserAction?.kind === 'reset'
              ? t('subscriptions.resetTitle')
              : t('subscriptions.toggleTitle')
        }
        className="max-w-lg"
      >
        {pendingUserAction ? (
          <div className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-sm font-semibold text-white">{pendingUserAction.user.username}</p>

              {pendingUserAction.kind === 'extend' && (
                <div className="mt-4 space-y-4">
                  <div>
                    <p className="mb-2 text-sm text-white/70">{t('subscriptions.extendQuick')}</p>
                    <div className="flex flex-wrap gap-2">
                      {QUICK_ADD_DAYS.map((days) => (
                        <Button
                          key={days}
                          size="sm"
                          variant={pendingUserAction.days === days && !pendingUserAction.date ? 'default' : 'outline'}
                          onClick={() => setPendingUserAction({ ...pendingUserAction, days, date: '' })}
                        >
                          {t('subscriptions.extendDays', { days })}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="extend-custom-days" className="mb-2 block text-sm text-white/70">
                      {t('subscriptions.extendCustom')}
                    </label>
                    <input
                      id="extend-custom-days"
                      type="number"
                      min={0}
                      max={3650}
                      value={pendingUserAction.days}
                      onChange={(event) =>
                        setPendingUserAction({ ...pendingUserAction, days: Number(event.target.value), date: '' })
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-brand-gold/60 focus-visible:ring-2 focus-visible:ring-brand-gold"
                    />
                  </div>

                  <div>
                    <label htmlFor="extend-date" className="mb-2 block text-sm text-white/70">
                      {t('subscriptions.extendDate')}
                    </label>
                    <input
                      id="extend-date"
                      type="date"
                      min={todayIsoDate}
                      value={pendingUserAction.date}
                      onChange={(event) => setPendingUserAction({ ...pendingUserAction, date: event.target.value })}
                      className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-brand-gold/60 focus-visible:ring-2 focus-visible:ring-brand-gold"
                    />
                    <p className="mt-1 text-xs text-white/40">{t('subscriptions.extendDateHint')}</p>
                  </div>
                </div>
              )}

              {pendingUserAction.kind === 'reset' && (
                <p className="mt-4 text-sm leading-6 text-white/70">{t('subscriptions.resetWarning')}</p>
              )}

              {pendingUserAction.kind === 'toggle' && (
                <p className="mt-4 text-sm leading-6 text-white/70">
                  {pendingUserAction.user.active
                    ? t('subscriptions.deactivateWarning')
                    : t('subscriptions.activateWarning')}
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setPendingUserAction(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={() => void runUserAction(pendingUserAction)}
                disabled={isSavingUser || (pendingUserAction.kind === 'extend' && pendingUserAction.days < 0)}
                variant={pendingUserAction.kind === 'toggle' && pendingUserAction.user.active ? 'destructive' : 'default'}
                className={pendingUserAction.kind !== 'toggle' ? 'bg-brand-gold text-black hover:bg-brand-gold-bright' : undefined}
              >
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        ) : null}
      </ReusableModal>

      {/* Résultat de la validation : code (une seule fois) + reçu */}
      <ReusableModal
        isOpen={Boolean(receiptResult)}
        onClose={() => setReceiptResult(null)}
        title={t('subscriptions.receiptTitle')}
        className="max-w-md"
      >
        {receiptResult ? (
          <div className="space-y-5">
            {receiptResult.code && (
              <div className="rounded-2xl border border-brand-gold/40 bg-brand-gold/10 p-5 text-center">
                <p className="font-mono text-lg font-bold tracking-[0.12em] text-brand-gold">{receiptResult.code}</p>
                <p className="mt-3 text-xs leading-relaxed text-white/65">{t('subscriptions.codeWarning')}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => void handleCopy(receiptResult.code || '')}
                >
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  {t('subscriptions.copyCode')}
                </Button>
              </div>
            )}

            {receiptResult.receipt && (
              <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/5 p-5">
                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-100">
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                  {t('subscriptions.receiptSummary', {
                    publicId: receiptResult.receipt.publicId,
                    until: formatDate(receiptResult.receipt.validUntil)
                  })}
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={() => setReceiptResult(null)} className="bg-brand-gold text-black hover:bg-brand-gold-bright">
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        ) : null}
      </ReusableModal>

      {/* Création / édition d'une offre */}
      <ReusableModal
        isOpen={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id === null ? t('subscriptions.createBargain') : t('subscriptions.editBargain')}
        className="max-w-lg"
      >
        {draft ? (
          <div className="space-y-4">
            <div>
              <label htmlFor="bargain-title" className="mb-2 block text-sm text-white/70">
                {t('subscriptions.bargainTitle')}
              </label>
              <input
                id="bargain-title"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                maxLength={128}
                className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-brand-gold/60 focus-visible:ring-2 focus-visible:ring-brand-gold"
              />
            </div>

            <div>
              <label htmlFor="bargain-description" className="mb-2 block text-sm text-white/70">
                {t('subscriptions.bargainDescription')}
              </label>
              <textarea
                id="bargain-description"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                rows={3}
                maxLength={500}
                className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-brand-gold/60 focus-visible:ring-2 focus-visible:ring-brand-gold"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm text-white/70">{t('subscriptions.plan')}</p>
                <Select value={draft.planId} onValueChange={(value) => setDraft({ ...draft, planId: value as AccountPlanId })}>
                  <SelectTrigger className="h-9 w-full rounded-md border-white/10 bg-transparent px-3 text-sm hover:bg-white/10">
                    <span className="truncate">{planLabel(draft.planId)}</span>
                  </SelectTrigger>
                  <SelectContent className="rounded-md border-white/10 bg-[#111111]/95">
                    <SelectItem value="week">{t('subscriptions.planWeek')}</SelectItem>
                    <SelectItem value="month">{t('subscriptions.planMonth')}</SelectItem>
                    <SelectItem value="year">{t('subscriptions.planYear')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label htmlFor="bargain-price" className="mb-2 block text-sm text-white/70">
                  {t('subscriptions.price')}
                </label>
                <input
                  id="bargain-price"
                  type="number"
                  min={1}
                  value={draft.priceFcfa}
                  onChange={(event) => setDraft({ ...draft, priceFcfa: event.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-brand-gold/60 focus-visible:ring-2 focus-visible:ring-brand-gold"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="bargain-starts" className="mb-2 block text-sm text-white/70">
                  {t('subscriptions.startsAt')}
                </label>
                <input
                  id="bargain-starts"
                  type="date"
                  value={draft.startsAt}
                  onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-brand-gold/60 focus-visible:ring-2 focus-visible:ring-brand-gold"
                />
              </div>
              <div>
                <label htmlFor="bargain-ends" className="mb-2 block text-sm text-white/70">
                  {t('subscriptions.endsAt')}
                </label>
                <input
                  id="bargain-ends"
                  type="date"
                  value={draft.endsAt}
                  onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-brand-gold/60 focus-visible:ring-2 focus-visible:ring-brand-gold"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
                className="h-4 w-4 rounded border-white/20 bg-black/50"
              />
              {t('subscriptions.bargainActive')}
            </label>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={() => void saveBargain()}
                disabled={isSavingBargain}
                className="bg-brand-gold text-black hover:bg-brand-gold-bright"
              >
                <Gift className="mr-1 h-3.5 w-3.5" />
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        ) : null}
      </ReusableModal>

      {/* Suppression d'une offre */}
      <ReusableModal
        isOpen={Boolean(bargainToDelete)}
        onClose={() => setBargainToDelete(null)}
        title={t('subscriptions.deleteBargain')}
        className="max-w-md"
      >
        {bargainToDelete ? (
          <div className="space-y-6">
            <p className="text-sm leading-6 text-white/70">
              {t('subscriptions.deleteWarning', { title: bargainToDelete.title })}
            </p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setBargainToDelete(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="destructive" onClick={() => void deleteBargain()} disabled={isSavingBargain}>
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {t('subscriptions.deleteBargain')}
              </Button>
            </div>
          </div>
        ) : null}
      </ReusableModal>
    </div>
  );
};

export default SubscriptionsConsole;
