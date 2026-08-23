export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bounded reachability probe for the approved CAPMA owner host, used to
// compare Vercel-egress connectivity against Convex-egress connectivity
// during connect-timeout windows. It fetches exactly one fixed owner URL,
// returns headers and timing only, and never proxies arbitrary targets.
const PROBE_URL = "http://capma.mx/banco/pista05.jpg";

export async function GET(request) {
  const expected = process.env.CAPMA_PROBE_TOKEN;
  if (expected) {
    const token = request.headers.get("x-capma-probe-token");
    if (token !== expected) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(PROBE_URL, {
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "polypro-mmmx-weather/1.0 (egress probe)" },
    });
    // Drain and discard; only reachability and headers matter here.
    await response.arrayBuffer();
    return Response.json({
      ok: true,
      status: response.status,
      ms: Date.now() - startedAt,
      lastModified: response.headers.get("last-modified"),
      etag: response.headers.get("etag"),
      probedAt: new Date(startedAt).toISOString(),
    });
  } catch (error) {
    return Response.json({
      ok: false,
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      probedAt: new Date(startedAt).toISOString(),
    });
  } finally {
    clearTimeout(timer);
  }
}
