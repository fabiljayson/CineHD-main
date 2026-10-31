/**
 * Annuaire des utilisateurs (réservé aux admins).
 *
 * Différence avec `adminSubscriptions.js` : la console d'abonnements ne voit que
 * les lignes `account_credentials`, c'est-à-dire les comptes à code / mot de
 * passe. Ici on part du stockage réel (`data/users/*.json`), donc on voit
 * AUSSI les comptes OAuth (Discord / Google) qui n'ont jamais eu de credential.
 *
 * Ce que l'admin vient y faire :
 *   - retrouver un utilisateur (nom, id, fournisseur) ;
 *   - voir son état réel : rôle, abonnement, dernière activité, sessions ;
 *   - corriger ses préférences de compte : actif/inactif, échéance
 *     d'abonnement, rôle uploader, mot de passe du staff.
 *
 * Les actions commerciales (reçus, offres, transactions) restent dans la
 * console d'abonnements : un seul endroit par responsabilité.
 *
 * Mount point: app.use('/api', require('./routes/adminUsers'))
 *   GET    /api/admin/users                       annuaire + résumé
 *   GET    /api/admin/users/:userType/:userId     fiche détaillée
 *   PATCH  /api/admin/users/:userType/:userId     préférences de compte
 *   POST   /api/admin/users/:userType/:userId/password   mot de passe staff
 */

'use strict';

const express = require('express');
const fsp = require('fs').promises;
const path = require('path');

const { getPool } = require('../mysqlPool');
const { isAdmin } = require('../middleware/auth');
const { createAuthBodyParsers } = require('../middleware/bodyParsing');
const { jsonParseErrorHandler } = require('../middleware/security');
const { hashAccountPassword } = require('../utils/accountPasswords');
const { readUserData } = require('./sync');
const {
  addDays,
  parseSqlDateTime,
  toIsoOrNull,
  toSqlDateTime,
} = require('../utils/accountSubscriptions');

const router = express.Router();
const authBodyParsers = createAuthBodyParsers();

const USERS_DIR = path.join(__dirname, '..', 'data', 'users');
const SKIP_FILES = new Set(['cinepulse_accounts.json']);
const SCAN_CONCURRENCY = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PASSWORD_LENGTH = 128;
const MIN_PASSWORD_LENGTH = 8;
const MAX_ADD_DAYS = 3650;

const setNoStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  return next();
};

/** `'bip-39'` (legacy DB) et `'bip39'` désignent le même fournisseur. */
function normalizeUserType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'bip39' || raw === 'bip-39') return 'bip39';
  if (raw === 'oauth') return 'oauth';
  return null;
}

function dbAuthType(userType) {
  return userType === 'bip39' ? 'bip-39' : 'oauth';
}

function safeParseJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readProfileFromFile(data) {
  if (!data || typeof data !== 'object') return null;
  const auth = typeof data.auth === 'string' ? safeParseJson(data.auth) : data.auth;
  const profile = auth && typeof auth === 'object' ? auth.userProfile : null;
  return profile && typeof profile === 'object' ? profile : null;
}

function detectProvider(data, profile, userType) {
  const declared = (data && (data.oauth_provider || profile?.provider)) || null;
  if (declared) return String(declared);
  if (data?.bip39_auth || userType === 'bip39') return 'bip39';
  return 'unknown';
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function identityFromFileName(fileName) {
  if (fileName.startsWith('bip39-')) {
    return { userType: 'bip39', userId: fileName.slice('bip39-'.length, -'.json'.length) };
  }
  return { userType: 'oauth', userId: fileName.slice(0, -'.json'.length) };
}

async function readDirectoryEntry(fileName) {
  const fallback = identityFromFileName(fileName);
  try {
    const raw = await fsp.readFile(path.join(USERS_DIR, fileName), 'utf8');
    const data = JSON.parse(raw);
    const profile = readProfileFromFile(data);
    if (!profile && !data?.bip39_auth && !data?.oauth_provider) return null;
    const profiles = Array.isArray(data?.profiles) ? data.profiles.length : 0;
    return {
      userType: fallback.userType,
      userId: String(profile?.id || fallback.userId),
      username: profile?.username || null,
      avatar: profile?.avatar || null,
      provider: detectProvider(data, profile, fallback.userType),
      createdAt: typeof profile?.createdAt === 'string' ? profile.createdAt : null,
      lastUpdated: typeof data?.lastUpdated === 'number' ? data.lastUpdated : null,
      profileCount: profiles,
    };
  } catch {
    return null;
  }
}

/** Lit tout le stockage utilisateur. Coût : un fichier par compte. */
async function scanDirectory() {
  let entries;
  try {
    entries = await fsp.readdir(USERS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !SKIP_FILES.has(entry.name))
    .map((entry) => entry.name);

  const scanned = await mapLimit(files, SCAN_CONCURRENCY, readDirectoryEntry);
  return scanned.filter(Boolean);
}

async function loadAccounts(pool) {
  const [rows] = await pool.execute(
    `SELECT id, user_id, username, active, password_hash, subscription_expires_at, last_login_at, created_at
       FROM account_credentials`,
  );
  const byUserId = new Map();
  for (const row of rows) byUserId.set(String(row.user_id), row);
  return byUserId;
}

async function loadSessions(pool) {
  const [rows] = await pool.execute(
    `SELECT user_id, user_type, COUNT(*) AS session_count, MAX(accessed_at) AS last_seen
       FROM user_sessions
      GROUP BY user_id, user_type`,
  );
  const byKey = new Map();
  for (const row of rows) byKey.set(`${row.user_type}:${row.user_id}`, row);
  return byKey;
}

async function loadRoles(pool) {
  const [rows] = await pool.execute('SELECT user_id, role, auth_type FROM admins');
  const byUserId = new Map();
  for (const row of rows) byUserId.set(String(row.user_id), row);
  return byUserId;
}

function serializeAccount(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    active: Number(row.active) === 1,
    hasPassword: Boolean(row.password_hash),
    subscriptionExpiresAt: toIsoOrNull(row.subscription_expires_at),
    lastLoginAt: toIsoOrNull(row.last_login_at),
    createdAt: toIsoOrNull(row.created_at),
  };
}

function buildUserRecord(entry, accounts, sessions, roles) {
  const account = accounts.get(entry.userId) || null;
  const role = roles.get(entry.userId) || null;
  const session = sessions.get(`${entry.userType}:${entry.userId}`) || null;
  return {
    ...entry,
    role: role ? (role.role || 'admin') : null,
    account: serializeAccount(account),
    sessionCount: session ? Number(session.session_count) : 0,
    lastSeen: toIsoOrNull(session?.last_seen),
  };
}

function subscriptionState(user, now) {
  const account = user.account;
  if (!account) return 'none';
  if (!account.active) return 'disabled';
  if (!account.subscriptionExpiresAt) return 'no-timer';
  const expires = Date.parse(account.subscriptionExpiresAt);
  if (!Number.isFinite(expires)) return 'no-timer';
  return expires > now ? 'active' : 'expired';
}

function buildSummary(users, now) {
  const byProvider = {};
  const bySubscription = { active: 0, expired: 0, disabled: 0, 'no-timer': 0, none: 0 };
  let admins = 0;
  let withSessions = 0;
  for (const user of users) {
    byProvider[user.provider] = (byProvider[user.provider] || 0) + 1;
    bySubscription[subscriptionState(user, now)] += 1;
    if (user.role) admins += 1;
    if (user.sessionCount > 0) withSessions += 1;
  }
  return {
    total: users.length,
    byProvider,
    bySubscription,
    staff: admins,
    withSessions,
    withoutSessions: users.length - withSessions,
  };
}

function matchesFilters(user, { search, provider, status, role }, now) {
  if (provider && user.provider !== provider) return false;
  if (status && subscriptionState(user, now) !== status) return false;
  if (role === 'staff' && !user.role) return false;
  if (role === 'member' && user.role) return false;
  if (!search) return true;
  const needle = search.toLowerCase();
  return (
    String(user.userId).toLowerCase().includes(needle)
    || String(user.username || '').toLowerCase().includes(needle)
    || String(user.account?.username || '').toLowerCase().includes(needle)
  );
}

// === Annuaire ===

router.get('/admin/users', setNoStore, isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(req.query?.limit, 10) || DEFAULT_PAGE_SIZE));
    const filters = {
      search: String(req.query?.search || '').trim(),
      provider: String(req.query?.provider || '').trim(),
      status: String(req.query?.status || '').trim(),
      role: String(req.query?.role || '').trim(),
    };

    const [entries, accounts, sessions, roles] = await Promise.all([
      scanDirectory(),
      loadAccounts(pool),
      loadSessions(pool),
      loadRoles(pool),
    ]);

    const now = Date.now();
    const all = entries.map((entry) => buildUserRecord(entry, accounts, sessions, roles));
    const filtered = all.filter((user) => matchesFilters(user, filters, now));

    // Les plus récemment actifs d'abord ; les comptes sans activité en fin.
    filtered.sort((a, b) => {
      const aTime = Date.parse(a.lastSeen || a.account?.lastLoginAt || a.createdAt || 0) || 0;
      const bTime = Date.parse(b.lastSeen || b.account?.lastLoginAt || b.createdAt || 0) || 0;
      return bTime - aTime;
    });

    const offset = (page - 1) * limit;
    const pageItems = filtered.slice(offset, offset + limit);

    return res.json({
      success: true,
      users: pageItems.map((user) => ({ ...user, subscriptionState: subscriptionState(user, now) })),
      page,
      limit,
      total: filtered.length,
      hasMore: offset + pageItems.length < filtered.length,
      summary: buildSummary(all, now),
    });
  } catch (error) {
    console.error('Admin users list error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de lister les utilisateurs.' });
  }
});

// === Fiche utilisateur ===

async function resolveTarget(req) {
  const userType = normalizeUserType(req.params.userType);
  const userId = String(req.params.userId || '').trim();
  if (!userType || !userId || userId.length > 128) return null;
  return { userType, userId };
}

router.get('/admin/users/:userType/:userId', setNoStore, isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }
    const target = await resolveTarget(req);
    if (!target) {
      return res.status(400).json({ success: false, error: 'Identifiant utilisateur invalide.' });
    }

    const [userData, accountRows, sessionRows, roleRows] = await Promise.all([
      readUserData(target.userType, target.userId).catch(() => ({})),
      pool.execute(
        `SELECT id, user_id, username, active, password_hash, subscription_expires_at, last_login_at, created_at
           FROM account_credentials WHERE user_id = ? LIMIT 1`,
        [target.userId],
      ),
      pool.execute(
        `SELECT id, device, user_agent, created_at, accessed_at
           FROM user_sessions WHERE user_id = ? AND user_type = ?
          ORDER BY accessed_at DESC LIMIT 20`,
        [target.userId, target.userType],
      ),
      pool.execute('SELECT id, role, auth_type, created_at FROM admins WHERE user_id = ? LIMIT 1', [target.userId]),
    ]);

    const account = accountRows[0][0] || null;
    const role = roleRows[0][0] || null;
    const profile = readProfileFromFile(userData) || null;
    const profiles = Array.isArray(userData?.profiles) ? userData.profiles : [];

    const sessions = sessionRows[0].map((row) => ({
      id: row.id,
      userAgent: row.user_agent,
      device: safeParseJson(row.device),
      createdAt: toIsoOrNull(row.created_at),
      lastSeen: toIsoOrNull(row.accessed_at),
    }));

    const user = {
      userType: target.userType,
      userId: target.userId,
      username: profile?.username || account?.username || null,
      avatar: profile?.avatar || null,
      provider: detectProvider(userData, profile, target.userType),
      createdAt: typeof profile?.createdAt === 'string' ? profile.createdAt : null,
      lastUpdated: typeof userData?.lastUpdated === 'number' ? userData.lastUpdated : null,
      profileCount: profiles.length,
      role: role ? (role.role || 'admin') : null,
      account: serializeAccount(account),
      sessionCount: sessions.length,
      lastSeen: sessions[0]?.lastSeen || null,
    };

    return res.json({
      success: true,
      user: { ...user, subscriptionState: subscriptionState(user, Date.now()) },
      profiles: profiles.map((item) => ({
        id: item?.id || null,
        name: item?.name || null,
        avatar: item?.avatar || null,
        isDefault: Boolean(item?.isDefault),
      })),
      sessions,
      staff: role
        ? { id: Number(role.id), role: role.role || 'admin', authType: role.auth_type, createdAt: toIsoOrNull(role.created_at) }
        : null,
    });
  } catch (error) {
    console.error('Admin user detail error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de charger cet utilisateur.' });
  }
});

// === Préférences de compte ===

router.patch(
  '/admin/users/:userType/:userId',
  setNoStore,
  isAdmin,
  ...authBodyParsers,
  async (req, res) => {
    try {
      const pool = getPool();
      if (!pool) {
        return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
      }
      const target = await resolveTarget(req);
      if (!target) {
        return res.status(400).json({ success: false, error: 'Identifiant utilisateur invalide.' });
      }

      const body = req.body || {};
      const isSelf = target.userId === String(req.admin.userId);

      const hasActive = Object.prototype.hasOwnProperty.call(body, 'active');
      const hasExpiry = Object.prototype.hasOwnProperty.call(body, 'subscriptionExpiresAt');
      const hasAddDays = Object.prototype.hasOwnProperty.call(body, 'addDays');
      const hasRole = Object.prototype.hasOwnProperty.call(body, 'role');

      if (!hasActive && !hasExpiry && !hasAddDays && !hasRole) {
        return res.status(400).json({ success: false, error: 'Aucune modification fournie.' });
      }

      const [credentialRows] = await pool.execute(
        'SELECT id, active, subscription_expires_at FROM account_credentials WHERE user_id = ? LIMIT 1',
        [target.userId],
      );
      const credential = credentialRows[0] || null;

      if ((hasActive || hasExpiry || hasAddDays) && !credential) {
        return res.status(409).json({
          success: false,
          error: 'Ce compte n’a pas d’abonnement à code : gérez-le depuis la console d’abonnements.',
        });
      }

      if (hasActive && typeof body.active !== 'boolean') {
        return res.status(400).json({ success: false, error: 'Valeur « active » invalide.' });
      }
      if (hasActive && isSelf && body.active === false) {
        return res.status(400).json({ success: false, error: 'Vous ne pouvez pas désactiver votre propre compte.' });
      }

      const updates = [];
      const params = [];

      if (hasActive) {
        updates.push('active = ?');
        params.push(body.active ? 1 : 0);
      }

      if (hasExpiry) {
        if (body.subscriptionExpiresAt === null) {
          updates.push('subscription_expires_at = NULL');
        } else {
          const parsed = parseSqlDateTime(body.subscriptionExpiresAt);
          if (!parsed) {
            return res.status(400).json({ success: false, error: 'Date d’expiration invalide.' });
          }
          updates.push('subscription_expires_at = ?');
          params.push(toSqlDateTime(parsed));
        }
      } else if (hasAddDays) {
        const days = Number(body.addDays);
        if (!Number.isInteger(days) || days < 0 || days > MAX_ADD_DAYS) {
          return res.status(400).json({ success: false, error: 'Nombre de jours invalide.' });
        }
        const current = parseSqlDateTime(credential?.subscription_expires_at);
        const base = current && current.getTime() > Date.now() ? current : new Date();
        updates.push('subscription_expires_at = ?');
        params.push(toSqlDateTime(addDays(base, days)));
      }

      if (updates.length > 0) {
        params.push(credential.id);
        await pool.execute(`UPDATE account_credentials SET ${updates.join(', ')} WHERE id = ?`, params);
      }

      if (hasRole) {
        const role = body.role === null ? null : String(body.role);
        if (role !== null && role !== 'uploader') {
          return res.status(400).json({
            success: false,
            error: 'Seul le rôle « uploader » peut être accordé ici (les admins se gèrent dans Équipe).',
          });
        }
        if (isSelf) {
          return res.status(400).json({ success: false, error: 'Vous ne pouvez pas modifier votre propre rôle.' });
        }

        const [existingRole] = await pool.execute('SELECT id, role FROM admins WHERE user_id = ? LIMIT 1', [target.userId]);
        const currentRole = existingRole[0]?.role || null;
        if (currentRole === 'admin') {
          return res.status(403).json({ success: false, error: 'Un admin ne peut pas être rétrogradé ici.' });
        }

        if (role === 'uploader') {
          if (existingRole.length > 0) {
            await pool.execute("UPDATE admins SET role = 'uploader' WHERE id = ?", [existingRole[0].id]);
          } else {
            await pool.execute(
              "INSERT INTO admins (user_id, auth_type, role) VALUES (?, ?, 'uploader')",
              [target.userId, dbAuthType(target.userType)],
            );
          }
        } else if (existingRole.length > 0) {
          await pool.execute('DELETE FROM admins WHERE id = ?', [existingRole[0].id]);
        }
      }

      const [updatedRows] = await pool.execute(
        `SELECT id, user_id, username, active, password_hash, subscription_expires_at, last_login_at, created_at
           FROM account_credentials WHERE user_id = ? LIMIT 1`,
        [target.userId],
      );
      const [updatedRole] = await pool.execute('SELECT role FROM admins WHERE user_id = ? LIMIT 1', [target.userId]);

      return res.json({
        success: true,
        user: {
          userType: target.userType,
          userId: target.userId,
          account: serializeAccount(updatedRows[0] || null),
          role: updatedRole[0]?.role || null,
        },
      });
    } catch (error) {
      console.error('Admin user update error:', error);
      return res.status(500).json({ success: false, error: 'Impossible de mettre à jour cet utilisateur.' });
    }
  },
);

// === Mot de passe du staff ===

router.post(
  '/admin/users/:userType/:userId/password',
  setNoStore,
  isAdmin,
  ...authBodyParsers,
  async (req, res) => {
    try {
      const pool = getPool();
      if (!pool) {
        return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
      }
      const target = await resolveTarget(req);
      if (!target) {
        return res.status(400).json({ success: false, error: 'Identifiant utilisateur invalide.' });
      }

      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
        return res.status(400).json({
          success: false,
          error: `Le mot de passe doit contenir entre ${MIN_PASSWORD_LENGTH} et ${MAX_PASSWORD_LENGTH} caractères.`,
        });
      }

      const [rows] = await pool.execute(
        'SELECT id FROM account_credentials WHERE user_id = ? LIMIT 1',
        [target.userId],
      );
      if (rows.length === 0) {
        return res.status(409).json({
          success: false,
          error: 'Ce compte n’a pas d’identifiant de connexion : créez-le d’abord dans la console d’abonnements.',
        });
      }

      const passwordHash = await hashAccountPassword(password);
      await pool.execute('UPDATE account_credentials SET password_hash = ? WHERE id = ?', [passwordHash, rows[0].id]);

      console.log(
        `[ADMIN] Mot de passe réinitialisé par ${req.admin.userId} pour ${target.userType}:${target.userId}`,
      );

      return res.json({ success: true });
    } catch (error) {
      console.error('Admin password reset error:', error);
      return res.status(500).json({ success: false, error: 'Impossible de définir le mot de passe.' });
    }
  },
);

router.use(jsonParseErrorHandler);

module.exports = router;
