import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import test from "node:test";

import {
  capmaRelayConfigured,
  fetchCapmaFresh,
  fetchCapmaFreshWithRetries,
} from "../server/mexicoCapmaTransport.js";

function startServer(handler) {
  return new Promise((resolve) => {
    const sockets = new Set();
    const server = http.createServer(handler);
    server.on("connection", (socket) => sockets.add(socket));
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        sockets,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) {
              socket.destroy();
            }
            server.close(() => done());
          }),
      });
    });
  });
}

test("each request opens its own connection and closes it", async () => {
  const seen = [];
  const server = await startServer((request, response) => {
    seen.push(request.headers.connection ?? "");
    response.setHeader("Content-Type", "image/jpeg");
    response.end("ok");
  });
  try {
    const first = await fetchCapmaFresh(server.url, { timeoutMs: 3000 });
    const second = await fetchCapmaFresh(server.url, { timeoutMs: 3000 });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.bodyBuffer.toString(), "ok");
    // agent:false makes Node send Connection: close on every request, so the
    // legacy host never hands us back a half-dead pooled socket.
    assert.ok(
      seen.every((value) => value.toLowerCase() === "close"),
      seen,
    );
    assert.equal(server.sockets.size, 2);
  } finally {
    await server.close();
  }
});

test("a stalled response fails with a descriptive timeout error", async () => {
  const server = await startServer(() => {
    // Never respond.
  });
  try {
    await assert.rejects(
      fetchCapmaFresh(server.url, { timeoutMs: 300 }),
      /timed out after 300ms/,
    );
  } finally {
    await server.close();
  }
});

test("retries recover from a network failure and report attempts", async () => {
  let calls = 0;
  const server = await startServer((request, response) => {
    calls += 1;
    if (calls === 1) {
      request.socket.destroy();
      return;
    }
    response.end("recovered");
  });
  try {
    const { response, attemptsUsed } = await fetchCapmaFreshWithRetries(
      server.url,
      { timeoutMs: 2000, attempts: 3, retryDelayMs: 10, label: "test" },
    );
    assert.equal(response.bodyBuffer.toString(), "recovered");
    assert.equal(attemptsUsed, 2);
  } finally {
    await server.close();
  }
});

test("timeoutsMs gives each attempt its own escalating deadline", async () => {
  let calls = 0;
  const server = await startServer((request, response) => {
    calls += 1;
    if (calls === 1) {
      // Slow mode: only the patient second attempt can outlast this delay.
      setTimeout(() => response.end("slow"), 400);
      return;
    }
    setTimeout(() => response.end("slow"), 400);
  });
  try {
    const { response, attemptsUsed } = await fetchCapmaFreshWithRetries(
      server.url,
      { timeoutsMs: [100, 2000], retryDelayMs: 10, label: "test" },
    );
    assert.equal(response.bodyBuffer.toString(), "slow");
    assert.equal(attemptsUsed, 2);
  } finally {
    await server.close();
  }
});

test("an HTTP error status resolves without another attempt", async () => {
  let calls = 0;
  const server = await startServer((request, response) => {
    calls += 1;
    response.statusCode = 503;
    response.end("busy");
  });
  try {
    const { response, attemptsUsed } = await fetchCapmaFreshWithRetries(
      server.url,
      { timeoutMs: 2000, attempts: 3, retryDelayMs: 10, label: "test" },
    );
    assert.equal(response.status, 503);
    assert.equal(response.ok, false);
    assert.equal(attemptsUsed, 1);
    assert.equal(calls, 1);
  } finally {
    await server.close();
  }
});

test("exhausted retries surface the attempt count and last error", async () => {
  const server = await startServer((request) => {
    request.socket.destroy();
  });
  try {
    await assert.rejects(
      fetchCapmaFreshWithRetries(server.url, {
        timeoutMs: 2000,
        attempts: 2,
        retryDelayMs: 10,
        label: "CAPMA TDZ 05",
      }),
      /CAPMA TDZ 05 request failed after 2 attempt\(s\)/,
    );
  } finally {
    await server.close();
  }
});

test("oversized bodies are rejected instead of buffered", async () => {
  const server = await startServer((request, response) => {
    response.end(Buffer.alloc(64 * 1024, 65));
  });
  try {
    await assert.rejects(
      fetchCapmaFresh(server.url, { timeoutMs: 2000, maxBodyBytes: 1024 }),
      /exceeded 1024 bytes/,
    );
  } finally {
    await server.close();
  }
});

test("latin-1 pages decode according to their charset header", async () => {
  const server = await startServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=iso-8859-1");
    response.end(Buffer.from([0x4d, 0xe9, 0x78, 0x69, 0x63, 0x6f])); // "México"
  });
  try {
    const response = await fetchCapmaFresh(server.url, { timeoutMs: 2000 });
    assert.equal(response.text(), "México");
  } finally {
    await server.close();
  }
});

test("only plain-HTTP owner endpoints are accepted", async () => {
  await assert.rejects(
    fetchCapmaFresh("https://capma.mx/banco/pista05.jpg", { timeoutMs: 100 }),
    /only supports the approved plain-HTTP owner endpoints/,
  );
});

test("relay configuration requires both the URL and token", () => {
  assert.equal(capmaRelayConfigured({}), false);
  assert.equal(
    capmaRelayConfigured({ CAPMA_RELAY_URL: "https://relay" }),
    false,
  );
  assert.equal(
    capmaRelayConfigured({
      CAPMA_RELAY_URL: "https://relay",
      CAPMA_RELAY_TOKEN: "secret",
    }),
    true,
  );
});

test("the Vercel relay uses the same fresh bounded transport", async () => {
  const source = await readFile(
    new URL("../app/api/capma-relay/route.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /fetchCapmaFresh\(target/);
  assert.match(source, /const UPSTREAM_TIMEOUT_MS = 40_000;/);
  assert.match(source, /export const maxDuration = 60;/);
  assert.match(
    source,
    /"x-capma-relay-upstream-status": String\(upstream\.status\)/,
  );
  assert.match(source, /upstream\.status === 304 \? 200 : upstream\.status/);
  assert.doesNotMatch(source, /await fetch\(target/);
});

test("the relay fallback serves the response when every direct attempt fails", async () => {
  // "Direct" target drops every connection; the local "relay" answers with
  // the pass-through marker header the transport requires.
  const direct = await startServer((request) => request.socket.destroy());
  const relay = await startServer((request, response) => {
    if (request.headers["x-capma-relay-token"] !== "secret") {
      response.statusCode = 401;
      response.end("unauthorized");
      return;
    }
    response.setHeader("x-capma-relay-upstream", "1");
    response.setHeader("content-type", "image/jpeg");
    response.end("relayed-body");
  });
  try {
    const { response, transport, attemptsUsed } =
      await fetchCapmaFreshWithRetries(direct.url, {
        timeoutsMs: [500],
        retryDelayMs: 10,
        label: "CAPMA TDZ 05",
        allowRelayFallback: true,
        env: {
          CAPMA_RELAY_URL: relay.url,
          CAPMA_RELAY_TOKEN: "secret",
        },
      });
    assert.equal(transport, "vercel_relay");
    assert.equal(attemptsUsed, 2);
    assert.equal(response.bodyBuffer.toString(), "relayed-body");
  } finally {
    await direct.close();
    await relay.close();
  }
});

test("preferred relay avoids a known-unreliable direct path when it succeeds", async () => {
  let directCalls = 0;
  const direct = await startServer((request, response) => {
    directCalls += 1;
    response.end("direct-body");
  });
  const relay = await startServer((request, response) => {
    response.setHeader("x-capma-relay-upstream", "1");
    response.end("relayed-body");
  });
  try {
    const { response, transport, attemptsUsed } =
      await fetchCapmaFreshWithRetries(direct.url, {
        timeoutsMs: [1000],
        label: "CAPMA TDZ 05",
        allowRelayFallback: true,
        preferRelay: true,
        totalTimeoutMs: 2000,
        env: {
          CAPMA_RELAY_URL: relay.url,
          CAPMA_RELAY_TOKEN: "secret",
        },
      });
    assert.equal(response.bodyBuffer.toString(), "relayed-body");
    assert.equal(transport, "vercel_relay");
    assert.equal(attemptsUsed, 1);
    assert.equal(directCalls, 0);
  } finally {
    await direct.close();
    await relay.close();
  }
});

test("preferred relay maps its marked 200 envelope back to upstream 304", async () => {
  let directCalls = 0;
  const direct = await startServer((request, response) => {
    directCalls += 1;
    response.end("unexpected-direct-body");
  });
  const relay = await startServer((request, response) => {
    response.setHeader("x-capma-relay-upstream", "1");
    response.setHeader("x-capma-relay-upstream-status", "304");
    response.setHeader("etag", '"same-frame"');
    response.statusCode = 200;
    response.end();
  });
  try {
    const { response, transport, attemptsUsed } =
      await fetchCapmaFreshWithRetries(direct.url, {
        headers: { "If-None-Match": '"same-frame"' },
        timeoutsMs: [1000],
        label: "CAPMA TDZ 05",
        allowRelayFallback: true,
        preferRelay: true,
        totalTimeoutMs: 2000,
        env: {
          CAPMA_RELAY_URL: relay.url,
          CAPMA_RELAY_TOKEN: "secret",
        },
      });
    assert.equal(response.status, 304);
    assert.equal(response.ok, false);
    assert.equal(response.bodyBuffer.length, 0);
    assert.equal(response.headers.get("etag"), '"same-frame"');
    assert.equal(transport, "vercel_relay");
    assert.equal(attemptsUsed, 1);
    assert.equal(directCalls, 0);
  } finally {
    await direct.close();
    await relay.close();
  }
});

test("an unmarked relay status override cannot forge an upstream 304", async () => {
  const direct = await startServer((request) => request.socket.destroy());
  const relay = await startServer((request, response) => {
    response.setHeader("x-capma-relay-upstream-status", "304");
    response.statusCode = 200;
    response.end();
  });
  try {
    await assert.rejects(
      fetchCapmaFreshWithRetries(direct.url, {
        timeoutsMs: [300],
        label: "CAPMA TDZ 05",
        allowRelayFallback: true,
        preferRelay: true,
        totalTimeoutMs: 1000,
        env: { CAPMA_RELAY_URL: relay.url, CAPMA_RELAY_TOKEN: "secret" },
      }),
      /preferred relay \(relay failure \(200\)/,
    );
  } finally {
    await direct.close();
    await relay.close();
  }
});

test("preferred relay failure falls back to a fresh direct connection", async () => {
  let directCalls = 0;
  const direct = await startServer((request, response) => {
    directCalls += 1;
    response.end("direct-body");
  });
  const relay = await startServer((request) => request.socket.destroy());
  try {
    const { response, transport, attemptsUsed } =
      await fetchCapmaFreshWithRetries(direct.url, {
        timeoutsMs: [1000],
        label: "CAPMA TDZ 05",
        allowRelayFallback: true,
        preferRelay: true,
        totalTimeoutMs: 2000,
        env: {
          CAPMA_RELAY_URL: relay.url,
          CAPMA_RELAY_TOKEN: "secret",
        },
      });
    assert.equal(response.bodyBuffer.toString(), "direct-body");
    assert.equal(transport, "direct");
    assert.equal(attemptsUsed, 2);
    assert.equal(directCalls, 1);
  } finally {
    await direct.close();
    await relay.close();
  }
});

test("the total timeout clips a stalled direct attempt and suppresses late fallback", async () => {
  let relayCalls = 0;
  const direct = await startServer(() => {
    // Never respond; the shared wall-clock budget must end the request.
  });
  const relay = await startServer((request, response) => {
    relayCalls += 1;
    response.setHeader("x-capma-relay-upstream", "1");
    response.end("too-late");
  });
  const startedAt = Date.now();
  try {
    await assert.rejects(
      fetchCapmaFreshWithRetries(direct.url, {
        timeoutsMs: [2000],
        label: "CAPMA TDZ 05",
        allowRelayFallback: true,
        totalTimeoutMs: 200,
        env: {
          CAPMA_RELAY_URL: relay.url,
          CAPMA_RELAY_TOKEN: "secret",
        },
      }),
      /failed after 1 attempt\(s\)/,
    );
    assert.ok(Date.now() - startedAt < 1000);
    assert.equal(relayCalls, 0);
  } finally {
    await direct.close();
    await relay.close();
  }
});

test("a relay response without the upstream marker is a failure, not data", async () => {
  const direct = await startServer((request) => request.socket.destroy());
  const relay = await startServer((request, response) => {
    // Simulates a protection/login page or relay-level error body.
    response.statusCode = 200;
    response.end("<html>login</html>");
  });
  try {
    await assert.rejects(
      fetchCapmaFreshWithRetries(direct.url, {
        timeoutsMs: [300],
        retryDelayMs: 10,
        label: "CAPMA TDZ 05",
        allowRelayFallback: true,
        env: { CAPMA_RELAY_URL: relay.url, CAPMA_RELAY_TOKEN: "secret" },
      }),
      /relay fallback \(relay failure \(200\)/,
    );
  } finally {
    await direct.close();
    await relay.close();
  }
});

test("without relay configuration the direct-only error is unchanged", async () => {
  const direct = await startServer((request) => request.socket.destroy());
  try {
    await assert.rejects(
      fetchCapmaFreshWithRetries(direct.url, {
        timeoutsMs: [300],
        retryDelayMs: 10,
        label: "CAPMA TDZ 05",
        allowRelayFallback: true,
        env: {},
      }),
      /CAPMA TDZ 05 request failed after 1 attempt\(s\)/,
    );
  } finally {
    await direct.close();
  }
});
