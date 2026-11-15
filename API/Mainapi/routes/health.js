/**
 * Sondes d'orchestrateur.
 *
 * Montées au tout début de `app.js`, avant CORS, compression et restriction de
 * domaine : une sonde interne vient d'une adresse de boucle et n'a pas d'Origin
 * à whitelister, et une réponse de santé ne doit pas dépendre de la
 * configuration cross-origin ni du bootstrap MySQL.
 *
 * Les deux corps sont volontairement statiques. Aucun nom de dépendance, aucune
 * erreur de pilote, aucun secret : ces routes sont joignables sans authentification.
 */

const express = require('express');

function createHealthRouter({ checkReadiness }) {
  if (typeof checkReadiness !== 'function') {
    throw new TypeError('createHealthRouter requires a readiness function');
  }

  const router = express.Router();

  // Liveness : le processus est vivant et sert du HTTP. Reste 200 pendant que
  // les dépendances sont encore en cours de démarrage, sinon un bootstrap long
  // ferait tuer l'instance par l'orchestrateur.
  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Readiness : l'instance peut servir du trafic. 503 tant que MySQL ou Redis
  // ne répondent pas, sans indiquer lequel.
  router.get('/ready', async (_req, res) => {
    try {
      await checkReadiness();
      res.status(200).json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not-ready' });
    }
  });

  return router;
}

module.exports = { createHealthRouter };
