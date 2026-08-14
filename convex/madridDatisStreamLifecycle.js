export const MADRID_DATIS_STREAM_SESSION_MS = 8.5 * 60 * 1000;
export const MADRID_DATIS_STREAM_LEASE_MS = 9.5 * 60 * 1000;
export const MADRID_DATIS_STREAM_HEARTBEAT_CHECK_MS = 5 * 1000;
export const MADRID_DATIS_STREAM_HEARTBEAT_STORE_MS = 45 * 1000;
export const MADRID_DATIS_STREAM_STALE_MS = 90 * 1000;

const BASE_BACKOFF_MS = 5 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

export function isMadridDatisStreamLeaseActive(status, nowMs) {
  return Boolean(
    status?.generation &&
      Number.isFinite(status?.leaseUntil) &&
      status.leaseUntil > nowMs,
  );
}

export function buildMadridDatisStreamGeneration(
  stationIcao,
  nowMs,
  attemptCount,
) {
  return `${stationIcao}:${Math.trunc(nowMs)}:${Math.trunc(attemptCount)}`;
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value ?? "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getMadridDatisStreamBackoffMs(
  consecutiveFailures,
  generation,
) {
  const failures = Math.max(1, Math.trunc(consecutiveFailures || 1));
  const exponential = Math.min(
    MAX_BACKOFF_MS,
    BASE_BACKOFF_MS * 2 ** Math.min(failures - 1, 6),
  );
  const jitterUnit = (hashText(generation) % 2001) / 10000 - 0.1;
  return Math.max(
    BASE_BACKOFF_MS,
    Math.round(exponential * (1 + jitterUnit)),
  );
}

export function isMadridDatisStreamHeartbeatStale(status, nowMs) {
  return Boolean(
    status?.status === "listening" &&
      Number.isFinite(status?.lastHeartbeatAt) &&
      nowMs - status.lastHeartbeatAt > MADRID_DATIS_STREAM_STALE_MS,
  );
}
