(() => {
    var __defProp = Object.defineProperty;
    var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
  
    // index.js
    var blacklistUrls = [];
    // Only the site's own origins may use this proxy from a browser.
    // Server-side relays (the Main API) send no Origin header: they
    // authenticate with the shared secret WORKER_SHARED_TOKEN instead
    // (`wrangler secret put WORKER_SHARED_TOKEN`). An absent or empty secret
    // disables that path — the worker then fails closed on Origin-less calls.
    var whitelistOrigins = [
      /^https:\/\/([a-z0-9-]+\.)*(movix\.(cash|chat|cloud|college|date|fun|golf|health|luxe|men|online|show|tax))(?::\d+)?$/i,
      /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i
    ];
    function getSharedToken() {
      try {
        return typeof WORKER_SHARED_TOKEN === "string" ? WORKER_SHARED_TOKEN : "";
      } catch (e) {
        return "";
      }
    }
    __name(getSharedToken, "getSharedToken");
    // Length-checked XOR so a wrong token cannot be guessed byte by byte.
    function tokenMatches(candidate, expected) {
      if (typeof candidate !== "string" || typeof expected !== "string") return false;
      if (expected.length === 0 || candidate.length !== expected.length) return false;
      let diff = 0;
      for (let i = 0; i < expected.length; i += 1) {
        diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
      }
      return diff === 0;
    }
    __name(tokenMatches, "tokenMatches");
    // A non-string (absent header) no longer matches: that was the open proxy.
    function isListedInWhitelist(uri, listing) {
      if (typeof uri !== "string") return false;
      let isListed = false;
      listing.forEach((pattern) => {
        if (uri.match(pattern) !== null) {
          isListed = true;
        }
      });
      return isListed;
    }
    __name(isListedInWhitelist, "isListedInWhitelist");
    addEventListener("fetch", async (event) => {
      event.respondWith(async function() {
        const isPreflightRequest = event.request.method === "OPTIONS";
        const originUrl = new URL(event.request.url);
        function setupCORSHeaders(headers) {
          // No Origin (token relay) => no CORS header to echo; writing the
          // literal "null" would only confuse browsers.
          if (originHeader !== null) {
            headers.set("Access-Control-Allow-Origin", originHeader);
          }
          if (isPreflightRequest) {
            headers.set("Access-Control-Allow-Methods", event.request.headers.get("access-control-request-method"));
            const requestedHeaders = event.request.headers.get("access-control-request-headers");
            if (requestedHeaders) {
              headers.set("Access-Control-Allow-Headers", requestedHeaders);
            }
            headers.delete("X-Content-Type-Options");
          }
          return headers;
        }
        __name(setupCORSHeaders, "setupCORSHeaders");
        const targetUrl = decodeURIComponent(decodeURIComponent(originUrl.search.substr(1)));
        const originHeader = event.request.headers.get("Origin");
        const connectingIp = event.request.headers.get("CF-Connecting-IP");
        const sharedToken = getSharedToken();
        const originAllowed = isListedInWhitelist(originHeader, whitelistOrigins);
        // Server-side relay: no Origin, but a matching shared secret.
        const tokenAllowed =
          sharedToken !== "" && tokenMatches(event.request.headers.get("x-worker-token"), sharedToken);
        if (!isListedInWhitelist(targetUrl, blacklistUrls) && (originAllowed || tokenAllowed)) {
          // x-cors-headers lets a caller inject arbitrary headers into the
          // proxied request — only the authenticated relay may use it, never a
          // browser origin.
          let customHeaders = null;
          if (tokenAllowed) {
            const rawCustomHeaders = event.request.headers.get("x-cors-headers");
            if (rawCustomHeaders !== null) {
              try {
                const parsed = JSON.parse(rawCustomHeaders);
                if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
                  customHeaders = parsed;
                }
              } catch (e) {
              }
            }
          }
          if (originUrl.search.startsWith("?")) {
            const filteredHeaders = {};
            for (const [key, value] of event.request.headers.entries()) {
              if (key.match("^origin") === null && key.match("eferer") === null && key.match("^cf-") === null && key.match("^x-forw") === null && key.match("^x-cors-headers") === null && key.match("^x-worker-token") === null) {
                filteredHeaders[key] = value;
              }
            }
            if (customHeaders !== null) {
              Object.entries(customHeaders).forEach((entry) => filteredHeaders[entry[0]] = entry[1]);
            }
            const newRequest = new Request(event.request, {
              redirect: "follow",
              headers: filteredHeaders
            });
            const response = await fetch(targetUrl, newRequest);
            let responseHeaders = new Headers(response.headers);
            const exposedHeaders = [];
            const allResponseHeaders = {};
            for (const [key, value] of response.headers.entries()) {
              exposedHeaders.push(key);
              allResponseHeaders[key] = value;
            }
            exposedHeaders.push("cors-received-headers");
            responseHeaders = setupCORSHeaders(responseHeaders);
            responseHeaders.set("Access-Control-Expose-Headers", exposedHeaders.join(","));
            responseHeaders.set("cors-received-headers", JSON.stringify(allResponseHeaders));
            const responseBody = isPreflightRequest ? null : await response.arrayBuffer();
            const responseInit = {
              headers: responseHeaders,
              status: isPreflightRequest ? 200 : response.status,
              statusText: isPreflightRequest ? "OK" : response.statusText
            };
            return new Response(responseBody, responseInit);
          } else {
            let responseHeaders = new Headers();
            responseHeaders = setupCORSHeaders(responseHeaders);
            let country = false;
            let colo = false;
            if (typeof event.request.cf !== "undefined") {
              country = event.request.cf.country || false;
              colo = event.request.cf.colo || false;
            }
            return new Response(
              "CLOUDFLARE-CORS-ANYWHERE\n\nSource:\nhttps://github.com/Zibri/cloudflare-cors-anywhere\n\nUsage:\n" + originUrl.origin + "/?uri\n\nLimits: 100,000 requests/day\n          1,000 requests/10 minutes\n\n" + (originHeader !== null ? "Origin: " + originHeader + "\n" : "") + "IP: " + connectingIp + "\n" + (country ? "Country: " + country + "\n" : "") + (colo ? "Datacenter: " + colo + "\n" : "") + "\n" + (customHeaders !== null ? "\nx-cors-headers: " + JSON.stringify(customHeaders) : ""),
              {
                status: 200,
                headers: responseHeaders
              }
            );
          }
        } else {
          return new Response(
            "Create your own CORS proxy</br>\n<a href='https://github.com/Zibri/cloudflare-cors-anywhere'>https://github.com/Zibri/cloudflare-cors-anywhere</a>\n",
            {
              status: 403,
              statusText: "Forbidden",
              headers: {
                "Content-Type": "text/html"
              }
            }
          );
        }
      }());
    });
  })();
  //# sourceMappingURL=index.js.map
  