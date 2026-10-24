'use strict';

// Plafond de taille par défaut des réponses (pages HTML, manifests) : sans
// limite, un upstream hostile peut faire grossir indéfiniment le RSS du worker.
const DEFAULT_MAX_RESPONSE_BYTES = 50 * 1024 * 1024; // 50 Mo

/** Exécute des opérations sans dépasser le budget de concurrence du lot. */
async function mapWithConcurrency(items, concurrency, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Annule réellement Axios au délai demandé. Le timer est toujours libéré,
 * y compris quand le transport termine avant son échéance.
 */
async function axiosGetWithDeadline(axios, url, { timeoutMs = 4500, options = {} } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await axios.get(url, {
      maxContentLength: DEFAULT_MAX_RESPONSE_BYTES,
      maxBodyLength: DEFAULT_MAX_RESPONSE_BYTES,
      ...options,
      timeout: timeoutMs,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { mapWithConcurrency, axiosGetWithDeadline };
