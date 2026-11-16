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

/**
 * Proposition de segment : une par (cible, type, auteur).
 *
 * Le recalage des compteurs à zéro fait partie de l'upsert : reproposer
 * invalide les votes portés sur les bornes précédentes.
 */
function upsertSegmentSubmission(sqlDialect = dialectOf()) {
  const columns = `INSERT INTO segment_submissions
       (media_type, tmdb_id, season, episode, reference_duration_ms,
        segment_type, start_ms, end_ms, author_user_type, author_user_id, author_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  if (sqlDialect === POSTGRES) {
    return `${columns}
     ON CONFLICT (media_type, tmdb_id, season, episode, segment_type, author_user_type, author_user_id)
     DO UPDATE SET
       start_ms = EXCLUDED.start_ms,
       end_ms = EXCLUDED.end_ms,
       reference_duration_ms = EXCLUDED.reference_duration_ms,
       author_label = EXCLUDED.author_label,
       votes_up = 0, votes_down = 0, score = 0`;
  }
  return `${columns}
     ON DUPLICATE KEY UPDATE
       start_ms = VALUES(start_ms),
       end_ms = VALUES(end_ms),
       reference_duration_ms = VALUES(reference_duration_ms),
       author_label = VALUES(author_label),
       votes_up = 0, votes_down = 0, score = 0`;
}

/** Vote d'un utilisateur sur une proposition : une ligne par votant. */
function upsertSegmentVote(sqlDialect = dialectOf()) {
  const columns = `INSERT INTO segment_votes (submission_id, voter_user_type, voter_user_id, value, weight)
     VALUES (?, ?, ?, ?, ?)`;
  if (sqlDialect === POSTGRES) {
    return `${columns}
     ON CONFLICT (submission_id, voter_user_type, voter_user_id)
     DO UPDATE SET value = EXCLUDED.value, weight = EXCLUDED.weight`;
  }
  return `${columns}
     ON DUPLICATE KEY UPDATE value = VALUES(value), weight = VALUES(weight)`;
}

/**
 * Écart de durée toléré dans le filtre d'un épisode.
 *
 * `CAST(x AS SIGNED)` est une conversion MySQL ; PostgreSQL n'accepte que les
 * types SQL (`BIGINT`). La valeur reste un bigint des deux côtés.
 */
function durationToleranceClause(sqlDialect = dialectOf()) {
  return sqlDialect === POSTGRES
    ? 'AND ABS(CAST(s.reference_duration_ms AS BIGINT) - ?) <= ?'
    : 'AND ABS(CAST(s.reference_duration_ms AS SIGNED) - ?) <= ?';
}

module.exports = {
  upsertNotificationPreferences,
  upsertHelpFeedback,
  upsertSegmentSubmission,
  upsertSegmentVote,
  durationToleranceClause,
};
