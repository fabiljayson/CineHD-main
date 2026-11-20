/**
 * Comportement des requêtes core/media converties, contre un PostgreSQL réel.
 *
 *   docker run -d --name cinehd-core-dst -e POSTGRES_PASSWORD=pw -p 55436:5432 postgres:16-alpine
 *   DATABASE_MIGRATION_URL='postgres://postgres:pw@127.0.0.1:55436/cinehd_core' \
 *     node --test tests/postgresCoreMedia.e2e.test.js
 *
 * Le test vérifie ce que la route observe — lignes trouvées, `affectedRows`,
 * ordre, sérialisation du verrou — et non la forme du SQL. C'est la seule chose
 * qui compte pour une bascule : le contrat visible ne doit pas changer.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const PG_URL = process.env.DATABASE_MIGRATION_URL;
const skip = PG_URL ? false : 'DATABASE_MIGRATION_URL requis (base PostgreSQL jetable)';

process.env.DB_DRIVER = 'postgres';
if (PG_URL) process.env.DATABASE_URL = PG_URL;

const { Client } = require('pg');

let pool;
let client;

async function withClient(fn) {
  const own = new Client({ connectionString: PG_URL });
  await own.connect();
  try {
    return await fn(own);
  } finally {
    await own.end();
  }
}

before(async () => {
  if (!PG_URL) return;

  // Schéma complet : les requêtes core supposent user_sessions, account_credentials, likes.
  execFileSync(process.execPath, [path.join(__dirname, '..', 'db', 'migratePostgres.js')], {
    env: { ...process.env, DATABASE_MIGRATION_URL: PG_URL },
    stdio: 'pipe',
  });

  client = new Client({ connectionString: PG_URL });
  await client.connect();
  await client.query('TRUNCATE user_sessions, account_credentials, likes');

  // Deux sessions du même utilisateur, dont une avec device.clientId.
  await client.query(
    `INSERT INTO user_sessions (id, user_id, user_type, device, user_agent, accessed_at)
     VALUES
       ('sess-1', 'u1', 'bip39', $1, 'agent-1', now() - interval '1 hour'),
       ('sess-2', 'u1', 'bip39', $2, 'agent-2', now())`,
    [JSON.stringify({ clientId: 'client-a', os: 'linux' }), JSON.stringify({ clientId: 'client-b' })],
  );
  // `device` non JSON : la requête ne doit pas exploser.
  await client.query(
    `INSERT INTO user_sessions (id, user_id, user_type, device, user_agent)
     VALUES ('sess-3', 'u1', 'bip39', 'not-json', 'agent-3')`,
  );
  await client.query(
    `INSERT INTO account_credentials (user_id, code_hash, username, active)
     VALUES ('u1', 'hash-1', 'utilisateur', 1)`,
  );
  // `likes.created_at` est un BIGINT d'époque, sans valeur par défaut : l'appel
  // applicatif le fournit toujours, donc le jeu de données aussi.
  const nowMs = Date.now();
  await client.query(
    `INSERT INTO likes (content_type, content_id, user_id, user_type, profile_id, vote_type, created_at)
     VALUES ('movie', '1', 'u1', 'bip39', 'p1', 'like', $1),
            ('movie', '2', 'u1', 'bip39', 'p2', 'like', $1)`,
    [nowMs],
  );

  // Le pool applicatif passe par la couche de dialecte, pas par `pg` directement.
  const dialect = require('../db/dialect');
  pool = dialect.getPool();
});

after(async () => {
  // Sans fermeture explicite, le pool garde la boucle d'événements vivante et
  // `node --test` attend indéfiniment une sortie qui n'arrivera pas.
  await client?.end().catch(() => {});
  await require('../postgresPool').closePostgresPool().catch(() => {});
});

test('le pool de dialecte expose le contrat de mysql2', { skip }, async () => {
  const [rows] = await pool.execute('SELECT 1 AS one');
  assert.equal(rows[0].one, 1);

  const [result] = await pool.execute('UPDATE user_sessions SET accessed_at = now() WHERE id = ?', ['sess-1']);
  assert.equal(result.affectedRows, 1, 'affectedRows est fourni comme par mysql2');
});

test('la session est retrouvée par clientId, y compris quand device n’est pas du JSON', { skip }, async () => {
  const dialect = require('../db/dialect');
  assert.equal(dialect.isPostgres(), true);

  const { findSessionByClientId } = require('../db/coreSql');
  const [rows] = await pool.execute(findSessionByClientId('postgres'), ['u1', 'bip39', 'client-a']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'sess-1');

  const [absent] = await pool.execute(findSessionByClientId('postgres'), ['u1', 'bip39', 'inconnu']);
  assert.equal(absent.length, 0, 'un client inconnu ne doit pas être rattaché à une session');

  // Aucune ligne `sess-3` ne doit être retournée ni provoquer d'erreur de cast.
  const [invalidJson] = await pool.execute(findSessionByClientId('postgres'), ['u1', 'bip39', '']);
  assert.equal(invalidJson.length, 0);
});

test('la liste des sessions respecte l’ordre de la route', { skip }, async () => {
  const [sessions] = await pool.execute(
    'SELECT id, device, user_agent as "userAgent", created_at as "createdAt", accessed_at as "accessedAt" FROM user_sessions WHERE user_id = ? AND user_type = ? ORDER BY accessed_at DESC',
    ['u1', 'bip39'],
  );
  assert.ok(sessions.length >= 2);
  assert.ok(
    new Date(sessions[0].accessedAt) >= new Date(sessions[sessions.length - 1].accessedAt),
    'les sessions les plus récentes viennent en premier',
  );
});

test('la suppression de session ne touche qu’à la session du bon utilisateur', { skip }, async () => {
  const [wrong] = await pool.execute('DELETE FROM user_sessions WHERE id = ? AND user_id = ? AND user_type = ?', [
    'sess-3',
    'autre',
    'bip39',
  ]);
  assert.equal(wrong.affectedRows, 0);

  const [right] = await pool.execute('DELETE FROM user_sessions WHERE id = ? AND user_id = ? AND user_type = ?', [
    'sess-3',
    'u1',
    'bip39',
  ]);
  assert.equal(right.affectedRows, 1);
});

test('la mise à jour d’activité respecte l’intervalle demandé', { skip }, async () => {
  const { touchSessionIfStale } = require('../db/coreSql');

  await withClient(async (own) => {
    await own.query("UPDATE user_sessions SET accessed_at = now() WHERE id = 'sess-2'");
  });

  // Trace récente : l'intervalle de 60 s interdit une seconde écriture.
  const [recent] = await pool.execute(touchSessionIfStale('postgres'), ['sess-2', 'u1', 'bip39', 60]);
  assert.equal(recent.affectedRows, 0, 'une activité récente ne doit pas être réécrite');

  // Forcer une trace ancienne rend la mise à jour de nouveau possible.
  await withClient(async (own) => {
    await own.query("UPDATE user_sessions SET accessed_at = now() - interval '10 minutes' WHERE id = 'sess-2'");
  });
  const [stale] = await pool.execute(touchSessionIfStale('postgres'), ['sess-2', 'u1', 'bip39', 60]);
  assert.equal(stale.affectedRows, 1, 'une trace ancienne doit être rafraîchie');
});

test('l’authentification par code puis la mise à jour de last_login_at fonctionnent', { skip }, async () => {
  const [credentials] = await pool.execute(
    'SELECT id, user_id, username, active FROM account_credentials WHERE code_hash = ? LIMIT 1',
    ['hash-1'],
  );
  assert.equal(credentials.length, 1);
  assert.equal(Number(credentials[0].active), 1, 'active reste comparable à 1 comme côté MySQL');

  const [updated] = await pool.execute('UPDATE account_credentials SET last_login_at = NOW() WHERE id = ?', [
    credentials[0].id,
  ]);
  assert.equal(updated.affectedRows, 1);
});

test('la suppression des votes est bornée au profil', { skip }, async () => {
  const [deleted] = await pool.execute('DELETE FROM likes WHERE user_id = ? AND user_type = ? AND profile_id = ?', [
    'u1',
    'bip39',
    'p1',
  ]);
  assert.equal(deleted.affectedRows, 1);

  const [remaining] = await pool.execute('SELECT profile_id FROM likes WHERE user_id = ?', ['u1']);
  assert.deepEqual(remaining.map((row) => row.profile_id), ['p2'], 'les autres profils sont épargnés');
});

test('le verrou de synchronisation sérialise deux opérations du même profil', { skip }, async () => {
  const { withAdvisoryLock } = require('../db/dialect');
  const order = [];

  const first = withAdvisoryLock('mainapi:sync:test', async () => {
    order.push('start-1');
    await new Promise((resolve) => setTimeout(resolve, 300));
    order.push('end-1');
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = withAdvisoryLock('mainapi:sync:test', async () => {
    order.push('start-2');
    order.push('end-2');
  });

  await Promise.all([first, second]);
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2'], 'la seconde opération attend la première');
});

test('une clé absente renvoie zéro ligne, pas une erreur', { skip }, async () => {
  const [rows] = await pool.execute(
    'SELECT id FROM account_credentials WHERE code_hash = ? LIMIT 1',
    ['inexistant'],
  );
  assert.deepEqual(rows, []);
});
