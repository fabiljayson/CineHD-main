/**
 * Serveur minimal pour le harnais differentiel.
 *
 * Il n'expose que des routes deja portees sur la couche de dialecte : une route
 * encore MySQL ne peut pas repondre sur PostgreSQL, et la comparer n'aurait
 * aucun sens. Etendre ce fichier revient donc a etendre la couverture du
 * harnais aux routes converties.
 *
 * Lance par `scripts/differentialApi.js` avec `DB_DRIVER` a `mysql` ou
 * `postgres` ; rend son port par IPC.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'differential-harness';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const express = require('express');

const app = express();
app.use(express.json());

// GET /links/:type/:id — lecture publique servie par le pool de dialecte.
app.use('/api/admin', require('../../routes/admin'));
// GET /account-requests/plans — reponse purement calculée, utile comme témoin
// de forme (aucun accès base) en plus des routes SQL.
app.use('/api', require('../../routes/accountRequests'));
// GET /likes/:contentType/:contentId — compteurs issus de COUNT(*), le cas
// type où les deux moteurs peuvent différer de type.
app.use('/api/likes', require('../../likesRoutes'));

const server = app.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  if (process.send) process.send({ port });
  else console.log(`PORT=${port}`);
});
