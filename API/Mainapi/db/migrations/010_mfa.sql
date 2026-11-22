-- MFA (item #9) — TOTP sur account_credentials.
-- `mfa_required` : activé par l'admin — le login (password-login) est bloqué
-- avec 401 { requiresMfa: true } jusqu'à un code TOTP valide.
-- `mfa_secret` : secret TOTP de base32 (MYTTER pour MySQL, TEXT sur PG).
ALTER TABLE account_credentials ADD COLUMN mfa_required BOOLEAN DEFAULT FALSE;
ALTER TABLE account_credentials ADD COLUMN mfa_secret TEXT;
