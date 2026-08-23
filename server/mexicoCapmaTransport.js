import http from "node:http";

// Shared transport for the approved plain-HTTP CAPMA owner endpoints.
//
// This module lives outside convex/ on purpose: it uses Node builtins and is
// imported only by "use node" action files. Keeping it out of the convex
// directory stops the Convex isolate bundler from treating it as an entry
// point. Never import it from isolate-runtime Convex modules.
//
// Production evidence on 2026-08-23: warm Convex Node workers intermittently
// hit 8-second timeouts against capma.mx while a fresh single-connection
// fetch of the same URL from another network completed in about half a
// second. Pooled keep-alive sockets that the legacy host (or a middlebox)
// silently drops are the leading explanation, so every request here opens
// its own connection with `agent: false` (Node then sends
// `Connection: close`) and never reuses a socket. This changes transport
// reliability only: the exact approved URLs, cadences, redirect refusal,
// approval gates, and retention boundaries are unchanged.

const DEFAULT_MAX_BODY_BYTES = 2_000_000;

export function fetchCapmaFresh(url, options = {}) {
  const {
    headers = {},
    timeoutMs = 8_000,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  } = options;
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(new Error(`Invalid CAPMA URL: ${url}`));
      return;
    }
    if (target.protocol !== "http:") {
      reject(
        new Error(
          `The CAPMA fresh-connection transport only supports the approved plain-HTTP owner endpoints (got ${target.protocol}).`,
        ),
      );
      return;
    }
    let settled = false;
    let timer = null;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      callback(value);
    };
    const request = http.request(
      target,
      { method: "GET", agent: false, headers },
      (response) => {
        const chunks = [];
        let received = 0;
        response.on("data", (chunk) => {
          received += chunk.length;
          if (received > maxBodyBytes) {
            request.destroy();
            finish(
              reject,
              new Error(`response exceeded ${maxBodyBytes} bytes`),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const bodyBuffer = Buffer.concat(chunks);
          const status = response.statusCode ?? 0;
          finish(resolve, {
            status,
            ok: status >= 200 && status < 300,
            headers: {
              get(name) {
                const value = response.headers[String(name).toLowerCase()];
                if (value == null) {
                  return null;
                }
                return Array.isArray(value) ? value.join(", ") : String(value);
              },
            },
            bodyBuffer,
            text() {
              const contentType = String(
                response.headers["content-type"] ?? "",
              );
              const latin = /charset=\s*(iso-8859-1|latin1|windows-1252)/i.test(
                contentType,
              );
              return bodyBuffer.toString(latin ? "latin1" : "utf8");
            },
          });
        });
        response.on("error", (error) => finish(reject, error));
      },
    );
    timer = setTimeout(
      () => {
        request.destroy(new Error(`timed out after ${timeoutMs}ms`));
      },
      Math.max(1, timeoutMs),
    );
    request.on("error", (error) => finish(reject, error));
    request.end();
  });
}

// Optional alternate-egress path through the Vercel-hosted relay route.
// Production evidence (2026-08-23): Convex egress intermittently receives
// TCP connect timeouts to the owner host while Vercel egress connects in
// under a second in the same minute. When the three CAPMA_RELAY_* values are
// configured, callers can choose relay-first or direct-first ordering. Both
// orders make at most one relay request, fetch the same approved URL at the
// same cadence, and remain inside the caller's shared time budget. Approval
// gates remain enforced around the whole request. Absent configuration
// disables the path.
function relayConfig(env = process.env) {
  const url = env.CAPMA_RELAY_URL;
  const token = env.CAPMA_RELAY_TOKEN;
  if (!url || !token) {
    return null;
  }
  return {
    url,
    token,
    bypassSecret: env.CAPMA_RELAY_BYPASS || null,
  };
}

export function capmaRelayConfigured(env = process.env) {
  return relayConfig(env) !== null;
}

const RELAY_TIMEOUT_MS = 30_000;

export async function fetchCapmaViaRelay(targetUrl, options = {}) {
  const {
    headers = {},
    env = process.env,
    timeoutMs = RELAY_TIMEOUT_MS,
  } = options;
  const config = relayConfig(env);
  if (!config) {
    throw new Error("The CAPMA relay is not configured.");
  }
  const relayRequestHeaders = {
    "x-capma-relay-token": config.token,
    ...(config.bypassSecret
      ? { "x-vercel-protection-bypass": config.bypassSecret }
      : {}),
  };
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (["if-none-match", "if-modified-since", "accept"].includes(lower)) {
      relayRequestHeaders[lower] = value;
    }
  }
  const controller = new AbortController();
  const effectiveTimeoutMs = Math.max(1, Math.round(timeoutMs));
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  try {
    const response = await fetch(
      `${config.url}?url=${encodeURIComponent(targetUrl)}`,
      {
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
        headers: relayRequestHeaders,
      },
    );
    const bodyBuffer = Buffer.from(await response.arrayBuffer());
    if (response.headers.get("x-capma-relay-upstream") !== "1") {
      // Relay-level failure (auth, allowlist, upstream network error, or a
      // protection page) rather than an upstream CAPMA response.
      throw new Error(
        `relay failure (${response.status}): ${bodyBuffer.toString("utf8").slice(0, 160)}`,
      );
    }
    const upstreamStatusRaw = response.headers.get(
      "x-capma-relay-upstream-status",
    );
    let status = response.status;
    if (upstreamStatusRaw !== null) {
      const upstreamStatus = Number(upstreamStatusRaw);
      if (
        !Number.isInteger(upstreamStatus) ||
        upstreamStatus < 100 ||
        upstreamStatus > 599
      ) {
        throw new Error(
          `relay failure (${response.status}): invalid upstream status ${upstreamStatusRaw}`,
        );
      }
      status = upstreamStatus;
    }
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: {
        get(name) {
          return response.headers.get(String(name).toLowerCase());
        },
      },
      bodyBuffer,
      text() {
        const contentType = response.headers.get("content-type") ?? "";
        const latin = /charset=\s*(iso-8859-1|latin1|windows-1252)/i.test(
          contentType,
        );
        return bodyBuffer.toString(latin ? "latin1" : "utf8");
      },
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`relay timed out after ${effectiveTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Bounded per-cycle retries for network-level failures only. An HTTP error
// status resolves normally and is never retried here, so a failing origin is
// not hammered. `timeoutsMs` gives each attempt its own deadline: retained
// successful-fetch history for the TDZ JPEGs is bimodal (median 0.27 s but
// p95 9.5 s, p99 27.5 s, max 84 s — the origin intermittently serves at a
// few KB/s), so a quick first attempt catches the fast mode and a patient
// later attempt lets a slow-mode transfer finish instead of guillotining it.
// `totalTimeoutMs` bounds relay, delays, and direct attempts together; callers
// should set it below their scheduling interval when overlap is unsafe.
export async function fetchCapmaFreshWithRetries(url, options = {}) {
  const {
    attempts,
    timeoutsMs,
    timeoutMs = 8_000,
    retryDelayMs = 1_500,
    label = "CAPMA",
    allowRelayFallback = false,
    preferRelay = false,
    relayTimeoutMs = RELAY_TIMEOUT_MS,
    totalTimeoutMs,
    env = process.env,
    ...requestOptions
  } = options;
  const attemptTimeouts = Array.isArray(timeoutsMs)
    ? timeoutsMs
    : Array.from({ length: attempts ?? 1 }, () => timeoutMs);
  if (!attemptTimeouts.length) {
    throw new Error(`${label} retry plan has no attempts.`);
  }
  const deadline = Number.isFinite(totalTimeoutMs)
    ? Date.now() + Math.max(1, Math.round(totalTimeoutMs))
    : null;
  const remainingMs = () =>
    deadline === null ? Number.POSITIVE_INFINITY : deadline - Date.now();
  const boundedTimeout = (requestedMs) =>
    Math.max(1, Math.min(Math.max(1, requestedMs), remainingMs()));
  const relayAvailable = allowRelayFallback && capmaRelayConfigured(env);
  let lastError = null;
  let relayError = null;
  let requestsUsed = 0;

  const tryRelay = async () => {
    if (!relayAvailable || remainingMs() <= 0) {
      return null;
    }
    requestsUsed += 1;
    try {
      const response = await fetchCapmaViaRelay(url, {
        headers: requestOptions.headers ?? {},
        env,
        timeoutMs: boundedTimeout(relayTimeoutMs),
      });
      return {
        response,
        attemptsUsed: requestsUsed,
        transport: "vercel_relay",
      };
    } catch (error) {
      relayError = error instanceof Error ? error : new Error(String(error));
      return null;
    }
  };

  if (preferRelay) {
    const relayed = await tryRelay();
    if (relayed) {
      return relayed;
    }
  }

  let directAttemptsUsed = 0;
  for (let attempt = 1; attempt <= attemptTimeouts.length; attempt += 1) {
    if (remainingMs() <= 0) {
      break;
    }
    directAttemptsUsed += 1;
    requestsUsed += 1;
    try {
      const response = await fetchCapmaFresh(url, {
        ...requestOptions,
        timeoutMs: boundedTimeout(attemptTimeouts[attempt - 1]),
      });
      return { response, attemptsUsed: requestsUsed, transport: "direct" };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < attemptTimeouts.length && remainingMs() > 1) {
        const boundedDelayMs = Math.min(retryDelayMs, remainingMs() - 1);
        if (boundedDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, boundedDelayMs));
        }
      }
    }
  }

  if (!preferRelay) {
    const relayed = await tryRelay();
    if (relayed) {
      return relayed;
    }
    if (relayError) {
      throw new Error(
        `${label} request failed after ${directAttemptsUsed} direct attempt(s) (${lastError?.message ?? "total time budget exhausted"}) and the relay fallback (${relayError.message})`,
      );
    }
  }

  if (preferRelay && relayError) {
    throw new Error(
      `${label} request failed through the preferred relay (${relayError.message}) and after ${directAttemptsUsed} direct attempt(s): ${lastError?.message ?? "total time budget exhausted"}`,
    );
  }
  throw new Error(
    `${label} request failed after ${directAttemptsUsed} attempt(s): ${lastError?.message ?? "total time budget exhausted"}`,
  );
}
