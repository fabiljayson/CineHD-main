#!/usr/bin/env node
/**
 * Harnais différentiel : la même requête sur les deux moteurs, puis diff des
 * corps de réponse.
 *
 *   MYSQL_MIGRATION_URL='mysql://root:root@127.0.0.1:3306/cinehd' \
 *   DATABASE_MIGRATION_URL='postgres://postgres:pw@127.0.0.1:5432/cinehd' \
 *   REDIS_HOST=127.0.0.1 REDIS_PORT=6379 \
 *     node scripts/differentialApi.js --report /tmp/diff.json
 *
 * Pourquoi : le vérificateur de données prouve que les lignes arrivent
 * intactes, pas que les routes rendent la même chose. Les défauts trouvés
 * jusqu'ici (alias en minuscules, `accountLinks` encore sur MySQL, trigger
 * d'activité qui écrase) ne changent pas une ligne en base — ils changent la
 * forme du JSON. Ce diff les attrape mécaniquement.
 *
 * Les deux bases doivent contenir les mêmes données : lancer le transfert
 * (`npm run db:postgres:transfer`) avant, ou comparer sur des identifiants
 * absents pour vérifier les formes de refus.
 *
 * Sortie 0 si tout est identique, 1 sinon, 2 en cas d'erreur d'exécution.
 */

const { fork } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'tests', 'fixtures', 'differentialServer.js');
const READY_TIMEOUT_MS = 20000;

function parseArgs(argv) {
  const options = { report: null, requests: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--report') {
      options.report = argv[index + 1];
      index += 1;
    } else if (arg === '--requests') {
      options.requests = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

/** Requêtes par défaut : chemins stables, identifiants paramétrables. */
function defaultRequests(env = process.env) {
  const film = env.DIFF_FILM_ID || '999999999';
  const series = env.DIFF_SERIES_ID || '888888888';
  return [
    { label: 'film existant ou absent', path: `/api/admin/links/movie/${film}` },
    { label: 'serie complete', path: `/api/admin/links/tv/${series}` },
    { label: 'episode precis', path: `/api/admin/links/tv/${series}?season=1&episode=1` },
    { label: 'type invalide', path: '/api/admin/links/book/1' },
    { label: 'compteurs de votes', path: `/api/likes/movie/${film}` },
    { label: 'offres publiques', path: '/api/account-requests/plans' },
  ];
}

/**
 * Décompose `mysql://user:pass@host:port/base` en variables DB_*.
 *
 * `new URL()` ne convient pas : pour un schéma non spécial comme `mysql:`, il
 * laisse `username`/`password` vides, et la connexion partait sans utilisateur.
 */
function mysqlEnvFromUrl(url) {
  const match = /^mysql:\/\/([^:@/]*)(?::([^@/]*))?@([^:/]+)(?::(\d+))?\/?(.*)$/.exec(url.trim());
  if (!match) throw new Error(`MYSQL_MIGRATION_URL illisible : ${url}`);
  const [, user, password = '', host, port = '3306', database] = match;
  return {
    DB_HOST: host,
    DB_PORT: port,
    DB_USER: decodeURIComponent(user),
    DB_PASSWORD: decodeURIComponent(password),
    DB_NAME: database.split('?')[0],
  };
}

const mysqlEnv = mysqlEnvFromUrl;

function startServer({ driver, env }) {
  return new Promise((resolve, reject) => {
    const child = fork(SERVER, [], {
      env: { ...process.env, ...env, DB_DRIVER: driver },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Serveur ${driver} muet après ${READY_TIMEOUT_MS} ms: ${stderr.slice(-400)}`));
    }, READY_TIMEOUT_MS);

    child.once('message', (message) => {
      clearTimeout(timer);
      resolve({ child, port: message.port });
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function get(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: '127.0.0.1', port, path: requestPath, method: 'GET', agent: false },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => {
          let body;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = text;
          }
          resolve({ status: response.statusCode, body });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

/**
 * Diff structurel : mêmes clés, mêmes types, mêmes valeurs. Les différences
 * sont listées par chemin (`data.0.id`) pour rester lisibles dans un rapport.
 */
function diffValues(left, right, at = '', out = []) {
  if (left === right) return out;

  const leftIsObject = left !== null && typeof left === 'object';
  const rightIsObject = right !== null && typeof right === 'object';

  if (!leftIsObject || !rightIsObject) {
    out.push({
      path: at || '(racine)',
      mysql: `${typeof left}:${JSON.stringify(left)?.slice(0, 120)}`,
      postgres: `${typeof right}:${JSON.stringify(right)?.slice(0, 120)}`,
    });
    return out;
  }

  if (Array.isArray(left) !== Array.isArray(right)) {
    out.push({ path: at, mysql: `tableau:${Array.isArray(left)}`, postgres: `tableau:${Array.isArray(right)}` });
    return out;
  }

  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const next = at ? `${at}.${key}` : key;
    if (!(key in left)) {
      out.push({ path: next, mysql: '(absent)', postgres: JSON.stringify(right[key])?.slice(0, 120) });
      continue;
    }
    if (!(key in right)) {
      out.push({ path: next, mysql: JSON.stringify(left[key])?.slice(0, 120), postgres: '(absent)' });
      continue;
    }
    diffValues(left[key], right[key], next, out);
  }

  return out;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mysqlUrl = process.env.MYSQL_MIGRATION_URL;
  const postgresUrl = process.env.DATABASE_MIGRATION_URL;

  if (!mysqlUrl || !postgresUrl) {
    console.error('MYSQL_MIGRATION_URL et DATABASE_MIGRATION_URL sont requis.');
    return 2;
  }

  let requests = defaultRequests();
  if (options.requests) {
    requests = JSON.parse(fs.readFileSync(options.requests, 'utf8'));
  }

  const servers = [];
  try {
    const mysql = await startServer({ driver: 'mysql', env: mysqlEnv(mysqlUrl) });
    servers.push(mysql.child);
    const postgres = await startServer({
      driver: 'postgres',
      env: { DATABASE_URL: postgresUrl, DATABASE_MIGRATION_URL: postgresUrl },
    });
    servers.push(postgres.child);

    const results = [];
    for (const entry of requests) {
      const [fromMysql, fromPostgres] = await Promise.all([
        get(mysql.port, entry.path),
        get(postgres.port, entry.path),
      ]);

      const differences = diffValues(
        { status: fromMysql.status, body: fromMysql.body },
        { status: fromPostgres.status, body: fromPostgres.body },
      );

      results.push({
        label: entry.label || entry.path,
        path: entry.path,
        statuses: { mysql: fromMysql.status, postgres: fromPostgres.status },
        identical: differences.length === 0,
        differences,
      });
    }

    const report = {
      generatedAt: new Date().toISOString(),
      mysql: mysqlUrl.replace(/\/\/[^@]*@/, '//***@'),
      postgres: postgresUrl.replace(/\/\/[^@]*@/, '//***@'),
      compared: results.length,
      divergent: results.filter((result) => !result.identical).length,
      results,
    };

    if (options.report) {
      fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
    }

    for (const result of results) {
      if (result.identical) {
        console.log(`= ${result.label} (${result.statuses.mysql}/${result.statuses.postgres})`);
        continue;
      }
      console.log(`✖ ${result.label} (${result.statuses.mysql}/${result.statuses.postgres})`);
      for (const difference of result.differences.slice(0, 12)) {
        console.log(`    ${difference.path}: mysql=${difference.mysql} postgres=${difference.postgres}`);
      }
    }

    console.log(`\n${report.compared} requête(s), ${report.divergent} divergence(s).`);
    return report.divergent === 0 ? 0 : 1;
  } finally {
    for (const child of servers) child.kill();
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error('Harnais différentiel :', error.message);
      process.exit(2);
    });
}

module.exports = { diffValues, defaultRequests, mysqlEnvFromUrl };
