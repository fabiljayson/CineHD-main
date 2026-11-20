#!/usr/bin/env node
/**
 * Génère `db/migrations/00X_<groupe>.sql` depuis `db/schema`.
 *
 * Les migrations sont versionnées et relues : ce script ne les applique pas, il
 * les réécrit. L'opérateur les applique avec `db/migratePostgres.js`, après quoi
 * le ledger de la base refusera de rejouer une version dont le contenu a changé.
 *
 *   cd API/Mainapi && node db/generatePostgresMigrations.js
 *
 * Sans argument, les six fichiers sont réécrits. `--check` compare sans écrire
 * et sort en erreur si le disque diverge du schéma (utile en CI).
 */

const fs = require('node:fs');
const path = require('node:path');
const { schema } = require('./schema');
const { renderPostgresGroup } = require('./schema/renderPostgres');

const GROUPS = [
  ['core', '001_core.sql'],
  ['media', '002_media.sql'],
  ['community', '003_community.sql'],
  ['oauth', '004_oauth.sql'],
  ['vip', '005_vip.sql'],
  ['wrapped', '006_wrapped.sql'],
];

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function migrationBody(group, tables) {
  return [
    `-- Migration ${group} — générée par db/generatePostgresMigrations.js`,
    '-- Ne pas modifier à la main : régénérer depuis db/schema.',
    '',
    renderPostgresGroup(tables, { withTouchFunction: group === 'core' }),
    '',
  ].join('\n');
}

function build() {
  const files = new Map();
  for (const [group, filename] of GROUPS) {
    const tables = schema.filter((table) => table.group === group);
    if (tables.length === 0) throw new Error(`Aucune table pour le groupe ${group}`);
    files.set(filename, migrationBody(group, tables));
  }
  return files;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const files = build();
  const stale = [];

  fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  for (const [filename, content] of files) {
    const target = path.join(MIGRATIONS_DIR, filename);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current === content) continue;
    stale.push(filename);
    if (!checkOnly) fs.writeFileSync(target, content);
  }

  if (checkOnly) {
    if (stale.length) {
      console.error(`Migrations désynchronisées du schéma : ${stale.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    console.log('Migrations à jour.');
    return;
  }

  console.log(
    stale.length
      ? `Migrations réécrites : ${stale.join(', ')}`
      : 'Migrations déjà à jour.',
  );
}

if (require.main === module) main();

module.exports = { GROUPS, MIGRATIONS_DIR, build };
