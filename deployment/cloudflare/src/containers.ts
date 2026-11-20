/**
 * Classes Container du Worker CineHD.
 *
 * Un Container Cloudflare est adressé par un Durable Object : le Worker route
 * la requête vers le namespace, le DO démarre l'instance, attend qu'elle
 * réponde, puis transmet. Ce fichier ne contient que ce cycle de vie — la
 * décision de routage reste dans `routing.mjs`.
 *
 * Trois principes :
 *
 * - **Aucun trafic vers une instance non prête.** `fetch` vérifie `/health`
 *   avant de transmettre : une instance qui vient de démarrer répond 503 plutôt
 *   que de laisser la requête expirer.
 * - **Les pannes sont visibles.** Un démarrage raté renvoie un 503 nommé et
 *   journalise la raison, sans exposer d'hôte interne ni d'identifiant.
 * - **Les limites viennent de la configuration**, pas du code : `wrangler.toml`
 *   porte `max_instances` et `instance_type` (Task 1 / Task 6), le DO lit le port
 *   dans son environnement.
 */

import { DurableObject } from 'cloudflare:workers';

const READY_TIMEOUT_MS = 45000;
const READY_POLL_MS = 500;

function jsonError(status, error, service) {
  return new Response(JSON.stringify({ error, service }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Comportement partagé : démarrage, attente de disponibilité, proxy.
 * Le port et les limites varient par service.
 */
class ServiceContainer extends DurableObject {
  defaultPort = 8080;

  service = 'service';

  /** État de disponibilité déjà constaté, pour éviter une sonde par requête. */
  ready = false;

  async ensureStarted() {
    const container = this.ctx.container;
    if (!container) throw new Error('container binding unavailable');
    if (!container.running) {
      await container.start({ env: this.containerEnv() });
    }
    return container;
  }

  containerEnv() {
    // Les secrets viennent des bindings du Worker ; rien n'est écrit en dur.
    const env = this.env || {};
    const passthrough = {};
    for (const key of ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'APP_ORIGIN']) {
      if (typeof env[key] === 'string') passthrough[key] = env[key];
    }
    return passthrough;
  }

  async waitUntilReady() {
    if (this.ready) return true;
    const container = await this.ensureStarted();
    const port = container.getTcpPort(this.defaultPort);
    const deadline = Date.now() + READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const response = await port.fetch(`http://container:${this.defaultPort}/health`);
        if (response.ok) {
          this.ready = true;
          return true;
        }
      } catch {
        // Instance encore en démarrage : on réessaie jusqu'à l'échéance.
      }
      await sleep(READY_POLL_MS);
    }
    return false;
  }

  async fetch(request) {
    const ready = await this.waitUntilReady();
    if (!ready) {
      // Le nom du service suffit : la cause détaillée peut contenir un hôte
      // interne ou un identifiant d'instance.
      console.error(`container not ready: ${this.service}`);
      return jsonError(503, 'container_not_ready', this.service);
    }
    const container = await this.ensureStarted();
    return container.getTcpPort(this.defaultPort).fetch(request);
  }
}

export class MainApiContainer extends ServiceContainer {
  defaultPort = 8080;

  service = 'mainapi';
}

export class WatchPartyContainer extends ServiceContainer {
  defaultPort = 25566;

  service = 'watchparty';
}

export class ProxyContainer extends ServiceContainer {
  defaultPort = 25569;

  service = 'proxy';
}
