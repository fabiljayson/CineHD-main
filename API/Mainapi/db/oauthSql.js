/**
 * Requêtes OAuth dont le SQL diffère entre MySQL et PostgreSQL, sur le modèle
 * de `db/coreSql.js`.
 *
 * Les upserts MySQL (`ON DUPLICATE KEY UPDATE … VALUES(colonne)`) n'ont pas
 * d'équivalent direct : PostgreSQL exige `ON CONFLICT (clé) DO UPDATE …
 * EXCLUDED.colonne`, et la clé doit correspondre à une contrainte réelle.
 */

const { dialectOf } = require('./coreSql');

const POSTGRES = 'postgres';

/** Client OAuth enregistré : clé unique `uq_oauth_clients_client_id`. */
function upsertOauthClient(sqlDialect = dialectOf()) {
  const columns = `INSERT INTO oauth_clients
           (client_id, client_name, description, homepage_url, redirect_uris,
            allowed_scopes, public_client, require_pkce, client_secret,
            is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`;
  if (sqlDialect === POSTGRES) {
    return `${columns}
         ON CONFLICT (client_id) DO UPDATE SET updated_at = EXCLUDED.updated_at`;
  }
  return `${columns}
         ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`;
}

/**
 * Demande d'autorisation : `request_hash` est la clé primaire, donc une même
 * demande rejouée met à jour sa ligne et son `last_seen_at`.
 */
function upsertAuthorizationRequest(sqlDialect = dialectOf()) {
  const columns = `INSERT INTO oauth_authorization_requests
      (request_hash, client_id, redirect_uri, response_type, scopes, state, code_challenge, code_challenge_method, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  if (sqlDialect === POSTGRES) {
    return `${columns}
     ON CONFLICT (request_hash) DO UPDATE SET
      client_id = EXCLUDED.client_id,
      redirect_uri = EXCLUDED.redirect_uri,
      response_type = EXCLUDED.response_type,
      scopes = EXCLUDED.scopes,
      state = EXCLUDED.state,
      code_challenge = EXCLUDED.code_challenge,
      code_challenge_method = EXCLUDED.code_challenge_method,
      expires_at = EXCLUDED.expires_at,
      last_seen_at = now()`;
  }
  return `${columns}
     ON DUPLICATE KEY UPDATE
      client_id = VALUES(client_id),
      redirect_uri = VALUES(redirect_uri),
      response_type = VALUES(response_type),
      scopes = VALUES(scopes),
      state = VALUES(state),
      code_challenge = VALUES(code_challenge),
      code_challenge_method = VALUES(code_challenge_method),
      expires_at = VALUES(expires_at),
      last_seen_at = NOW()`;
}

module.exports = { upsertOauthClient, upsertAuthorizationRequest };
