import { fetchCapmaFresh } from "../../../server/mexicoCapmaTransport.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Alternate-egress relay for the approved CAPMA owner endpoints.
//
// Production evidence (2026-08-23 12:13Z window): Convex egress received TCP
// connect timeouts to capma.mx while Vercel egress and residential fetches
// connected in well under a second. This relay lets the Convex collectors
// fall back to Vercel's network path for the SAME approved URLs at the SAME
// cadence. It is a dumb pipe: exact-URL allowlist (never an open proxy),
// shared-secret header on top of Vercel deployment protection, conditional
// headers passed through, no retention and no content logging. Approval
// gates remain enforced in Convex around every call.
const ALLOWED_URLS = new Set([
  "http://capma.mx/banco/pista05.jpg",
  "http://capma.mx/banco/pista23.JPG",
  "http://capma.mx/reportemetar/buscar_samx.php?id=MMMX",
]);
const UPSTREAM_TIMEOUT_MS = 40_000;
const MAX_UPSTREAM_BYTES = 2_000_000;

export async function GET(request) {
  const expected = process.env.CAPMA_RELAY_TOKEN;
  if (!expected) {
    // Fail closed until the operator configures the shared secret.
    return Response.json({ error: "relay_disabled" }, { status: 503 });
  }
  if (request.headers.get("x-capma-relay-token") !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const target = new URL(request.url).searchParams.get("url") ?? "";
  if (!ALLOWED_URLS.has(target)) {
    return Response.json({ error: "url_not_allowed" }, { status: 400 });
  }

  const upstreamHeaders = {
    "User-Agent":
      "polypro-mmmx-weather/1.0 (approved CAPMA collector via relay)",
  };
  for (const name of ["if-none-match", "if-modified-since", "accept"]) {
    const value = request.headers.get(name);
    if (value) {
      upstreamHeaders[name] = value;
    }
  }

  const startedAt = Date.now();
  try {
    // Use the same one-request/one-socket transport as Convex. The legacy
    // origin intermittently leaves pooled keep-alive sockets unusable, so the
    // alternate egress must not reintroduce connection reuse.
    const upstream = await fetchCapmaFresh(target, {
      headers: upstreamHeaders,
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      maxBodyBytes: MAX_UPSTREAM_BYTES,
    });
    const body = upstream.bodyBuffer;
    const headers = new Headers({
      "Cache-Control": "no-store",
      "x-capma-relay-upstream": "1",
      "x-capma-relay-upstream-status": String(upstream.status),
      "x-capma-relay-ms": String(Date.now() - startedAt),
    });
    for (const name of ["content-type", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) {
        headers.set(name, value);
      }
    }
    // Some platform layers strip custom response headers from a wire-level
    // 304. Keep the relay envelope as an ordinary 200 and carry the exact
    // owner status in the authenticated/marked envelope instead. The Convex
    // transport maps it back to 304 only after validating the relay marker.
    const relayStatus = upstream.status === 304 ? 200 : upstream.status;
    return new Response(body.length ? body : null, {
      status: relayStatus,
      headers,
    });
  } catch (error) {
    return Response.json(
      {
        error: "upstream_failure",
        message: error instanceof Error ? error.message : String(error),
        ms: Date.now() - startedAt,
      },
      { status: 502 },
    );
  }
}
