/**
 * VIP par paiement mobile money confirmé manuellement (sans API opérateur).
 *
 * L'utilisateur connecté déclare sa transaction Orange Money / MTN MoMo ; un
 * admin la valide depuis le tableau de bord, ce qui génère une clé VIP
 * rattachée au compte. Les offres et numéros de collecte sont ceux des
 * demandes de compte (`getAccountPlans`).
 *
 * Endpoints : API/Mainapi/routes/vipPaymentRequests.js
 */
import { MAIN_API } from '../config/runtime';
import type {
  AccountPaymentMethodId,
  AccountPlanId,
  AccountRequestStatus,
} from './accountRequestsService';

export interface VipPaymentRequest {
  id: number;
  userId: string;
  userType: 'oauth' | 'bip39';
  username: string | null;
  planId: AccountPlanId;
  planDays: number;
  amountFcfa: number;
  paymentMethod: AccountPaymentMethodId;
  payerMsisdn: string;
  reference: string;
  status: AccountRequestStatus;
  adminNote: string | null;
  /** Clé VIP générée à la validation (visible par son titulaire et les admins). */
  accessKey: string | null;
  keyExpiresAt: string | null;
  /** La clé a été écrite dans les profils synchronisés du compte. */
  accountLinked: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CreateVipPaymentInput {
  planId: AccountPlanId;
  amountFcfa: number;
  paymentMethod: AccountPaymentMethodId;
  payerMsisdn: string;
  reference: string;
}

export interface VipPaymentListPage {
  requests: VipPaymentRequest[];
  total: number;
  page: number;
  hasMore: boolean;
}

type ApiError = Error & { statusCode?: number; code?: string };

function getAuthToken(): string | null {
  try {
    return localStorage.getItem('auth_token');
  } catch {
    return null;
  }
}

export function hasAuthSession(): boolean {
  return Boolean(getAuthToken());
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${MAIN_API}${path}`, { ...init, headers });
  const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string } & T;

  if (!response.ok) {
    const error = new Error(data?.error || 'Erreur réseau') as ApiError;
    error.statusCode = response.status;
    if (data?.code) error.code = data.code;
    throw error;
  }

  return data as T;
}

export async function submitVipPayment(input: CreateVipPaymentInput): Promise<VipPaymentRequest> {
  const data = await requestJson<{ request: VipPaymentRequest }>('/api/vip-payments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.request;
}

export async function listMyVipPayments(): Promise<VipPaymentRequest[]> {
  const data = await requestJson<{ requests: VipPaymentRequest[] }>('/api/vip-payments/mine');
  return Array.isArray(data.requests) ? data.requests : [];
}

export async function adminListVipPayments(params: {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<VipPaymentListPage> {
  const query = new URLSearchParams();
  if (params.status && params.status !== 'all') query.set('status', params.status);
  if (params.search) query.set('search', params.search);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return requestJson<VipPaymentListPage>(`/api/admin/vip-payments${suffix}`);
}

export async function adminConfirmVipPayment(
  id: number,
  note?: string,
): Promise<{ request: VipPaymentRequest; accessKey: string; accountLinked: boolean }> {
  return requestJson(`/api/admin/vip-payments/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ note: note || '' }),
  });
}

export async function adminRejectVipPayment(id: number, note: string): Promise<{ request: VipPaymentRequest }> {
  return requestJson(`/api/admin/vip-payments/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

/**
 * Active localement une clé validée par un admin : mêmes clés de stockage
 * que la saisie manuelle d'un code (AuthContext.checkAccessCode), puis
 * vérification serveur. Retourne true si l'appareil vient d'être débloqué.
 */
export function applyApprovedVipKey(request: VipPaymentRequest): boolean {
  if (request.status !== 'approved' || !request.accessKey) return false;
  try {
    if (localStorage.getItem('access_code') === request.accessKey) return false;
    localStorage.setItem('access_code', request.accessKey);
    localStorage.setItem('access_code_expires', request.keyExpiresAt || 'never');
    localStorage.setItem('is_vip', 'true');
  } catch {
    return false;
  }
  window.dispatchEvent(new Event('storage'));
  window.dispatchEvent(new CustomEvent('vipStatusChanged', { detail: { vip: true } }));
  return true;
}
