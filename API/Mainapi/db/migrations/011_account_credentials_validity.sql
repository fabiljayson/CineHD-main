-- Codes de connexion : durée de validité (en secondes) stockée à la
-- génération (POST /api/admin/account-codes). subscription_expires_at n'est
-- plus fixé à la génération : il se crée à l'usage valide — le 1er login —
-- afin qu'un code non utilisé n'entame pas sa validité (authRoutes.js
-- /account/login). La mise à jour des logins suivants ne le repousse pas.
ALTER TABLE account_credentials ADD COLUMN validity_seconds BIGINT DEFAULT NULL;
