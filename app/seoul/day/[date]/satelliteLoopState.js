export const LOOP_WINDOW_MS = 60 * 60 * 1000;
export const FRAME_CADENCE_MS = 150 * 1000;
export const STALE_AFTER_MS = 12 * 60 * 1000;
export const MAX_CHANNEL_FRAMES = 32;

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
});
const clockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
});
const readableDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul", month: "short", day: "numeric", year: "numeric",
});

export function isLiveLoopDate(date, now, isToday = true) {
  return isToday === true && Number.isFinite(now)
    && (date === undefined || date === null || date === dateFormat.format(now));
}

export function formatLoopTime(time) {
  return Number.isFinite(time) ? clockFormat.format(time) : "—";
}

export function formatLoopDate(time) {
  return Number.isFinite(time) ? readableDate.format(time) : "—";
}

function usableUrl(url) {
  return typeof url === "string" && (/^https?:\/\//.test(url)
    || /^data:image\/(?:png|jpeg|webp);base64,/.test(url) || /^\/(?!\/)/.test(url));
}

export function recentLoopFrames(data, channel, now, { date, isToday = true } = {}) {
  if (!isLiveLoopDate(date, now, isToday) || data?.enabled !== true
    || data.stationIcao !== "RKSI" || !["visible", "infrared"].includes(channel)) return [];
  const slots = new Map();
  for (const frame of data.frames ?? []) {
    const time = Number.isFinite(frame?.obsTimeUtc) ? frame.obsTimeUtc : frame?.observedAt;
    if (frame?.channel !== channel || !Number.isFinite(time)
      || time < now - LOOP_WINDOW_MS || time > now || !usableUrl(frame.url)) continue;
    const nominalTime = Number.isFinite(frame.nominalTimeUtc) ? frame.nominalTimeUtc : time;
    const normalized = { ...frame, time, nominalTime, key: `${channel}:${frame.id ?? nominalTime}:${frame.url}` };
    const existing = slots.get(nominalTime);
    if (!existing || (frame.capturedAt ?? 0) > (existing.capturedAt ?? 0)) slots.set(nominalTime, normalized);
  }
  return [...slots.values()].sort((a, b) => a.time - b.time).slice(-MAX_CHANNEL_FRAMES);
}

export function missingLoopSlots(frames) {
  return frames.slice(1).reduce((total, frame, index) => total
    + Math.max(0, Math.round((frame.nominalTime - frames[index].nominalTime) / FRAME_CADENCE_MS) - 1), 0);
}

export function resolveLoopDisplay(frames, status, selectedKey, heldKey) {
  const desired = frames.find((frame) => frame.key === selectedKey) ?? frames.at(-1) ?? null;
  const loaded = frames.filter((frame) => status[frame.key] === "loaded");
  const displayed = desired && status[desired.key] === "loaded" ? desired
    : loaded.find((frame) => frame.key === heldKey) ?? loaded.at(-1) ?? null;
  return { desired, displayed, loaded,
    pending: Boolean(desired && !["loaded", "failed"].includes(status[desired.key])),
    failed: Boolean(desired && status[desired.key] === "failed") };
}

export function nextLoopFrame(loaded, displayedKey, speed = 1) {
  if (loaded.length < 2) return null;
  const index = loaded.findIndex((frame) => frame.key === displayedKey);
  const atEnd = index === loaded.length - 1;
  const rate = [0.5, 1, 2].includes(speed) ? speed : 1;
  return { frame: loaded[atEnd ? 0 : Math.max(0, index + 1)], delayMs: (atEnd ? 1800 : 700) / rate };
}

/** Bounded image decoding pool. Every request settles or times out; no retries
 * happen unless the user explicitly calls retryFailed(). destroy() detaches
 * callbacks and cancels timers/network image loads on unmount or channel switch. */
export function createLoopImagePool({ createImage, onChange, timeoutMs = 10000, concurrency = 2,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  const records = new Map();
  const requestLimit = Math.max(1, Math.min(2, Math.trunc(concurrency) || 2));
  let order = [], active = 0, closed = false, pumping = false;
  const snapshot = () => Object.fromEntries([...records].map(([key, item]) => [key, item.status]));
  const notify = () => { if (!closed) onChange(snapshot()); };
  const detach = (item, abort = false) => {
    if (item.timer !== undefined) clearTimer(item.timer);
    item.timer = undefined;
    if (item.image) {
      item.image.onload = null;
      item.image.onerror = null;
      if (abort) item.image.src = "";
    }
    if (item.status === "loading") active -= 1;
  };
  const finish = (item, result) => {
    if (closed || records.get(item.key) !== item || item.status !== "loading") return;
    detach(item, result === "failed");
    item.status = result;
    notify();
    pump();
  };
  const pump = () => {
    if (closed || pumping) return;
    pumping = true;
    for (const key of order) {
      if (active >= requestLimit) break;
      const item = records.get(key);
      if (!item || item.status !== "idle") continue;
      item.status = "loading";
      active += 1;
      try {
        item.image = createImage();
        item.image.decoding = "async";
        item.image.onload = () => {
          const ready = () => finish(item, "loaded");
          if (typeof item.image.decode === "function") item.image.decode().then(ready, () => finish(item, "failed"));
          else ready();
        };
        item.image.onerror = () => finish(item, "failed");
        item.timer = setTimer(() => finish(item, "failed"), timeoutMs);
        item.image.src = item.url;
      } catch {
        finish(item, "failed");
      }
    }
    pumping = false;
    notify();
  };
  return {
    setFrames(frames) {
      if (closed) return;
      const wanted = [...frames].slice(-MAX_CHANNEL_FRAMES).reverse();
      const keys = new Set(wanted.map((frame) => frame.key));
      for (const [key, item] of records) if (!keys.has(key)) {
        detach(item, true);
        records.delete(key);
      }
      for (const frame of wanted) if (!records.has(frame.key)) records.set(frame.key,
        { key: frame.key, url: frame.url, status: "idle", image: null });
      order = wanted.map((frame) => frame.key);
      pump();
    },
    prioritize(key) {
      if (!records.has(key)) return;
      order = [key, ...order.filter((value) => value !== key)];
      pump();
    },
    retryFailed() {
      if (closed) return;
      for (const item of records.values()) if (item.status === "failed") item.status = "idle";
      pump();
    },
    markFailed(key) {
      const item = records.get(key);
      if (!item || closed || item.status === "failed") return;
      detach(item, true);
      item.status = "failed";
      notify();
      pump();
    },
    destroy() {
      closed = true;
      for (const item of records.values()) detach(item, true);
      records.clear();
      order = [];
    },
  };
}
