# Lot C2 — Consentement aux CGU à l'inscription

Date : 2026-11-13 · Branche : `main` · Périmètre : les deux parcours de création de compte.

## Changement

Toute création de compte exige désormais une acceptation explicite des Conditions
d'utilisation, avec preuve horodatée :

| Parcours | Endpoint | Preuve stockée |
| --- | --- | --- |
| `/create-account` (compte BIP39 immédiat) | `POST /api/auth/bip39/create` | `terms_accepted_at` (horodatage ms) dans `API/Mainapi/data/users/bip39-<id>.json` |
| « Créer un compte » (demande payante, page Login) — saisie manuelle **et** paiement CamPay | `POST /api/account-requests`, `POST /api/account-requests/checkout` | colonne MySQL `account_requests.terms_accepted_at` (ajoutée automatiquement au démarrage via `ensureColumn`, déclarée aussi dans `db/schema/core.js`) |

Refus serveur : `400 {"code":"TERMS_REQUIRED"}`. Le contrôle s'exécute avant la
vérification Turnstile et avant toute initiation de paiement.

Côté frontend : case à cocher obligatoire sur la dernière étape de `/create-account`
(et `/link-bip39/create`, même composant) et dans l'onglet « Créer un compte » de
`/login` ; bouton de soumission désactivé tant que la case n'est pas cochée.
Traductions FR/EN ajoutées (`auth.termsAgreement` réutilisé, clé morte auparavant).

## Prérequis

- Docker : `cinehd-mysql` et `cinehd-redis` démarrés.
- API démarrée depuis `API/Mainapi` :

```bash
cd API/Mainapi
# Instance de test : Turnstile désactivé pour pouvoir appeler les endpoints sans jeton
TURNSTILE_SECRET_KEY= setsid nohup node server.js > /tmp/opencode/mainapi-c2.log 2>&1 < /dev/null &
# (pour le test du endpoint CamPay uniquement) :
# TURNSTILE_SECRET_KEY= CAMPAY_PERMANENT_TOKEN=fake-local-test-token node server.js
```

Rappel : `authRateLimit` = 10 requêtes / 15 min, `createRequestRateLimit` = 6 / h —
les commandes ci-dessous consomment 4 et 3 de ces quotas.

## Scénarios exécutés (POST en localhost:25565)

| # | Requête | Attendu | Observé |
| --- | --- | --- | --- |
| A | `GET /api/auth/bip39/generate` | 200 + mnemonic | ✅ 200, 12 mots |
| B | `POST /api/auth/bip39/create` **sans** `acceptedTerms` | 400 `TERMS_REQUIRED` | ✅ 400, `{"code":"TERMS_REQUIRED"}` |
| C | `POST /api/auth/bip39/create` **avec** `acceptedTerms:true` | 200 + preuve écrite | ✅ 200, `terms_accepted_at=1794597963149` (2026-11-13T19:26:03Z) dans `data/users/bip39-<id>.json` |
| D | idem C mais **sans** `acceptedTerms` (compte déjà existant) | 400 `TERMS_REQUIRED` | ✅ 400 — la preuve n'est jamais réécrite et le refus tient aussi sur un compte existant |
| E | `POST /api/account-requests` **sans** `acceptedTerms` | 400 `TERMS_REQUIRED` | ✅ 400 |
| F | `POST /api/account-requests` **avec** `acceptedTerms:true` (plan `week`, 1400 FCFA, MTN) | 201 + preuve en base | ✅ 201 ; colonne `terms_accepted_at` créée au démarrage (`timestamp NULL`) ; ligne lue : `terms_accepted_at=2026-11-13T18:26:54Z`, `has_proof=1` |
| G | `POST /api/account-requests/checkout` **sans** `acceptedTerms` (CamPay « configuré » par jeton factice) | 400 `TERMS_REQUIRED` | ✅ 400 — le contrôle précède `initCollect` (aucun appel paiement) |

Corps utilisés (rejouables) :

```bash
# create BIP39
curl -s -X POST localhost:25565/api/auth/bip39/create -H 'Content-Type: application/json' \
  -d '{"mnemonic":"<12 mots de GET /api/auth/bip39/generate>","username":"c2testuser","avatar":"https://example.com/a.png"}'
# → 400 TERMS_REQUIRED ; ajouter "acceptedTerms":true → 200

# demande de compte
curl -s -X POST localhost:25565/api/account-requests -H 'Content-Type: application/json' \
  -d '{"planId":"week","amountFcfa":1400,"paymentMethod":"mtn_momo","payerMsisdn":"237690123456","reference":"C2TESTREF01","username":"c2testuser"}'
# → 400 TERMS_REQUIRED ; ajouter "acceptedTerms":true → 201
```

### Nettoyage après exécution

- `DELETE FROM account_requests WHERE id=1 AND reference='C2TESTREF01'` → 1 ligne supprimée, table vide.
- `data/users/bip39-ad0b0126963512de.json` supprimé.
- Aucun secret dans ce rapport.

## Contrôles statiques associés

| Contrôle | Commande | Résultat |
| --- | --- | --- |
| Syntaxe backend | `node --check` sur `authRoutes.js`, `accountRequests.js`, `app.js`, `db/schema/core.js` | ✅ OK |
| Types frontend | `npx tsc --noEmit` | ✅ 0 erreur |
| Tests racine | `npm test` | ✅ 374/374 |
| Build | `npm run build` | ✅ exit 0 |
| Lint des fichiers touchés | `npx eslint src/pages/CreateAccount.tsx src/pages/Login.tsx src/services/accountRequestsService.ts` | ✅ 0 problème |

## Hors périmètre

- Les connexions OAuth (Discord/Google) qui créent un compte à la première
  connexion ne portent pas de formulaire : aucun consentement n'y est recueilli.
- La validation admin d'une demande (`approve`) ne re-vérifie pas le consentement :
  il est capturé à la soumission de la demande.
