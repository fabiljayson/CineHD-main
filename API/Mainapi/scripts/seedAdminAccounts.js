#!/usr/bin/env node
/**
 * Seed des comptes admin CineHD.
 *
 * Crée (ou répare) les deux comptes de gestion avec un mot de passe : ce sont
 * les seuls comptes qui possèdent `account_credentials.password_hash`, les
 * abonnés restant sur la connexion par code CINE-XXXXX-XXXXX-XXXXX.
 *
 * Les mots de passe ne sont JAMAIS écrits dans le dépôt : ils passent par
 * l'environnement, et le script refuse de démarrer sans eux.
 *
 *   ADMIN_FRED_PASSWORD='...'  ADMIN_FABL_PASSWORD='...' \
 *     node scripts/seedAdminAccounts.js
 *
 * Options (toutes facultatives) :
 *   ADMIN_FRED_USERNAME   défaut « fred bitek »
 *   ADMIN_FABL_USERNAME   défaut « fabil jayson »
 *   ADMIN_SUBSCRIPTION_DAYS  durée posée sur les comptes admin (défaut 3650)
 *
 * Idempotent : relancer le script met à jour les mots de passe et garantit la
 * ligne `admins`, sans dupliquer les comptes.
 */

const { initPool } = require('../mysqlPool');
const {
  generateAccountCode,
  generateAccountUserId,
  hashAccountCode,
  normalizeAccountCode,
} = require('../utils/accountCredentials');
const { hashAccountPassword } = require('../utils/accountPasswords');
const { addDays, toSqlDateTime } = require('../utils/accountSubscriptions');

const DEFAULT_AVATAR = 'https://as2.ftcdn.net/v2/jpg/05/89/93/27/1000_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.webp';
const ADMIN_AUTH_TYPE = 'bip-39';

function readAdminDefinitions() {
  return [
    {
      key: 'fred',
      username: (process.env.ADMIN_FRED_USERNAME || 'fred bitek').trim(),
      password: process.env.ADMIN_FRED_PASSWORD,
    },
    {
      key: 'fabil',
      username: (process.env.ADMIN_FABL_USERNAME || 'fabil jayson').trim(),
      password: process.env.ADMIN_FABL_PASSWORD,
    },
  ];
}

async function ensureSchema(pool) {
  const ensureColumn = async (tableName, columnName, definitionSql) => {
    const [rows] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [tableName, columnName],
    );
    if (rows.length === 0) {
      await pool.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definitionSql}`);
    }
  };

  await ensureColumn('account_credentials', 'password_hash', 'password_hash VARCHAR(128) DEFAULT NULL');
  await ensureColumn('account_credentials', 'subscription_expires_at', 'subscription_expires_at DATETIME DEFAULT NULL');

  const { getTablesByGroup, renderCreateTable } = require('../db/schema');
  const wanted = new Set(['subscription_receipts', 'subscription_bargains']);
  for (const table of getTablesByGroup('core')) {
    if (wanted.has(table.name)) {
      await pool.execute(renderCreateTable(table));
    }
  }
}

/** Écrit la fiche profil bip39, comme le fait la validation d'une demande. */
async function writeProfileFile(userId, username) {
  try {
    const syncModule = require('../routes/sync');
    const now = new Date();
    const profile = {
      id: userId,
      username,
      avatar: DEFAULT_AVATAR,
      provider: 'bip39',
      createdAt: now.toISOString(),
    };
    const userData = (await syncModule.readUserData('bip39', userId)) || {};
    userData.auth = JSON.stringify({ userProfile: profile, provider: 'bip39' });
    userData.bip39_auth = 'true';
    userData.lastUpdated = Date.now();
    await syncModule.writeUserData('bip39', userId, userData);
    return true;
  } catch (error) {
    console.warn(`  ! profil (${userId}) non écrit : ${error?.message || error}`);
    console.warn('    La connexion reste possible : le pseudo est lu depuis le credential.');
    return false;
  }
}

async function seedAdmin(pool, definition, subscriptionDays) {
  const { username, password } = definition;
  if (!username) throw new Error(`Pseudo manquant pour ${definition.key}.`);
  if (!password) {
    throw new Error(
      `Mot de passe manquant pour ${definition.key} : définissez ` +
      `${definition.key === 'fred' ? 'ADMIN_FRED_PASSWORD' : 'ADMIN_FABL_PASSWORD'} dans l'environnement.`,
    );
  }

  const passwordHash = await hashAccountPassword(password);

  const [existing] = await pool.execute(
    'SELECT id, user_id, username, active FROM account_credentials WHERE username = ? LIMIT 1',
    [username],
  );

  let userId;
  let credentialId;
  let created = false;

  if (existing[0]) {
    credentialId = Number(existing[0].id);
    userId = String(existing[0].user_id);
    await pool.execute(
      'UPDATE account_credentials SET password_hash = ?, active = 1 WHERE id = ?',
      [passwordHash, credentialId],
    );
  } else {
    created = true;
    userId = generateAccountUserId();
    // Un code aléatoire est requis par la contrainte NOT NULL de code_hash.
    // Il n'est jamais affiché : ces comptes se connectent par mot de passe.
    const codeHash = hashAccountCode(normalizeAccountCode(generateAccountCode()));
    const [result] = await pool.execute(
      'INSERT INTO account_credentials (user_id, code_hash, username, active, password_hash) VALUES (?, ?, ?, 1, ?)',
      [userId, codeHash, username, passwordHash],
    );
    credentialId = Number(result.insertId);
  }

  const expiresAt = toSqlDateTime(addDays(new Date(), subscriptionDays));
  await pool.execute(
    'UPDATE account_credentials SET subscription_expires_at = ? WHERE id = ?',
    [expiresAt, credentialId],
  );

  await pool.execute(
    `INSERT INTO admins (user_id, auth_type, role) VALUES (?, ?, 'admin')
       ON DUPLICATE KEY UPDATE role = 'admin', auth_type = VALUES(auth_type)`,
    [userId, ADMIN_AUTH_TYPE],
  );

  await writeProfileFile(userId, username);

  return { username, userId, credentialId, created, expiresAt };
}

async function main() {
  const definitions = readAdminDefinitions();
  const subscriptionDays = Number.parseInt(process.env.ADMIN_SUBSCRIPTION_DAYS || '', 10) || 3650;

  const pool = await initPool();
  await ensureSchema(pool);

  console.log('Seed des comptes admin — mots de passe lus dans l\'environnement.\n');

  for (const definition of definitions) {
    const result = await seedAdmin(pool, definition, subscriptionDays);
    console.log(
      `${result.created ? 'Créé' : 'Mis à jour'} : ${result.username}` +
      `\n  user_id=${result.userId} credential_id=${result.credentialId}` +
      `\n  abonnement jusqu'à ${result.expiresAt}`,
    );
  }

  console.log('\nTerminé. Aucun secret n\'a été affiché ni écrit dans le dépôt.');
  process.exit(0);
}

main().catch((error) => {
  console.error(`\nÉchec du seed : ${error?.message || error}`);
  process.exit(1);
});
