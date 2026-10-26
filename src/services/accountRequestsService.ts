import { MAIN_API } from '../config/runtime';
import type { ResolvedAuthResponse } from '../utils/accountAuth';
import { getSessionCreationHeaders } from '../utils/sessionClientId';

export type AccountPlanId = 'week' | 'month' | 'year';
export type AccountPaymentMethodId = 'mtn_momo' | 'orange_money';
export type AccountRequestStatus = 'pending' | 'approved' | 'rejected';

export interface AccountPlan {
  id: AccountPlanId;
  days: number;
  maxFcfa: number;
  floorFcfa: number;
  sliderMinFcfa: number;
}

export interface AccountPaymentMethod {
  id: AccountPaymentMethodId;
  label: string;
  number: string;
}

export interface AccountPlansPayload {
  currency: string;
  plans: AccountPlan[];
  methods: AccountPaymentMethod[];
  /** Paiement en ligne CamPay actif (sinon : collecte manuelle seule). */
  campay?: boolean;
}

export interface AccountRequestSummary {
  id: number;
  reference: string;
  planId: AccountPlanId;
  amountFcfa: number;
  paymentMethod: AccountPaymentMethodId;
  payerMsisdn: string;
  username: string;
  status: AccountRequestStatus;
  adminNote?: string | null;
  credentialId?: number | null;
  /** État de la collecte CamPay (PENDING | SUCCESSFUL | FAILED). */
  campayStatus?: string | null;
  paidAt?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CreateAccountRequestInput {
  planId: AccountPlanId;
  amountFcfa: number;
  paymentMethod: AccountPaymentMethodId;
  payerMsisdn: string;
  reference: string;
  username: string;
  turnstileToken?: string;
}

export interface AccountLoginResponse extends ResolvedAuthResponse {
  userId: string;
  userProfile?: { id?: string; username?: string; avatar?: string; provider?: string } | null;
  /** Minuteur d'abonnement (renvoyé par la connexion par mot de passe). */
  subscriptionExpiresAt?: string | null;
  message?: string;
}

export interface AccountRequestListPage {
  requests: AccountRequestSummary[];
  total: number;
  page: number;
  hasMore: boolean;
}

interface JsonResponse {
  success?: boolean;
  error?: string;
}

type ApiError = Error & { statusCode?: number };

function createApiError(message: string, statusCode?: number): ApiError {
  const error = new Error(message) as ApiError;
  if (statusCode !== undefined) error.statusCode = statusCode;
  return error;
}

function getAuthToken(): string | null {
  try {
    return localStorage.getItem('auth_token');
  } catch {
    return null;
  }
}

function mergeRequestHeaders(headers?: HeadersInit, includeAuth = false): Headers {
  const mergedHeaders = new Headers(headers);
  const token = includeAuth ? getAuthToken() : null;
  if (token && !mergedHeaders.has('Authorization')) {
    mergedHeaders.set('Authorization', `Bearer ${token}`);
  }
  return mergedHeaders;
}

async function requestJson<T>(path: string, init?: RequestInit, includeAuth = false): Promise<T> {
  const response = await fetch(`${MAIN_API}${path}`, {
    ...init,
    headers: mergeRequestHeaders(init?.headers, includeAuth),
  });

  const data = (await response.json().catch(() => ({}))) as JsonResponse & T;

  if (!response.ok) {
    throw createApiError((data as JsonResponse)?.error || 'Erreur réseau', response.status);
  }

  return data as T;
}

/**
 * Repli de développement uniquement.
 *
 * Sans Main API joignable (`VITE_MAIN_API` vide, et aucun proxy `/api` dans
 * `vite.config.ts`), `getAccountPlans()` échoue et l'onglet `create` se
 * rendait entièrement vide : sans offre, il n'y a ni carte, ni curseur, ni
 * moyen de paiement — juste un titre et une erreur. Ce repli reprend à
 * l'identique `PLANS` de `API/Mainapi/utils/accountPlans.js` pour que la
 * maquette soit jugeable sans backend.
 *
 * Garde-fous :
 * - `import.meta.env.DEV` est évalué à `false` en production, ce bloc est donc
 *   éliminé au tree-shaking et rien ne shipping en mock.
 * - Il se déclenche sur un échec réseau **et** sur une réponse vide : le SPA
 *   fallback de Vite répond `200 text/html` sur `/api/...` inconnu, donc
 *   `requestJson` ne lève rien (`.json()` rend `{}`, `response.ok` reste vrai)
 *   — sans ce second contrôle on retomberait sur le rendu vide d'origine.
 * - Les numéros de collecte restent des placeholders littéraux (`6XX XX XX XX`)
 *   et non des chiffres : on n'affiche jamais un numéro où envoyer de l'argent.
 */
const DEV_PLANS_FALLBACK: AccountPlansPayload = {
  currency: 'XAF',
  plans: [
    { id: 'week', days: 7, maxFcfa: 1500, floorFcfa: 1300, sliderMinFcfa: 650 },
    { id: 'month', days: 31, maxFcfa: 5500, floorFcfa: 3800, sliderMinFcfa: 1900 },
    { id: 'year', days: 365, maxFcfa: 16000, floorFcfa: 13800, sliderMinFcfa: 6900 },
  ],
  methods: [
    { id: 'mtn_momo', label: 'MTN MoMo', number: '6XX XX XX XX' },
    { id: 'orange_money', label: 'Orange Money', number: '6XX XX XX XX' },
  ],
};

const normalizePlansPayload = (data: Partial<AccountPlansPayload> | null | undefined): AccountPlansPayload => ({
  currency: data?.currency || 'XAF',
  plans: Array.isArray(data?.plans) ? data.plans : [],
  methods: Array.isArray(data?.methods) ? data.methods : [],
  campay: Boolean(data?.campay),
});

/** Offres + numéros de collecte réellement configurés côté serveur. */
export async function getAccountPlans(): Promise<AccountPlansPayload> {
  try {
    const payload = normalizePlansPayload(
      await requestJson<Partial<AccountPlansPayload>>('/api/account-requests/plans')
    );

    // 200 + HTML : aucune offre réelle n'a été servie.
    if (import.meta.env.DEV && payload.plans.length === 0) {
      console.warn('[accountRequests] Réponse vide sur /plans — repli de dév sur les offres figées.');
      return DEV_PLANS_FALLBACK;
    }

    return payload;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[accountRequests] Main API injoignable — repli de dév sur les offres figées.', error);
      return DEV_PLANS_FALLBACK;
    }
    throw error;
  }
}

export async function createAccountRequest(input: CreateAccountRequestInput): Promise<AccountRequestSummary> {
  const data = await requestJson<{ request: AccountRequestSummary }>('/api/account-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return data.request;
}

/** État d'une demande — le serveur ne renvoie jamais le code de connexion. */
export async function getAccountRequestStatus(input: {
  reference: string;
  payerMsisdn: string;
}): Promise<AccountRequestStatus> {
  const data = await requestJson<{ status: AccountRequestStatus }>('/api/account-requests/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return data.status;
}

// === Paiement en ligne (CamPay, collecte push USSD) ===

export interface CamPayCheckoutInput {
  planId: AccountPlanId;
  amountFcfa: number;
  paymentMethod: AccountPaymentMethodId;
  payerMsisdn: string;
  username: string;
  turnstileToken?: string;
}

export interface CamPayCheckoutSession {
  request: AccountRequestSummary;
  camPay: {
    /** Référence à passer à getCheckoutStatus. */
    reference: string;
    /** Code USSD indicatif affiché à l'écran (*126# MTN / #150*50# Orange). */
    ussdCode: string | null;
    operator: string | null;
  };
}

export interface CamPayCheckoutStatus {
  status: AccountRequestStatus | 'failed';
  operator: string | null;
  /** Fourni une seule fois, sur le passage à approved (affichez-le une fois). */
  code?: string | null;
  username?: string | null;
}

/** Démarre une collecte CamPay : invitation USSD sur le téléphone de l'acheteur. */
export async function checkoutWithCamPay(input: CamPayCheckoutInput): Promise<CamPayCheckoutSession> {
  return requestJson<CamPayCheckoutSession>('/api/account-requests/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** Suit une collecte CamPay (polling côté client, aucun webhook côté CamPay). */
export async function getCheckoutStatus(reference: string): Promise<CamPayCheckoutStatus> {
  const data = await requestJson<CamPayCheckoutStatus>('/api/account-requests/checkout/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference }),
  });
  return {
    status: data.status,
    operator: data.operator || null,
    code: data.code || null,
    username: data.username || null,
  };
}

/** Connexion par code : renvoie une session résolue classique (bip39). */
export async function loginWithAccountCode(input: {
  code: string;
  turnstileToken?: string;
}): Promise<AccountLoginResponse> {
  const data = await requestJson<AccountLoginResponse>('/api/auth/account/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Reprise de la session du même navigateur (voir routes/authRoutes.js).
      ...getSessionCreationHeaders(),
    },
    body: JSON.stringify({ code: input.code, turnstileToken: input.turnstileToken }),
  });
  return data;
}

// === Administration ===

export async function listAccountRequests(params: {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
} = {}): Promise<AccountRequestListPage> {
  const query = new URLSearchParams();
  if (params.status && params.status !== 'all') query.set('status', params.status);
  if (params.search) query.set('search', params.search);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));

  const suffix = query.toString() ? `?${query.toString()}` : '';
  return requestJson<AccountRequestListPage>(`/api/admin/account-requests${suffix}`, {}, true);
}

export async function adminApproveAccountRequest(
  id: number
): Promise<{ request: AccountRequestSummary; code: string; userId: string }> {
  const data = await requestJson<{ request: AccountRequestSummary; code: string; userId: string }>(
    `/api/admin/account-requests/${id}/approve`,
    { method: 'POST' },
    true
  );
  return data;
}

export async function adminRejectAccountRequest(
  id: number,
  note?: string
): Promise<{ request: AccountRequestSummary }> {
  return requestJson<{ request: AccountRequestSummary }>(
    `/api/admin/account-requests/${id}/reject`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: note || '' }),
    },
    true
  );
}

export async function adminRegenerateAccountCode(id: number): Promise<{ request: AccountRequestSummary; code: string }> {
  return requestJson<{ request: AccountRequestSummary; code: string }>(
    `/api/admin/account-requests/${id}/regenerate-code`,
    { method: 'POST' },
    true
  );
}

/**
 * Connexion par pseudo + mot de passe. Réservée aux comptes qui en possèdent
 * un (staff / admin — voir API/Mainapi/scripts/seedAdminAccounts.js) ; les
 * abonnés restent sur loginWithAccountCode.
 */
export async function loginWithAccountPassword(input: {
  username: string;
  password: string;
  turnstileToken?: string;
}): Promise<AccountLoginResponse> {
  return requestJson<AccountLoginResponse>('/api/auth/account/password-login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getSessionCreationHeaders(),
    },
    body: JSON.stringify({
      username: input.username,
      password: input.password,
      turnstileToken: input.turnstileToken,
    }),
  });
}

// === Abonnements (console d'abonnements) ===

export interface SubscriptionUser {
  id: number;
  userId: string;
  username: string;
  active: boolean;
  hasPassword: boolean;
  subscriptionExpiresAt: string | null;
  lastLoginAt: string | null;
  createdAt: string | null;
  requestId: number | null;
}

export interface SubscriptionReceipt {
  id: number;
  publicId: string;
  requestId: number | null;
  userId: string;
  username: string;
  planId: AccountPlanId;
  planDays: number;
  amountFcfa: number;
  paymentMethod: AccountPaymentMethodId;
  payerMsisdn: string;
  paymentReference: string;
  validFrom: string | null;
  validUntil: string | null;
  issuedBy: string;
  createdAt: string | null;
}

export interface SubscriptionBargain {
  id: number;
  title: string;
  description: string | null;
  planId: AccountPlanId;
  priceFcfa: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SubscriptionListPage<T> {
  items: T[];
  total: number;
  page: number;
  hasMore: boolean;
}

export interface BargainInput {
  title: string;
  description?: string | null;
  planId: AccountPlanId;
  priceFcfa: number;
  active?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}

/** Offres de renouvellement publiées (public — page de connexion / création). */
export async function getSubscriptionBargains(): Promise<SubscriptionBargain[]> {
  const data = await requestJson<{ bargains: SubscriptionBargain[] }>('/api/account/bargains');
  return Array.isArray(data.bargains) ? data.bargains : [];
}

export async function listSubscriptionUsers(params: {
  search?: string;
  page?: number;
  limit?: number;
} = {}): Promise<SubscriptionListPage<SubscriptionUser>> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';

  const data = await requestJson<{
    users: SubscriptionUser[];
    total: number;
    page: number;
    hasMore: boolean;
  }>(`/api/admin/subscriptions/users${suffix}`, {}, true);

  return { items: data.users, total: data.total, page: data.page, hasMore: data.hasMore };
}

/** Minuteur : soit une date absolue (null = réinitialise), soit un prolongement en jours. */
export async function adminUpdateSubscriptionUser(
  id: number,
  update: { expiresAt?: string | null; addDays?: number; active?: boolean }
): Promise<{ user: SubscriptionUser }> {
  return requestJson<{ user: SubscriptionUser }>(`/api/admin/subscriptions/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  }, true);
}

export async function listSubscriptionReceipts(params: {
  search?: string;
  page?: number;
  limit?: number;
} = {}): Promise<SubscriptionListPage<SubscriptionReceipt>> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';

  const data = await requestJson<{
    receipts: SubscriptionReceipt[];
    total: number;
    page: number;
    hasMore: boolean;
  }>(`/api/admin/subscriptions/receipts${suffix}`, {}, true);

  return { items: data.receipts, total: data.total, page: data.page, hasMore: data.hasMore };
}

/**
 * Valide une transaction mobile money et génère le reçu. Si la demande est
 * encore en attente, le compte est créé au passage : le code de connexion
 * (affiché une fois) est alors renvoyé dans `code`.
 */
export async function adminCreateTransactionReceipt(requestId: number): Promise<{
  receipt: SubscriptionReceipt;
  code?: string | null;
  userId?: string | null;
  request: AccountRequestSummary;
}> {
  return requestJson(`/api/admin/subscriptions/transactions/${requestId}/receipt`, { method: 'POST' }, true);
}

export async function listSubscriptionBargains(includeInactive = true): Promise<SubscriptionBargain[]> {
  const suffix = includeInactive ? '?includeInactive=1' : '';
  const data = await requestJson<{ bargains: SubscriptionBargain[] }>(
    `/api/admin/subscriptions/bargains${suffix}`,
    {},
    true
  );
  return Array.isArray(data.bargains) ? data.bargains : [];
}

export async function adminCreateSubscriptionBargain(input: BargainInput): Promise<{ bargain: SubscriptionBargain }> {
  return requestJson<{ bargain: SubscriptionBargain }>('/api/admin/subscriptions/bargains', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, true);
}

export async function adminUpdateSubscriptionBargain(
  id: number,
  input: Partial<BargainInput>
): Promise<{ bargain: SubscriptionBargain }> {
  return requestJson<{ bargain: SubscriptionBargain }>(`/api/admin/subscriptions/bargains/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, true);
}

export async function adminDeleteSubscriptionBargain(id: number): Promise<void> {
  await requestJson(`/api/admin/subscriptions/bargains/${id}`, { method: 'DELETE' }, true);
}
