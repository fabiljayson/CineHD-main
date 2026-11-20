#!/usr/bin/env node
/**
 * Application non interactive du schéma MySQL.
 *
 * `db/initDatabase.js` compare le schéma attendu aux métadonnées réelles et
 * refuse de produire du DDL sans terminal interactif (`interactive !== true`).
 * Ce script couvre le cas courant — une base vide à préparer, ou des tables
 * manquantes à ajouter — en s'appuyant sur le même module `db/schema` :
 * `renderCreateTable()` reste l'unique source de vérité des définitions.
 *
 *   cd API/Mainapi
 *   npm run db:schema:apply              # crée les tables manquantes
 *   node scripts/applySchema.js --dry-run
 *
 * Ce n'est pas un outil de migration : une table existante n'est jamais
 * modifiée, même si sa définition a changé depuis. Le script le signale en
 * vérifiant que chaque table attendue est présente, et sort en erreur sinon.
 *
 * Prérequis : DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME (environnement ou
 * `.env`, comme le service). Aucune écriture hors DDL, aucun secret affiché.
 */

require('dotenv').config();

const { createPool } = require('mysql2/promise');
const { schema } = require('../db/schema');
const { renderCreateTable } = require('../db/schema/helpers');

// Les clés étrangères exigent que la table référencée existe déjà. L'ordre du
// module suffit aujourd'hui, mais un ajout de table dans le désordre ne doit
// pas produire un échec définitif : chaque passe retente les tables bloquées.
const MAX_PASSES = 4;

function parseArgs(argv) {
  const options = { dryRun: false, help: false };
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Option inconnue : ${arg}`);
  }
  return options;
}

async function existingTables(pool) {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME AS name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
  );
  return new Set(rows.map((row) => row.name));
}

async function applySchema(pool, { dryRun }) {
  const present = await existingTables(pool);
  const missing = schema.filter((table) => !present.has(table.name));

  if (dryRun) {
    return { present: present.size, created: [], pending: missing.map((table) => table.name) };
  }

  const pending = missing.map((table) => ({ name: table.name, sql: renderCreateTable(table) }));
  const created = [];
  const blocked = new Map();

  for (let pass = 1; pass <= MAX_PASSES && pending.length > 0; pass += 1) {
    for (const table of [...pending]) {
      try {
        await pool.query(table.sql);
        created.push(table.name);
        blocked.delete(table.name);
        pending.splice(pending.indexOf(table), 1);
      } catch (error) {
        blocked.set(table.name, error.message);
      }
    }
  }

  return {
    present: present.size,
    created,
    pending: pending.map((table) => table.name),
    blocked,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage : node scripts/applySchema.js [--dry-run]');
    return;
  }

  const missingEnv = ['DB_HOST', 'DB_USER', 'DB_NAME'].filter((key) => !process.env[key]);
  if (missingEnv.length) {
    throw new Error(`Base non configurée : ${missingEnv.join(', ')} manquant(s). Renseigner l'environnement du service.`);
  }

  const pool = createPool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 1,
    waitForConnections: true,
    multipleStatements: false,
  });

  try {
    const { present, created, pending, blocked = new Map() } = await applySchema(pool, options);

    if (options.dryRun) {
      console.log(`Base ${process.env.DB_NAME} : ${present} table(s) présente(s), ${pending.length} à créer.`);
      for (const name of pending) console.log(`  + ${name}`);
      return;
    }

    console.log(`Base ${process.env.DB_NAME} : ${created.length} table(s) créée(s), ${present} déjà présente(s).`);

    // La vérification porte sur l'état final, pas sur les requêtes émises : une
    // table créée mais absente du catalogue signale un problème réel.
    const after = await existingTables(pool);
    const stillMissing = schema.filter((table) => !after.has(table.name)).map((table) => table.name);

    if (stillMissing.length > 0) {
      for (const name of stillMissing) {
        console.error(`  ✗ ${name} : ${blocked.get(name) || 'absente après création'}`);
      }
      throw new Error(`${stillMissing.length} table(s) manquante(s) sur ${schema.length}`);
    }

    console.log(`Schéma complet : ${after.size} table(s) dans ${process.env.DB_NAME} (${schema.length} attendues).`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Erreur : ${error.message}`);
  process.exitCode = 1;
});
