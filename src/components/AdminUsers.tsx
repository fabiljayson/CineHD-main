import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from 'lucide-react';

import { formatVipDateTime } from '../utils/vipDonationsUi';
import ReusableModal from './ui/reusable-modal';
import {
  fetchAdminUser,
  fetchAdminUsers,
  setAdminUserPassword,
  updateAdminUserPreferences,
  type AdminUser,
  type AdminUserDetailResponse,
  type AdminUsersResponse,
  type UserSubscriptionState,
} from '../services/adminUsersService';

const PAGE_SIZE = 25;
const QUICK_ADD_DAYS = [7, 31, 365];

type StatusFilter = '' | UserSubscriptionState;

const STATUS_TONE: Record<UserSubscriptionState, string> = {
  active: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20',
  expired: 'bg-red-500/10 text-red-300 ring-red-500/20',
  disabled: 'bg-amber-500/10 text-amber-300 ring-amber-500/20',
  'no-timer': 'bg-sky-500/10 text-sky-300 ring-sky-500/20',
  none: 'bg-white/5 text-white/50 ring-white/10',
};

const PROVIDER_LABEL: Record<string, string> = {
  bip39: 'CINE',
  discord: 'Discord',
  google: 'Google',
  unknown: '—',
};

const toDateInputValue = (iso: string | null): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const AdminUsers: React.FC = () => {
  const { t, i18n } = useTranslation();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<AdminUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [detail, setDetail] = useState<AdminUserDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [expiryDraft, setExpiryDraft] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');

  // Recherche : on n'envoie pas une requête par frappe.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAdminUsers({
        search: search || undefined,
        provider: provider || undefined,
        status: status || undefined,
        role: role || undefined,
        page,
        limit: PAGE_SIZE,
      }));
    } catch (err) {
      console.error('Admin users load error:', err);
      setError(t('admin.users.loadError', 'Impossible de charger les utilisateurs.'));
    } finally {
      setLoading(false);
    }
  }, [page, provider, role, search, status, t]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = useCallback(async (user: AdminUser) => {
    setSelected(user);
    setDetail(null);
    setDetailLoading(true);
    setPasswordDraft('');
    try {
      const payload = await fetchAdminUser(user.userType, user.userId);
      setDetail(payload);
      setExpiryDraft(toDateInputValue(payload.user.account?.subscriptionExpiresAt ?? null));
    } catch (err) {
      console.error('Admin user detail error:', err);
      toast.error(t('admin.users.detailError', 'Impossible de charger cette fiche.'));
      setSelected(null);
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  const closeDetail = useCallback(() => {
    setSelected(null);
    setDetail(null);
    setPasswordDraft('');
  }, []);

  const refreshAfterSave = useCallback(async (user: AdminUser) => {
    await load();
    try {
      const payload = await fetchAdminUser(user.userType, user.userId);
      setDetail(payload);
      setExpiryDraft(toDateInputValue(payload.user.account?.subscriptionExpiresAt ?? null));
    } catch {
      /* la liste est déjà à jour, la fiche se rechargera à la réouverture */
    }
  }, [load]);

  const patch = useCallback(async (user: AdminUser, body: Parameters<typeof updateAdminUserPreferences>[2], successKey: string) => {
    setSaving(true);
    try {
      await updateAdminUserPreferences(user.userType, user.userId, body);
      toast.success(t(successKey, 'Enregistré.'));
      await refreshAfterSave(user);
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(message || t('admin.users.saveError', 'La modification a échoué.'));
    } finally {
      setSaving(false);
    }
  }, [refreshAfterSave, t]);

  const submitPassword = useCallback(async (user: AdminUser) => {
    if (passwordDraft.length < 8) {
      toast.error(t('admin.users.passwordTooShort', 'Le mot de passe doit contenir au moins 8 caractères.'));
      return;
    }
    setSaving(true);
    try {
      await setAdminUserPassword(user.userType, user.userId, passwordDraft);
      setPasswordDraft('');
      toast.success(t('admin.users.passwordSaved', 'Mot de passe mis à jour.'));
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(message || t('admin.users.saveError', 'La modification a échoué.'));
    } finally {
      setSaving(false);
    }
  }, [passwordDraft, t]);

  const summary = data?.summary;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  const statTiles = useMemo(() => ([
    { label: t('admin.users.statTotal', 'Utilisateurs'), value: summary?.total ?? 0, icon: Users },
    { label: t('admin.users.statActive', 'Abonnements actifs'), value: summary?.bySubscription.active ?? 0, icon: ShieldCheck },
    { label: t('admin.users.statExpired', 'Expirés'), value: summary?.bySubscription.expired ?? 0, icon: CalendarClock },
    { label: t('admin.users.statStaff', 'Équipe'), value: summary?.staff ?? 0, icon: KeyRound },
  ]), [summary, t]);

  const formatDate = (iso: string | null) => (iso ? formatVipDateTime(i18n.language, iso) : '—');

  const renderRow = (user: AdminUser) => {
    const state = (user.subscriptionState || 'none') as UserSubscriptionState;
    return (
      <button
        key={`${user.userType}:${user.userId}`}
        type="button"
        onClick={() => openDetail(user)}
        className="grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-white/5 px-4 py-3 text-left transition hover:bg-white/5 md:grid-cols-[minmax(0,2fr)_auto_auto_auto]"
      >
        <div className="flex min-w-0 items-center gap-3">
          {user.avatar ? (
            <img src={user.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/10" loading="lazy" />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
              <UserRound className="h-4 w-4 text-white/50" aria-hidden="true" />
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-white">
              {user.username || user.account?.username || t('admin.users.unnamed', 'Sans nom')}
            </span>
            <span className="block truncate text-xs text-white/45">
              {PROVIDER_LABEL[user.provider] || user.provider} · {user.userId.slice(0, 12)}
            </span>
          </span>
        </div>

        <span className="hidden text-xs text-white/50 md:block">{formatDate(user.lastSeen || user.account?.lastLoginAt || null)}</span>

        <span className={`hidden rounded-full px-2 py-1 text-[11px] font-medium ring-1 md:inline-flex ${STATUS_TONE[state]}`}>
          {t(`admin.users.state.${state}`, state)}
        </span>

        <span className="flex items-center justify-end gap-2">
          {user.role && (
            <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-medium text-white/80">
              {user.role}
            </span>
          )}
          <ChevronRight className="h-4 w-4 text-white/30" aria-hidden="true" />
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">{t('admin.users.searchLabel', 'Rechercher un utilisateur')}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" aria-hidden="true" />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t('admin.users.searchPlaceholder', 'Nom, identifiant…')}
            className="h-10 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-white placeholder:text-white/35 focus:border-white/25 focus:outline-none"
          />
        </label>

        <select
          value={provider}
          onChange={(event) => { setProvider(event.target.value); setPage(1); }}
          aria-label={t('admin.users.filterProvider', 'Fournisseur')}
          className="h-10 rounded-lg border border-white/10 bg-[#111] px-3 text-sm text-white focus:border-white/25 focus:outline-none"
        >
          <option value="">{t('admin.users.allProviders', 'Tous les fournisseurs')}</option>
          <option value="bip39">{t('admin.users.providerBip39', 'Compte CINE')}</option>
          <option value="discord">Discord</option>
          <option value="google">Google</option>
        </select>

        <select
          value={status}
          onChange={(event) => { setStatus(event.target.value as StatusFilter); setPage(1); }}
          aria-label={t('admin.users.filterStatus', 'État')}
          className="h-10 rounded-lg border border-white/10 bg-[#111] px-3 text-sm text-white focus:border-white/25 focus:outline-none"
        >
          <option value="">{t('admin.users.allStatuses', 'Tous les états')}</option>
          <option value="active">{t('admin.users.state.active', 'Actif')}</option>
          <option value="expired">{t('admin.users.state.expired', 'Expiré')}</option>
          <option value="disabled">{t('admin.users.state.disabled', 'Désactivé')}</option>
          <option value="no-timer">{t('admin.users.state.no-timer', 'Sans minuteur')}</option>
          <option value="none">{t('admin.users.state.none', 'Sans abonnement')}</option>
        </select>

        <select
          value={role}
          onChange={(event) => { setRole(event.target.value); setPage(1); }}
          aria-label={t('admin.users.filterRole', 'Rôle')}
          className="h-10 rounded-lg border border-white/10 bg-[#111] px-3 text-sm text-white focus:border-white/25 focus:outline-none"
        >
          <option value="">{t('admin.users.allRoles', 'Tous les rôles')}</option>
          <option value="staff">{t('admin.users.roleStaff', 'Équipe')}</option>
          <option value="member">{t('admin.users.roleMember', 'Abonnés')}</option>
        </select>

        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white/80 transition hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          {t('admin.users.refresh', 'Actualiser')}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statTiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <div key={tile.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-white/50">{tile.label}</span>
                <Icon className="h-4 w-4 text-white/50" aria-hidden="true" />
              </div>
              <div className="mt-2 text-2xl font-bold tabular-nums text-white">{tile.value}</div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
      )}

      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#111]">
        <div className="hidden grid-cols-[minmax(0,2fr)_auto_auto_auto] gap-3 border-b border-white/10 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-white/40 md:grid">
          <span>{t('admin.users.colUser', 'Utilisateur')}</span>
          <span>{t('admin.users.colLastSeen', 'Dernière activité')}</span>
          <span>{t('admin.users.colStatus', 'Abonnement')}</span>
          <span className="text-right">{t('admin.users.colRole', 'Rôle')}</span>
        </div>

        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('admin.users.loading', 'Chargement…')}
          </div>
        ) : data && data.users.length > 0 ? (
          data.users.map(renderRow)
        ) : (
          <div className="py-12 text-center text-sm text-white/50">
            {t('admin.users.empty', 'Aucun utilisateur ne correspond à ces filtres.')}
          </div>
        )}
      </div>

      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-sm text-white/50">
          <span>
            {t('admin.users.pageInfo', 'Page {{page}} sur {{pages}} · {{total}} comptes', {
              page: data.page,
              pages: totalPages,
              total: data.total,
            })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={page <= 1 || loading}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-white/10 px-3 text-white/70 transition hover:bg-white/5 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              {t('admin.users.previous', 'Précédent')}
            </button>
            <button
              type="button"
              onClick={() => setPage((value) => value + 1)}
              disabled={!data.hasMore || loading}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-white/10 px-3 text-white/70 transition hover:bg-white/5 disabled:opacity-40"
            >
              {t('admin.users.next', 'Suivant')}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      <ReusableModal
        isOpen={Boolean(selected)}
        onClose={closeDetail}
        title={t('admin.users.detailTitle', 'Fiche utilisateur')}
        className="max-w-3xl"
      >
        {selected && (
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              {selected.avatar ? (
                <img src={selected.avatar} alt="" className="h-14 w-14 rounded-full object-cover ring-1 ring-white/10" />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
                  <UserRound className="h-6 w-6 text-white/50" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold text-white">
                  {detail?.user.username || selected.username || t('admin.users.unnamed', 'Sans nom')}
                </p>
                <p className="truncate text-xs text-white/45">
                  {PROVIDER_LABEL[selected.provider] || selected.provider} · {selected.userId}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full bg-white/5 px-2 py-1 text-white/60 ring-1 ring-white/10">
                    {selected.userType === 'bip39' ? t('admin.users.providerBip39', 'Compte CINE') : 'OAuth'}
                  </span>
                  {detail?.user.role && (
                    <span className="rounded-full bg-white/10 px-2 py-1 text-white/80">{detail.user.role}</span>
                  )}
                  <span className="rounded-full bg-white/5 px-2 py-1 text-white/60 ring-1 ring-white/10">
                    {t('admin.users.sessionCount', '{{count}} session(s)', { count: detail?.user.sessionCount ?? selected.sessionCount })}
                  </span>
                </div>
              </div>
            </div>

            {detailLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-white/50">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {t('admin.users.loading', 'Chargement…')}
              </div>
            ) : (
              <>
                <section className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40">
                    {t('admin.users.accountSection', 'Abonnement et accès')}
                  </h3>

                  {detail?.user.account ? (
                    <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm text-white/70">
                            {t('admin.users.currentState', 'État')} :{' '}
                            <span className="text-white">
                              {t(`admin.users.state.${detail.user.subscriptionState || 'none'}`, detail.user.subscriptionState || 'none')}
                            </span>
                          </p>
                          <p className="text-xs text-white/45">
                            {t('admin.users.expiresOn', 'Expire le')} {formatDate(detail.user.account.subscriptionExpiresAt)}
                            {' · '}
                            {t('admin.users.lastLogin', 'Dernière connexion')} {formatDate(detail.user.account.lastLoginAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => patch(selected, { active: !detail.user.account?.active }, 'admin.users.activeSaved')}
                          className={`inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium transition disabled:opacity-50 ${
                            detail.user.account.active
                              ? 'bg-white text-black hover:bg-white/90'
                              : 'border border-white/20 text-white hover:bg-white/10'
                          }`}
                        >
                          {detail.user.account.active
                            ? t('admin.users.deactivate', 'Désactiver')
                            : t('admin.users.activate', 'Activer')}
                        </button>
                      </div>

                      <div className="flex flex-wrap items-end gap-3">
                        <label className="flex flex-col gap-1 text-xs text-white/50">
                          {t('admin.users.expiryDate', 'Date d’expiration')}
                          <input
                            type="date"
                            value={expiryDraft}
                            onChange={(event) => setExpiryDraft(event.target.value)}
                            className="h-9 rounded-lg border border-white/10 bg-[#111] px-3 text-sm text-white focus:border-white/25 focus:outline-none"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={saving || !expiryDraft}
                          onClick={() => patch(
                            selected,
                            { subscriptionExpiresAt: new Date(`${expiryDraft}T23:59:59`).toISOString() },
                            'admin.users.expirySaved',
                          )}
                          className="h-9 rounded-lg border border-white/15 px-3 text-sm text-white/80 transition hover:bg-white/10 disabled:opacity-40"
                        >
                          {t('admin.users.saveExpiry', 'Enregistrer la date')}
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => patch(selected, { subscriptionExpiresAt: null }, 'admin.users.expiryCleared')}
                          className="h-9 rounded-lg border border-white/15 px-3 text-sm text-white/60 transition hover:bg-white/10 disabled:opacity-40"
                        >
                          {t('admin.users.clearExpiry', 'Retirer le minuteur')}
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-white/45">{t('admin.users.quickAdd', 'Prolonger de')}</span>
                        {QUICK_ADD_DAYS.map((days) => (
                          <button
                            key={days}
                            type="button"
                            disabled={saving}
                            onClick={() => patch(selected, { addDays: days }, 'admin.users.extended')}
                            className="h-8 rounded-full border border-white/15 px-3 text-xs text-white/75 transition hover:bg-white/10 disabled:opacity-40"
                          >
                            {days} j
                          </button>
                        ))}
                      </div>

                      {detail.user.role !== 'admin' && (
                        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                          <span className="text-xs text-white/45">{t('admin.users.teamRole', 'Rôle équipe')}</span>
                          <button
                            type="button"
                            disabled={saving || detail.user.role === 'uploader'}
                            onClick={() => patch(selected, { role: 'uploader' }, 'admin.users.roleSaved')}
                            className="h-8 rounded-full border border-white/15 px-3 text-xs text-white/75 transition hover:bg-white/10 disabled:opacity-40"
                          >
                            {t('admin.users.makeUploader', 'Passer uploader')}
                          </button>
                          <button
                            type="button"
                            disabled={saving || !detail.user.role}
                            onClick={() => patch(selected, { role: null }, 'admin.users.roleRemoved')}
                            className="h-8 rounded-full border border-white/15 px-3 text-xs text-white/60 transition hover:bg-white/10 disabled:opacity-40"
                          >
                            {t('admin.users.removeRole', 'Retirer le rôle')}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/50">
                      {t(
                        'admin.users.noAccount',
                        'Ce compte n’a pas d’identifiant de connexion par code : il se connecte via son fournisseur.',
                      )}
                    </p>
                  )}
                </section>

                {detail?.user.account?.hasPassword !== false && detail?.user.account && (
                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40">
                      {t('admin.users.passwordSection', 'Mot de passe du staff')}
                    </h3>
                    <p className="text-xs text-white/45">
                      {t(
                        'admin.users.passwordHint',
                        'Utile quand un compte de gestion ne se souvient plus de son mot de passe. Minimum 8 caractères.',
                      )}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <label className="min-w-[220px] flex-1">
                        <span className="sr-only">{t('admin.users.newPassword', 'Nouveau mot de passe')}</span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={passwordDraft}
                          onChange={(event) => setPasswordDraft(event.target.value)}
                          placeholder={t('admin.users.newPassword', 'Nouveau mot de passe')}
                          className="h-9 w-full rounded-lg border border-white/10 bg-[#111] px-3 text-sm text-white placeholder:text-white/35 focus:border-white/25 focus:outline-none"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={saving || passwordDraft.length < 8}
                        onClick={() => submitPassword(selected)}
                        className="h-9 rounded-full bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-40"
                      >
                        {t('admin.users.setPassword', 'Définir')}
                      </button>
                    </div>
                  </section>
                )}

                <section className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40">
                    {t('admin.users.sessionsSection', 'Sessions récentes')}
                  </h3>
                  {detail && detail.sessions.length > 0 ? (
                    <ul className="space-y-2">
                      {detail.sessions.slice(0, 6).map((session) => (
                        <li key={session.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
                          <span className="block truncate text-white/75">{session.userAgent || '—'}</span>
                          <span className="block text-white/40">
                            {t('admin.users.sessionSeen', 'Vu le')} {formatDate(session.lastSeen)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-white/45">{t('admin.users.noSessions', 'Aucune session enregistrée.')}</p>
                  )}
                </section>
              </>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={closeDetail}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/15 px-4 text-sm text-white/70 transition hover:bg-white/10"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                {t('admin.users.close', 'Fermer')}
              </button>
            </div>
          </div>
        )}
      </ReusableModal>
    </div>
  );
};

export default AdminUsers;
