const { dialectOf } = require('./coreSql');
const { getTablesByGroup, renderCreateTable } = require('./schema');

async function ensureTableGroup(pool, group, dependencies = {}) {
  if (!pool || typeof pool.execute !== 'function') {
    throw new Error('Pool MySQL invalide pour le bootstrap du schéma');
  }

  // Le DDL généré est MySQL : sur PostgreSQL le schéma appartient aux
  // migrations versionnées. Le rejouer ici échouerait sur les backquotes et
  // les types ENUM/AUTO_INCREMENT avant même la première requête métier.
  if (dialectOf() === 'postgres') return;

  const tables = dependencies.tables || getTablesByGroup(group);
  const render = dependencies.renderCreateTable || renderCreateTable;
  for (const table of tables.filter((item) => item.group === group)) {
    await pool.execute(render(table));
  }
}

module.exports = { ensureTableGroup };
