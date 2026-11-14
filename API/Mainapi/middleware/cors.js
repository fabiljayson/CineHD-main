/**
 * CORS middleware configuration.
 * Extracted from server.js -- restricted origin policy.
 */

const cors = require("cors");
const { isOAuthCorsOriginAllowed } = require('../utils/oauthClients');
// Liste unique des domaines : voir config/allowedOrigins.js. La règle de
// localhost en développement reste ci-dessous, conditionnée à NODE_ENV.
const { isAllowedUrl: isAllowedStaticOrigin } = require('../config/allowedOrigins');

function isAllowedOAuthOrigin(origin) {
  return isOAuthCorsOriginAllowed(origin);
}

const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Allow all localhost requests in development only
    if (process.env.NODE_ENV !== 'production' && origin.match(/^https?:\/\/localhost(:[0-9]+)?$/)) {
      return callback(null, true);
    }

    if (isAllowedStaticOrigin(origin) || isAllowedOAuthOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE", "PATCH", "HEAD"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "X-No-Compression",
    "Access-Control-Request-Headers",
    "baggage",
    "sentry-trace",
    "x-profile-id",
    "x-access-key",
    "x-movix-client-id",
    "x-turnstile-token",
  ],
  credentials: true,
  maxAge: 600,
  optionsSuccessStatus: 204,
});

module.exports = corsMiddleware;
