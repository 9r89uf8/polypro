/**
 * Cloudflare Worker that proxies requests to aviation.meteo.fr (AEROWEB).
 *
 * Convex sets AEROWEB_BASE_URL to this Worker's URL. The Worker forwards
 * every request to the real upstream, passing through headers, cookies,
 * method, and body. Responses (including Set-Cookie) are returned as-is.
 *
 * A shared secret in the `x-proxy-secret` header prevents abuse.
 *
 * Paths proxied:
 *   /login.php
 *   /ajax/login_valid.php
 *   /showmessage.php?code=LFPG
 *   (any other path under aviation.meteo.fr)
 */

const ALLOWED_PATHS = [
  "/login.php",
  "/ajax/login_valid.php",
  "/showmessage.php",
  "/accueil.php",
  "/affichemessages.php",
  "/bulletin_maa.php",
];

export default {
  async fetch(request, env) {
    // Verify shared secret.
    const secret = request.headers.get("x-proxy-secret");
    if (!env.PROXY_SECRET || secret !== env.PROXY_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // Only proxy known AEROWEB paths.
    if (!ALLOWED_PATHS.some((p) => pathname === p || pathname.startsWith(p))) {
      return new Response("Not Found", { status: 404 });
    }

    // Build upstream URL.
    const upstream = env.UPSTREAM_BASE || "https://aviation.meteo.fr";
    const upstreamUrl = `${upstream}${pathname}${url.search}`;

    // Forward headers, replacing Host and adding Referer if missing.
    const headers = new Headers(request.headers);
    headers.delete("x-proxy-secret");
    headers.set("Host", new URL(upstream).host);
    if (!headers.has("Referer")) {
      headers.set("Referer", `${upstream}/login.php`);
    }
    // Remove Cloudflare-specific headers that might confuse the upstream.
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("cf-ray");
    headers.delete("cf-visitor");
    headers.delete("cdn-loop");

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };

    // Forward body for POST requests.
    if (request.method === "POST") {
      init.body = await request.text();
    }

    const response = await fetch(upstreamUrl, init);

    // Return the response with all headers (including Set-Cookie).
    const responseHeaders = new Headers(response.headers);
    // Remove security headers that might interfere with the Convex client.
    responseHeaders.delete("content-security-policy");
    responseHeaders.delete("x-frame-options");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
