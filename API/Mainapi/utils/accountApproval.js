/**
 * Validation d'une demande de compte payée (mobile money).
 *
 * Extrait de `routes/accountRequests.js` pour être partagé entre la route
 * historique `POST /admin/account-requests/:id/approve` et la nouvelle route
 * `POST /admin/subscriptions/transactions/:id/receipt` (validation + reçu).
 *
 * Crée le compte + son credential dans une transaction, sous verrou de ligne :
 * deux admins ne peuvent pas valider la même demande simultanément.
 * Retourne le code en clair — uniquement affiché à l'admin, une seule fois.
 */

const { getPool } = require('../mysqlPool');
const {
  generateAccountCode,
  generateAccountUserId,
  hashAccountCode,
  normalizeAccountCode,
} = require('../utils/accountCredentials');

const DEFAULT_AVATAR = 'https://as2.ftcdn.net/v2/jpg/05/89/93/27/1000_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.webp';

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} requestId
 * @param {{ adminId?: string, userId?: string }} admin
 * @returns {Promise<{ request: object, code: string, userId: string }>}
 */
async function approveAccountRequest(pool, requestId, admin) {
  const conn = await pool.getConnection();
  let request = null;
  let code = null;
  let userId = null;

  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT * FROM account_requests WHERE id = ? FOR UPDATE', [requestId]);
    request = rows[0];
    if (!request) {
      throw Object.assign(new Error('Demande introuvable.'), { status: 404 });
    }
    if (request.status === 'approved') {
      throw Object.assign(new Error('Cette demande est déjà validée.'), { status: 409 });
    }
    if (request.status !== 'pending') {
      throw Object.assign(new Error('Cette demande a été refusée.'), { status: 409 });
    }

    code = generateAccountCode();
    const codeHash = hashAccountCode(normalizeAccountCode(code));
    userId = generateAccountUserId();

    const [credentialResult] = await conn.execute(
      'INSERT INTO account_credentials (user_id, code_hash, username, request_id, active) VALUES (?, ?, ?, ?, 1)',
      [userId, codeHash, request.username, request.id]
    );

    await conn.execute(
      `UPDATE account_requests
         SET status = 'approved', credential_id = ?, reviewed_at = NOW(), reviewed_by = ?
       WHERE id = ? AND status = 'pending'`,
      [credentialResult.insertId, String(admin?.adminId || admin?.userId || ''), request.id]
    );

    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch { /* rollback best effort */ }
    throw error;
  } finally {
    conn.release();
  }

  // Hors transaction : la fiche utilisateur vit dans le module sync (fichiers).
  // En échec, la connexion retombe sur le pseudo stocké dans le credential.
  try {
    const syncModule = require('../routes/sync');
    const now = new Date();
    const profile = {
      id: userId,
      username: request.username,
      avatar: DEFAULT_AVATAR,
      provider: 'bip39',
      createdAt: now.toISOString(),
    };
    const userData = await syncModule.readUserData('bip39', userId) || {};
    userData.auth = JSON.stringify({ userProfile: profile, provider: 'bip39' });
    userData.bip39_auth = 'true';
    userData.lastUpdated = Date.now();
    await syncModule.writeUserData('bip39', userId, userData);
  } catch (error) {
    console.error('Account credential profile write failed:', error?.message || error);
  }

  return { request, code, userId };
}

module.exports = { approveAccountRequest, DEFAULT_AVATAR, getPool };
