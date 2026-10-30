import { formatLoopTime, isLiveLoopDate } from "./satelliteLoopState.js";

export const GOCI2_STALE_AFTER_MS = 80 * 60 * 1000;
export const GOCI2_RETENTION_MS = 24 * 60 * 60 * 1000;
export const GOCI2_MAX_FRAMES = 12;

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
});
function usableUrl(url) {
  return typeof url === "string" && (/^https?:\/\//.test(url) || /^data:image\/png;base64,/.test(url) || /^\/(?!\/)/.test(url));
}

/** Today's hourly GOCI-II images in KST, oldest first. Nothing is returned
 * unless the server reports approval, whatever else the payload contains. */
export function goci2DayFrames(data, now, { date, isToday = true } = {}) {
  if (!isLiveLoopDate(date, now, isToday) || data?.approved !== true || data.stationIcao !== "RKSI") return [];
  const day = date ?? dateFormat.format(now), slots = new Map();
  for (const frame of data.frames ?? []) {
    const time = frame?.obsTimeUtc;
    if (!Number.isFinite(time) || time > now || time < now - GOCI2_RETENTION_MS || dateFormat.format(time) !== day
      || !usableUrl(frame.url)) continue;
    const nominal = Number.isFinite(frame.nominalTimeUtc) ? frame.nominalTimeUtc : time;
    const existing = slots.get(nominal);
    if (!existing || (frame.capturedAt ?? 0) > (existing.capturedAt ?? 0)) {
      slots.set(nominal, { ...frame, time, key: `${frame.id ?? nominal}:${frame.url}` });
    }
  }
  return [...slots.values()].sort((a, b) => a.time - b.time).slice(-GOCI2_MAX_FRAMES);
}

/** Card state: what to say when no image is shown, and the status badge. */
export function describeGoci2(data, frames, now, { isLive }) {
  if (!Number.isFinite(now)) return { kind: "loading", badge: "Loading", title: "Loading…", detail: "" };
  if (!isLive) return { kind: "not_live", badge: "Today only", title: "Available on today’s dashboard",
    detail: "GOCI-II images are kept for the current day only." };
  if (data === undefined) return { kind: "loading", badge: "Loading", title: "Loading the latest hourly image…", detail: "" };
  if (data?.approved !== true) return { kind: "approval_required", badge: "Approval required", title: "GOCI-II approval required",
    detail: "Sharper hourly GOCI-II images of RKSI need KHOA permission for automated download, storage and display. Nothing is collected or shown until that permission is granted." };
  const latest = frames.at(-1), reason = typeof data.unavailableReason === "string" ? data.unavailableReason.trim() : "";
  if (latest) {
    const stale = now - latest.time > GOCI2_STALE_AFTER_MS && data.daylightWindowOpen === true;
    return { kind: reason ? "unavailable" : stale ? "stale" : "ready", badge: stale ? "Hourly image delayed" : "Hourly · daylight",
      title: "", detail: reason };
  }
  if (reason) return { kind: "unavailable", badge: "Unavailable", title: "Latest hourly image is unavailable", detail: reason };
  if (data.collector?.inFlight) return { kind: "collecting", badge: "Collecting", title: "Collecting the latest hourly image…",
    detail: "Images appear here when collection finishes." };
  if (data.daylightWindowOpen === false) return { kind: "outside_daylight", badge: "Daylight only", title: "GOCI-II images RKSI in daylight",
    detail: "Local-area observations are made about once an hour during the day. The first image appears after the morning observation." };
  if (data.collector?.status === "error") return { kind: "error", badge: "Collection failed", title: "The latest collection could not finish",
    detail: "Older images remain until they expire. Try refresh." };
  return { kind: "no_data", badge: "Hourly · daylight", title: "No GOCI-II image yet today",
    detail: "Images usually appear about 15 minutes after each hourly observation." };
}

/** Plain-language notes for the displayed frame. */
export function goci2FrameNotes(frame, now) {
  if (!frame) return [];
  const notes = [], spacing = frame.geometry?.nativePixelSpacingKm;
  if (Number.isFinite(spacing?.column) && Number.isFinite(spacing?.row)) {
    notes.push(`Native pixels ≈ ${spacing.column.toFixed(2)} × ${spacing.row.toFixed(2)} km at RKSI (Himawari visible ≈ 0.55 × 0.74 km). Zoom does not add detail beyond this.`);
  }
  if (frame.display?.lowSun === true) notes.push(`Low sun (${Math.round(frame.solarElevationDeg)}° elevation) dims colours and lengthens shadows.`);
  if (Number.isFinite(frame.display?.minimumGlintAngleDeg) && frame.display.minimumGlintAngleDeg < 25) {
    notes.push("Sun glint may brighten parts of the sea; bright water is not necessarily cloud.");
  }
  if (Number.isFinite(now) && now - frame.time > GOCI2_STALE_AFTER_MS) {
    notes.push(`This image was observed ${Math.floor((now - frame.time) / 60000)} minutes ago at ${formatLoopTime(frame.time)} KST.`);
  }
  return notes;
}

export function goci2RefreshMessage(status) {
  return { approval_required: "GOCI-II access is not approved.", outside_daylight: "GOCI-II images RKSI only in daylight.",
    waiting_for_next_observation: "The next hourly image is not due yet.", cooldown: "A check ran moments ago.",
    already_running: "A check is already in progress.", queued: "Checking for a new hourly image." }[status]
    ?? "Refresh checked. New images appear automatically when available.";
}
