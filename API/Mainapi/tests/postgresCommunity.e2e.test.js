/**
 * Couche communauté servie par PostgreSQL : votes pour l'instant, les autres
 * domaines (commentaires, listes partagées) suivront le même modèle.
 *
 *   docker run -d --name cinehd-comm-pg -e POSTGRES_PASSWORD=pw -p 55438:5432 postgres:16-alpine
 *   JWT_SECRET=test-only \
 *   DATABASE_MIGRATION_URL='postgres://postgres:pw@127.0.0.1:55438/cinehd_comm' \
 *     node --test tests/postgresCommunity.e2e.test.js
 *
 * Ce qui n'est visible qu'ici : `COUNT(*)` revient en nombre et non en chaîne,
 * et un vote créé puis relu passe par `RETURNING` côté PostgreSQL. Aucun MySQL
 * n'est joignable (port fermé), donc un accès résiduel échouerait.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret';
process.env.DB_DRIVER = 'postgres';
process.env.NODE_ENV = 'test';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '6390';
if (process.env.DATABASE_MIGRATION_URL) process.env.DATABASE_URL = process.env.DATABASE_MIGRATION_URL;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const express = require('express');

const PG_URL = process.env.DATABASE_MIGRATION_URL;
const skip = PG_URL ? false : 'DATABASE_MIGRATION_URL requis (PostgreSQL jetable)';

const USER = 'community-user';
const SESSION = 'community-session';
const CONTENT_ID = '4001';
const PROFILE = 'profile-1';
const LIST = 'list-1';

// Les listes partagées lisent les listes personnalisées du profil sur le disque :
// ce dossier temporaire évite d'écrire dans le checkout.
const USER_DATA_DIR = fsSync.mkdtempSync(path.join(os.tmpdir(), 'cinehd-community-e2e-'));
process.env.USER_DATA_DIR = USER_DATA_DIR;

let server;
let token;
let pool;

function call(method, route, body, auth = true) {
  const payload = body ? JSON.stringify(body) : null;
  const headers = {};
  if (payload) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(payload);
  }
  if (auth && token) headers.authorization = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: '127.0.0.1', port: server.address().port, path: route, method, headers, agent: false },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => {
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = text;
          }
          resolve({ status: response.statusCode, body: parsed });
        });
      },
    );
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

before(async () => {
  if (!PG_URL) return;

  const migrate = () => execFileSync(
    process.execPath,
    [path.join(__dirname, '..', 'db', 'migratePostgres.js')],
    { env: { ...process.env, DATABASE_MIGRATION_URL: PG_URL }, stdio: 'pipe' },
  );
  for (let attempt = 0; ; attempt += 1) {
    try {
      migrate();
      break;
    } catch (error) {
      const detail = String(error.stderr || '');
      if (!/Connection terminated|ECONNREFUSED|the database system is starting up/i.test(detail) || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Données de profil minimales attendues par les listes partagées.
  await fs.mkdir(path.join(USER_DATA_DIR, 'users', 'profiles', 'bip39', USER), { recursive: true });
  await fs.writeFile(
    path.join(USER_DATA_DIR, 'users', `bip39-${USER}.json`),
    JSON.stringify({ profiles: [{ id: PROFILE, name: 'Profil test', avatar: '/avatars/disney/disney_avatar_1.png' }] }),
  );
  await fs.writeFile(
    path.join(USER_DATA_DIR, 'users', 'profiles', 'bip39', USER, `${PROFILE}.json`),
    JSON.stringify({
      custom_lists: JSON.stringify([{ id: LIST, name: 'Ma liste', items: [{ tmdbId: 4001, type: 'movie', title: 'Film' }] }]),
    }),
  );

  const app = express();
  app.use(express.json());
  app.use('/api/likes', require('../likesRoutes'));
  app.use('/api/comments', require('../commentsRoutes'));
  app.use('/api/help', require('../routes/helpFeedback'));
  app.use('/api/shared-lists', require('../sharedListsRoutes'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });

  pool = require('../db/dialect').getPool();
  await pool.execute('DELETE FROM likes WHERE content_id = ?', [CONTENT_ID]);
  await pool.execute('DELETE FROM user_sessions WHERE id = ?', [SESSION]);
  await pool.execute(
    'INSERT INTO user_sessions (id, user_id, user_type, created_at) VALUES (?, ?, ?, NOW())',
    [SESSION, USER, 'bip39'],
  );

  const { issueJwt } = require('../middleware/auth');
  token = issueJwt('bip39', USER, SESSION);
});

after(async () => {
  await new Promise((resolve) => {
    if (!server) return resolve();
    server.close(resolve);
    server.closeAllConnections?.();
  });
  await fs.rm(USER_DATA_DIR, { recursive: true, force: true }).catch(() => {});
  await require('../postgresPool').closePostgresPool().catch(() => {});
  require('../config/redis').redis.disconnect();
});

test('partager une liste écrit la référence en base et la relit', { skip }, async () => {
  const created = await call('POST', '/api/shared-lists/share', {
    profileId: PROFILE,
    listId: LIST,
    publishToCatalog: false,
  });

  // Sur PostgreSQL, cette route passait d'abord par un DDL MySQL
  // (`CREATE TABLE … ENGINE=InnoDB`) : le garde-fou est ce qui la rend possible.
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const shareCode = created.body.shareCode || created.body.shared?.shareCode;
  assert.ok(shareCode, `un code de partage est renvoyé : ${JSON.stringify(created.body)}`);

  const rows = await pool.execute(
    'SELECT share_code, list_id FROM shared_lists WHERE user_id = ? AND profile_id = ?',
    [USER, PROFILE],
  );
  assert.equal(rows[0].length, 1, 'la liste partagée existe en base');
  assert.equal(rows[0][0].share_code, shareCode);
  assert.equal(rows[0][0].list_id, LIST);

  const fetched = await call('GET', `/api/shared-lists/list/${shareCode}`, null, false);
  assert.equal(fetched.status, 200, JSON.stringify(fetched.body));
  assert.equal(fetched.body.listName, 'Ma liste');
  assert.equal(fetched.body.itemCount, 1);
  assert.equal(fetched.body.username, 'Profil test');
});

test('un contenu sans vote renvoie des compteurs numériques', { skip }, async () => {
  const response = await call('GET', `/api/likes/movie/${CONTENT_ID}`, null, false);

  assert.equal(response.status, 200, JSON.stringify(response.body));
  // `COUNT(*)` est un bigint : sans parseur il arriverait en "0" et le client
  // comparerait une chaîne à un nombre.
  assert.equal(typeof response.body.likes, 'number');
  assert.equal(typeof response.body.dislikes, 'number');
  assert.equal(response.body.likes, 0);
  assert.equal(response.body.dislikes, 0);
  assert.equal(response.body.userVote, null);
});

test('un vote est créé, relu, puis retiré par un second vote identique', { skip }, async () => {
  const created = await call('POST', '/api/likes', {
    contentType: 'movie', contentId: CONTENT_ID, voteType: 'like',
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.likes, 1);

  const stored = await pool.execute('SELECT vote_type, user_id FROM likes WHERE content_id = ?', [CONTENT_ID]);
  assert.equal(stored[0].length, 1, 'le vote existe réellement en base');
  assert.equal(stored[0][0].vote_type, 'like');

  const mine = await call('GET', `/api/likes/movie/${CONTENT_ID}`);
  assert.equal(mine.body.likes, 1);
  assert.equal(mine.body.userVote, 'like');

  // Même vote = bascule : l'utilisateur retire son vote.
  const toggled = await call('POST', '/api/likes', {
    contentType: 'movie', contentId: CONTENT_ID, voteType: 'like',
  });
  assert.equal(toggled.status, 200, JSON.stringify(toggled.body));
  assert.equal(toggled.body.likes, 0);

  const empty = await pool.execute('SELECT COUNT(*) AS total FROM likes WHERE content_id = ?', [CONTENT_ID]);
  assert.equal(Number(empty[0][0].total), 0);
});

test('un vote contraire remplace le précédent au lieu de s’ajouter', { skip }, async () => {
  await call('POST', '/api/likes', { contentType: 'movie', contentId: CONTENT_ID, voteType: 'like' });
  const swapped = await call('POST', '/api/likes', { contentType: 'movie', contentId: CONTENT_ID, voteType: 'dislike' });

  assert.equal(swapped.status, 200, JSON.stringify(swapped.body));
  assert.equal(swapped.body.likes, 0);
  assert.equal(swapped.body.dislikes, 1);

  const rows = await pool.execute('SELECT COUNT(*) AS total FROM likes WHERE content_id = ?', [CONTENT_ID]);
  assert.equal(Number(rows[0][0].total), 1, 'un seul vote par utilisateur et par contenu');
});

test('deux avis du même visiteur ne créent qu’une ligne d’aide', { skip }, async () => {
  // Slug de la liste blanche du routeur : ce n'est pas un identifiant libre.
  const slug = 'dns';
  await pool.execute('DELETE FROM help_feedback WHERE slug = ?', [slug]);
  const first = await call('POST', '/api/help/feedback', { slug, helpful: true }, false);
  assert.equal(first.status, 200, JSON.stringify(first.body));

  const second = await call('POST', '/api/help/feedback', { slug, helpful: false }, false);
  assert.equal(second.status, 200, JSON.stringify(second.body));

  // L'upsert doit mettre à jour et non ajouter : sur PostgreSQL cela dépend de
  // la contrainte (slug, ip_hash) que migrations/007 rétablit.
  const rows = await pool.execute('SELECT helpful FROM help_feedback WHERE slug = ?', [slug]);
  assert.equal(rows[0].length, 1, 'une seule ligne malgré deux envois');
  assert.equal(Number(rows[0][0].helpful), 0, 'le dernier avis remplace le précédent');
});

test('les préférences de notifications sont upsertées, pas dupliquées', { skip }, async () => {
  const off = await call('PUT', '/api/comments/notifications/preferences', { notificationsDisabled: true });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.notificationsDisabled, true);

  const on = await call('PUT', '/api/comments/notifications/preferences', { notificationsDisabled: false });
  assert.equal(on.status, 200, JSON.stringify(on.body));

  const rows = await pool.execute(
    'SELECT notifications_disabled FROM user_notification_preferences WHERE user_id = ? AND user_type = ?',
    [USER, 'bip39'],
  );
  assert.equal(rows[0].length, 1, 'la clé primaire (user_id, user_type) fait l’upsert');
  assert.equal(Number(rows[0][0].notifications_disabled), 0);
});

test('deux propositions du même auteur ne créent qu’une ligne de segment', { skip }, async () => {
  const store = require('../services/mediaSegments/communityStore');
  const author = { userType: 'bip39', userId: USER };
  const target = {
    mediaType: 'movie', tmdbId: 4001, season: -1, episode: -1,
    segmentType: 'intro', durationMs: 600000,
  };

  const first = await store.submitSegment({ ...target, startMs: 1000, endMs: 90000, author });
  const second = await store.submitSegment({ ...target, startMs: 2000, endMs: 88000, author });

  assert.equal(first.id, second.id, 'la proposition est mise à jour, pas dupliquée');

  const rows = await pool.execute(
    'SELECT id, start_ms FROM segment_submissions WHERE media_type = ? AND tmdb_id = ?',
    ['movie', 4001],
  );
  assert.equal(rows[0].length, 1, 'une seule ligne en base');
  assert.equal(Number(rows[0][0].start_ms), 2000, 'les bornes sont celles de la dernière proposition');
});

test('un votant n’a qu’une voix, et la changer met à jour la ligne', { skip }, async () => {
  const store = require('../services/mediaSegments/communityStore');
  const author = { userType: 'bip39', userId: USER };
  const voter = { userType: 'bip39', userId: 'voter-1' };

  const submission = await store.submitSegment({
    mediaType: 'movie', tmdbId: 4001, season: -1, episode: -1,
    segmentType: 'outro', durationMs: 600000, startMs: 500000, endMs: 590000, author,
  });

  // Deux votes hauts du même votant : la ligne est mise à jour, pas dupliquée.
  // (Un vote bas ensuite ferait passer le score sous le seuil de rejet, ce qui
  // supprime la proposition et ses votes : autre comportement, autre test.)
  await store.voteSegment({ submissionId: submission.id, value: 1, voter });
  await store.voteSegment({ submissionId: submission.id, value: 1, voter });

  const votes = await pool.execute(
    'SELECT value FROM segment_votes WHERE submission_id = ? AND voter_user_id = ?',
    [submission.id, 'voter-1'],
  );
  assert.equal(votes[0].length, 1, 'un seul vote par votant et par proposition');
  assert.equal(Number(votes[0][0].value), 1);

  // Vote 0 = retrait explicite : la ligne disparaît, la proposition reste.
  await store.voteSegment({ submissionId: submission.id, value: 0, voter });
  const cleared = await pool.execute(
    'SELECT 1 FROM segment_votes WHERE submission_id = ? AND voter_user_id = ?',
    [submission.id, 'voter-1'],
  );
  assert.equal(cleared[0].length, 0, 'le retrait supprime le vote');
  const stillThere = await pool.execute('SELECT 1 FROM segment_submissions WHERE id = ?', [submission.id]);
  assert.equal(stillThere[0].length, 1, 'la proposition survit au retrait du vote');
});

test('un type de contenu inconnu est refusé, et voter exige un jeton', { skip }, async () => {
  const unknown = await call('POST', '/api/likes', { contentType: 'podcast', contentId: CONTENT_ID, voteType: 'like' });
  assert.equal(unknown.status, 400);

  const anonymous = await call('POST', '/api/likes', { contentType: 'movie', contentId: CONTENT_ID, voteType: 'like' }, false);
  assert.equal(anonymous.status, 401);
});
