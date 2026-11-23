// Frontend CineHD — Worker devant les Static Assets.
// /api/* est relayé vers l API Render sur la même origine, pour que le cookie
// de session soit first-party (les navigateurs mobiles bloquent les cookies tiers).
// Build front : VITE_MAIN_API=https://cinehd-mainapp.jasonfranckkenmognw.workers.dev (voir .env.cloudflare).
const UPSTREAM = 'https://cinehd-mainapi.onrender.com';
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const target = new URL(url.pathname + url.search, UPSTREAM);
      const headers = new Headers(request.headers);
      const ip = request.headers.get('CF-Connecting-IP');
      if (ip) headers.set('X-Forwarded-For', ip);
      headers.set('X-Forwarded-Host', url.host);
      headers.set('X-Forwarded-Proto', 'https');
      const init = { method: request.method, headers, redirect: 'manual' };
      if (!['GET', 'HEAD'].includes(request.method)) init.body = request.body;
      const res = await fetch(target, init);
      const out = new Headers(res.headers);
      out.delete('set-cookie');
      for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
        out.append('set-cookie', c.replace(/;\s*Domain=[^;]*/i, ''));
      }
      const loc = out.get('location');
      if (loc && loc.startsWith(UPSTREAM)) out.set('location', url.origin + loc.slice(UPSTREAM.length));
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
    }
    return env.ASSETS.fetch(request);
  },
};
