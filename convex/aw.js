const BASE = "https://dataservice.accuweather.com";
//convex/aw.js
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

export function buildAwUrl(path, params = {}) {
    const u = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null) continue;
        u.searchParams.set(k, String(v));
    }
    return u.toString();
}

export async function awFetchJson(path, params, opts = {}) {
    const { maxRetries = 2 } = opts;
    const apiKey = process.env.ACCUWEATHER_API_KEY;
    if (!apiKey) throw new Error("Missing ACCUWEATHER_API_KEY in Convex env vars.");

    const url = buildAwUrl(path, params);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });

        if (res.status === 429 && attempt < maxRetries) {
            // If Retry-After exists, honor it; otherwise exponential-ish backoff.
            const ra = res.headers.get("Retry-After");
            const waitMs = ra ? Number(ra) * 1000 : (500 * Math.pow(2, attempt));
            await sleep(Math.min(waitMs, 4000));
            continue;
        }

        const text = await res.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            // keep json null
        }

        if (!res.ok) {
            throw new Error(
                `AccuWeather error ${res.status} on ${path}: ${text.slice(0, 400)}`
            );
        }

        return json;
    }

    throw new Error(`AccuWeather error 429 on ${path}: retries exhausted`);
}