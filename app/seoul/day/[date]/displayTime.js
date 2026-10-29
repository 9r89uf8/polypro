const seoulTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit", hour12: true,
});
const seoulClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
});

export function formatSeoulTime(time, { seconds = false } = {}) {
  if (typeof time !== "number" || !Number.isFinite(time)) return "—";
  return (seconds ? seoulClock : seoulTime).format(time);
}

export function formatDayMinute(minute, { compact = false, nextDay = false } = {}) {
  if (typeof minute !== "number" || !Number.isFinite(minute)) return "—";
  const rounded = Math.max(0, Math.min(1440, Math.round(minute)));
  const withinDay = rounded % 1440;
  const hour = Math.floor(withinDay / 60);
  const minutes = withinDay % 60;
  const suffix = hour < 12 ? "AM" : "PM";
  const value = (hour % 12 || 12) + (compact && minutes === 0 ? "" : ":" + String(minutes).padStart(2, "0"));
  return value + " " + suffix + (nextDay && rounded === 1440 ? " next day" : "");
}
