const express = require('express');
const axios = require('axios');

const { requireVip } = require('../checkVip');

const router = express.Router();

// BestDebrid est appelé côté serveur : la clé API ne quitte plus le backend.
// (Elle était auparavant exposée aux clients VIP via GET /debrid/bestdebrid-key,
// qui appelaient ensuite bestdebrid.com directement depuis le navigateur.)
const BESTDEBRID_API_BASE = 'https://bestdebrid.com/api/v1';
const BESTDEBRID_TIMEOUT_MS = 30000;
const BESTDEBRID_MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 Mo

const asRecord = (value) =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value : null);

const str = (value) => (typeof value === 'string' ? value.trim() : '');

// Même extraction de candidat que faisait DebridPage : tableau | data[] | data{} | payload.
const pickBestDebridCandidate = (payload) => {
  if (Array.isArray(payload)) return payload.find(asRecord) || null;
  if (!asRecord(payload)) return null;
  if (Array.isArray(payload.data)) return payload.data.find(asRecord) || null;
  if (asRecord(payload.data)) return payload.data;
  return payload;
};

// Même logique de lien direct que le navigateur (champ `link` si différent de
// la cible, sinon `download` puis `streammp4`).
const pickBestDebridLink = (candidate, targetUrl) => {
  const originalLink = str(candidate.original_link);
  const sourceLink = str(candidate.link);
  if (
    sourceLink &&
    sourceLink !== targetUrl &&
    (!originalLink || sourceLink !== originalLink)
  ) {
    return sourceLink;
  }
  return str(candidate.download) || str(candidate.streammp4);
};

// Taille de fichier lisible ("1.5 GB" -> octets), comme côté frontend.
const parseHumanReadableSize = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const match = value.trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*([KMGTP]?i?B)$/i);
  if (!match) return 0;
  const multipliers = {
    KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, PB: 1e15,
    KIB: 1024, MIB: 1048576, GIB: 1073741824, TIB: 1099511627776, PIB: 1125899906842624,
  };
  return Math.round(Number.parseFloat(match[1]) * (multipliers[match[2].toUpperCase()] || 0));
};

// POST /api/debrid/generate — génère un lien BestDebrid côté serveur.
// Body JSON : { link: string }. Renvoie uniquement le lien généré (+ métadonnées),
// jamais la clé API.
router.post('/debrid/generate', requireVip, async (req, res) => {
  const apiKey = (process.env.BESTDEBRID_API_KEY || '').trim();

  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  if (!apiKey) {
    return res.status(503).json({
      success: false,
      error: 'Cle API BestDebrid non configuree sur le backend'
    });
  }

  const link = str(req.body?.link);
  if (!link || link.length > 2048 || !/^https?:\/\//i.test(link)) {
    return res.status(400).json({
      success: false,
      error: 'Lien invalide'
    });
  }

  try {
    // Exactement l'appel que faisait le navigateur : GET /generateLink?auth=...&link=...
    const response = await axios.get(`${BESTDEBRID_API_BASE}/generateLink`, {
      params: { auth: apiKey, link },
      timeout: BESTDEBRID_TIMEOUT_MS,
      maxContentLength: BESTDEBRID_MAX_RESPONSE_BYTES,
      maxBodyLength: BESTDEBRID_MAX_RESPONSE_BYTES,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const candidate = pickBestDebridCandidate(response.data) || {};
    const directLink = pickBestDebridLink(candidate, link);

    if (!directLink) {
      return res.status(502).json({
        success: false,
        error: "BestDebrid n'a pas renvoyé de lien téléchargeable exploitable."
      });
    }

    return res.json({
      success: true,
      link: directLink,
      filename: str(candidate.filename),
      filesize: typeof candidate.filesize === 'number' && Number.isFinite(candidate.filesize)
        ? candidate.filesize
        : parseHumanReadableSize(candidate.size),
      host: str(candidate.hoster) || str(candidate.host),
    });
  } catch (error) {
    if (error.response) {
      // On propage le message d'erreur BestDebrid tel quel ({ error } / { message }).
      const upstream = error.response.data;
      const message = upstream && (upstream.error?.message || upstream.error || upstream.message);
      return res.status(502).json({
        success: false,
        error: typeof message === 'string' && message.trim()
          ? message.trim().slice(0, 300)
          : `BestDebrid indisponible (HTTP ${error.response.status})`
      });
    }
    return res.status(502).json({
      success: false,
      error: 'Impossible de joindre BestDebrid depuis le serveur.'
    });
  }
});

module.exports = router;
