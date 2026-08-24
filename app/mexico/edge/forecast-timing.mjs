const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export const FORECAST_SOURCE_TAF = "taf";
export const FORECAST_SOURCE_SMN = "smn";

const SMN_VENUSTIANO_CONTROLLER_URL =
  "https://smn.conagua.gob.mx/tools/PHP/pronostico_municipios_grafico/controlador";

const TAF_CHECK_MINUTES = [1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56];
const SMN_CHECK_MINUTES = [20];

export function nextAutomaticForecastCheck(source, nowMs) {
  if (!Number.isFinite(nowMs)) {
    return null;
  }
  const minutes =
    source === FORECAST_SOURCE_TAF
      ? TAF_CHECK_MINUTES
      : source === FORECAST_SOURCE_SMN
        ? SMN_CHECK_MINUTES
        : null;
  if (!minutes) {
    return null;
  }
  const currentHour = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  for (let hourOffset = 0; hourOffset <= 1; hourOffset += 1) {
    for (const minute of minutes) {
      const candidate = currentHour + hourOffset * HOUR_MS + minute * MINUTE_MS;
      if (candidate > nowMs) {
        return candidate;
      }
    }
  }
  return null;
}

export function nextDayTafAvailabilityWindow(tomorrowStartsAt) {
  if (!Number.isFinite(tomorrowStartsAt)) {
    return { startAt: null, endAt: null };
  }
  return {
    // The next-calendar-day TX has recently arrived in the 00Z TAF issued
    // between roughly 17:00 and 18:00 Mexico City time the preceding day.
    startAt: tomorrowStartsAt - 7 * HOUR_MS,
    endAt: tomorrowStartsAt - 6 * HOUR_MS,
  };
}

export function formatForecastClock(epochMs, timeZone = "America/Mexico_City") {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(epochMs));
}

function smnCacheSuffix(cacheAt) {
  if (!Number.isFinite(cacheAt)) {
    return "";
  }
  return `&kche=${Math.floor(cacheAt / MINUTE_MS)}`;
}

export function smnVenustianoHourlyForecastUrl(date, cacheAt) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
    return null;
  }
  return (
    `${SMN_VENUSTIANO_CONTROLLER_URL}/leeJsonHorario.php` +
    `?edo=9&mun=17&fechayhora=${date.replaceAll("-", "")}` +
    smnCacheSuffix(cacheAt)
  );
}

export function smnVenustianoDailyForecastUrl(cacheAt) {
  return (
    `${SMN_VENUSTIANO_CONTROLLER_URL}/getDataJson2String.php?edo=9&mun=17` +
    smnCacheSuffix(cacheAt)
  );
}
