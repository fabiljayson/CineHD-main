/**
 * Requêtes de la couche communauté dont le SQL diffère entre MySQL et
 * PostgreSQL, sur le modèle de `db/coreSql.js`.
 *
 * Cas visé : l'upsert. MySQL écrit `ON DUPLICATE KEY UPDATE … VALUES(colonne)`,
 * que PostgreSQL refuse ; il exige `ON CONFLICT (colonnes) DO UPDATE …
 * EXCLUDED.colonne`. Le comportement observable doit rester identique — une
 * seconde écriture met à jour la ligne, elle n'en crée pas une deuxième.
 *
 * Les deux variantes gardent des `?` : l'adaptateur PostgreSQL les convertit en
 * `$n`.
 */

const { dialectOf } = require('./coreSql');

const POSTGRES = 'postgres';

/** Préférences de notifications : clé primaire (user_id, user_type). */
function upsertNotificationPreferences(sqlDialect = dialectOf()) {
  if (sqlDialect === POSTGRES) {
    return `INSERT INTO user_notification_preferences (user_id, user_type, notifications_disabled, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, user_type) DO UPDATE
         SET notifications_disabled = EXCLUDED.notifications_disabled,
             updated_at = EXCLUDED.updated_at`;
  }
  return `INSERT INTO user_notification_preferences (user_id, user_type, notifications_disabled, updated_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE notifications_disabled = VALUES(notifications_disabled), updated_at = VALUES(updated_at)`;
}

/**
 * Avis « utile / pas utile » sur une page d'aide.
 *
 * La clé est le couple (slug, ip_hash) : le même visiteur qui revote met à jour
 * son avis au lieu d'en ajouter un. Côté PostgreSQL la contrainte vient de
 * migrations/007 (le rendu généré l'avait perdue).
 */
function upsertHelpFeedback(sqlDialect = dialectOf()) {
  if (sqlDialect === POSTGRES) {
    return `INSERT INTO help_feedback (slug, helpful, ip_hash, user_agent)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (slug, ip_hash) DO UPDATE
         SET helpful = EXCLUDED.helpful,
             user_agent = EXCLUDED.user_agent,
             updated_at = now()`;
  }
  return `INSERT INTO help_feedback (slug, helpful, ip_hash, user_agent)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE helpful = VALUES(helpful), user_agent = VALUES(user_agent)`;
}

module.exports = { upsertNotificationPreferences, upsertHelpFeedback };
