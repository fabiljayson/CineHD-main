#!/usr/bin/env node
/**
 * Application des migrations PostgreSQL — commande d'opérateur.
 *
 * Les migrations ne s'exécutent jamais au démarrage de l'API : une instance qui
 * migre son propre schéma en concurrence avec ses pairs produit des états
 * partiels impossibles à diagnostiquer. Ici :
 *
 * - la connexion utilise `DATABASE_MIGRATION_URL` (endpoint direct Neon), pas
 *   `DATABASE_URL`, dont le pooler ne garantit pas la même session ;
 * - l'application est sérialisée par un verrou consultatif PostgreSQL, donc
 *   deux opérateurs simultanés ne peuvent pas appliquer la même version ;
 * - chaque migration s'exécute dans sa propre transaction et n'est inscrite au
 *   ledger `schema_migrations` qu'après succès ;
 * - une version déjà appliquée dont le fichier a changé est refusée : le ledger
 *   porte son empreinte.
 *
 *   cd API/Mainapi
 *   node db/migratePostgres.js            # applique les versions manquantes
 *   node db/migratePostgres.js --status   # compare ledger et fichiers, sans écrire
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Pool } = require('pg');
const { withPgAdvisoryLock } = require('../utils/pgAdvisoryLock');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const LEDGER = 'schema_migrations';
const LOCK_NAME = 'mainapi:migrations:v1';

function readMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) throw new Error(`Dossier de migrations absent : ${MIGRATIONS_DIR}`);
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const content = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
      return { version: name.replace(/\.sql$/, ''), name, content, checksum: createHash('sha256').update(content).digest('hex') };
    });
}

function connectionString(env) {
  const url = env.DATABASE_MIGRATION_URL;
  if (!url) {
    throw new Error(
      'DATABASE_MIGRATION_URL manquant : les migrations utilisent l’endpoint direct, pas DATABASE_URL (pooler).',
    );
  }
  if (/localhost|127\.0\.0\.1/.test(url)) return { connectionString: url };
  return { connectionString: url, ssl: { rejectUnauthorized: true } };
}

async function ensureLedger(client) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${LEDGER} (
       version TEXT PRIMARY KEY,
       checksum TEXT NOT NULL,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
}

async function appliedVersions(client) {
  const { rows } = await client.query(`SELECT version, checksum FROM ${LEDGER}`);
  return new Map(rows.map((row) => [row.version, row.checksum]));
}

const log = {
  applied: (version) => console.log(`✓ ${version} appliquée`),
  skipped: (version) => console.log(`· ${version} déjà appliquée`),
};

async function migrate({ statusOnly = false } = {}) {
  const migrations = readMigrations();
  const pool = new Pool({ ...connectionString(process.env), max: 2 });

  try {
    return await withPgAdvisoryLock(pool, LOCK_NAME, async (client) => {
      await ensureLedger(client);
      const applied = await appliedVersions(client);
      const summary = { applied: [], skipped: [], pending: [], drifted: [] };

      for (const migration of migrations) {
        const recorded = applied.get(migration.version);
        if (recorded === undefined) {
          summary.pending.push(migration.version);
          continue;
        }
        if (recorded !== migration.checksum) {
          summary.drifted.push(migration.version);
          continue;
        }
        summary.skipped.push(migration.version);
        log.skipped(migration.version);
      }

      if (summary.drifted.length) {
        throw new Error(
          `Migration(s) modifiée(s) après application : ${summary.drifted.join(', ')}. ` +
            'Créer une nouvelle migration au lieu de réécrire une version appliquée.',
        );
      }

      if (statusOnly) {
        console.log(
          summary.pending.length
            ? `En attente : ${summary.pending.join(', ')}`
            : 'Aucune migration en attente.',
        );
        return summary;
      }

      for (const migration of migrations) {
        if (summary.skipped.includes(migration.version)) continue;
        await client.query('BEGIN');
        try {
          await client.query(migration.content);
          await client.query(`INSERT INTO ${LEDGER} (version, checksum) VALUES ($1, $2)`, [
            migration.version,
            migration.checksum,
          ]);
          await client.query('COMMIT');
          summary.applied.push(migration.version);
          log.applied(migration.version);
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw new Error(`Échec de la migration ${migration.version} (rollback effectué) : ${error.message}`);
        }
      }

      return summary;
    });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  migrate({ statusOnly: process.argv.includes('--status') })
    .then((summary) => {
      if (!process.argv.includes('--status')) {
        console.log(
          summary.applied.length
            ? `${summary.applied.length} migration(s) appliquée(s).`
            : 'Base déjà à jour.',
        );
      }
    })
    .catch((error) => {
      console.error(`Erreur : ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { LOCK_NAME, LEDGER, readMigrations, migrate };
