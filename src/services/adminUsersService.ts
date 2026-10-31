import axios from 'axios';
import { MAIN_API } from '../config/runtime';

export type UserSubscriptionState = 'active' | 'expired' | 'disabled' | 'no-timer' | 'none';

export interface AdminUserAccount {
  id: number;
  username: string | null;
  active: boolean;
  hasPassword: boolean;
  subscriptionExpiresAt: string | null;
  lastLoginAt: string | null;
  createdAt: string | null;
}

export interface AdminUser {
  userType: 'bip39' | 'oauth';
  userId: string;
  username: string | null;
  avatar: string | null;
  provider: string;
  createdAt: string | null;
  lastUpdated: number | null;
  profileCount: number;
  role: string | null;
  account: AdminUserAccount | null;
  sessionCount: number;
  lastSeen: string | null;
  subscriptionState?: UserSubscriptionState;
}

export interface AdminUsersSummary {
  total: number;
  byProvider: Record<string, number>;
  bySubscription: Record<string, number>;
  staff: number;
  withSessions: number;
  withoutSessions: number;
}

export interface AdminUsersResponse {
  success: boolean;
  users: AdminUser[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  summary: AdminUsersSummary;
}

export interface AdminUserSession {
  id: string;
  userAgent: string | null;
  device: Record<string, unknown> | null;
  createdAt: string | null;
  lastSeen: string | null;
}

export interface AdminUserDetailResponse {
  success: boolean;
  user: AdminUser;
  profiles: Array<{ id: string | null; name: string | null; avatar: string | null; isDefault: boolean }>;
  sessions: AdminUserSession[];
  staff: { id: number; role: string; authType: string; createdAt: string | null } | null;
}

export interface AdminUsersQuery {
  search?: string;
  provider?: string;
  status?: string;
  role?: string;
  page?: number;
  limit?: number;
}

export interface AdminUserPreferencesPatch {
  active?: boolean;
  subscriptionExpiresAt?: string | null;
  addDays?: number;
  role?: 'uploader' | null;
}

const authHeaders = () => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : undefined;
};

const client = axios.create({ baseURL: MAIN_API, timeout: 20000 });

export async function fetchAdminUsers(query: AdminUsersQuery): Promise<AdminUsersResponse> {
  const res = await client.get<AdminUsersResponse>('/api/admin/users', {
    params: query,
    headers: authHeaders(),
  });
  return res.data;
}

export async function fetchAdminUser(userType: string, userId: string): Promise<AdminUserDetailResponse> {
  const res = await client.get<AdminUserDetailResponse>(
    `/api/admin/users/${encodeURIComponent(userType)}/${encodeURIComponent(userId)}`,
    { headers: authHeaders() },
  );
  return res.data;
}

export async function updateAdminUserPreferences(
  userType: string,
  userId: string,
  patch: AdminUserPreferencesPatch,
): Promise<{ success: boolean; user: AdminUser }> {
  const res = await client.patch<{ success: boolean; user: AdminUser }>(
    `/api/admin/users/${encodeURIComponent(userType)}/${encodeURIComponent(userId)}`,
    patch,
    { headers: authHeaders() },
  );
  return res.data;
}

export async function setAdminUserPassword(
  userType: string,
  userId: string,
  password: string,
): Promise<{ success: boolean }> {
  const res = await client.post<{ success: boolean }>(
    `/api/admin/users/${encodeURIComponent(userType)}/${encodeURIComponent(userId)}/password`,
    { password },
    { headers: authHeaders() },
  );
  return res.data;
}
