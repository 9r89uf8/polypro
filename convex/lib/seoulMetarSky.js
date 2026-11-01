// Observed sky from a routine RKSI METAR, in eighths of the sky (oktas). The
// rules match the day page's cloud card (app/seoul/day/[date]/dashboardData.js):
// several layers bound the union instead of adding up, and CAVOK, NSC, NCD,
// CLR and vertical visibility say nothing about total cover, so they stay
// unknown rather than being read as clear.
const CLOUD_AMOUNTS = {
  FEW: { min: 1, max: 2, label: "Few clouds" },
  SCT: { min: 3, max: 4, label: "Scattered clouds" },
  BKN: { min: 5, max: 7, label: "Broken clouds" },
  OVC: { min: 8, max: 8, label: "Overcast" },
};

function observedTokens(rawMetar) {
  const tokens = String(rawMetar ?? "").trim().toUpperCase().replace(/=\s*$/, "").split(/\s+/).filter(Boolean);
  const stop = tokens.findIndex((token) => /^(?:M?\d{2}|\/\/)\/(?:M?\d{2}|\/\/)$/.test(token) ||
    /^(?:Q|A)\d{4}$/.test(token) || /^(?:NOSIG|BECMG|TEMPO|INTER|RMK)$/.test(token) || /^FM\d{6}$/.test(token) || /^PROB\d{2}$/.test(token));
  return stop < 0 ? tokens : tokens.slice(0, stop);
}

/** { code, label, minOktas, maxOktas }; the oktas are null when the report does not quantify total cover. */
export function metarSky(rawMetar) {
  const tokens = observedTokens(rawMetar);
  const unknown = (code, label) => ({ code, label, minOktas: null, maxOktas: null });
  if (tokens.some((token) => /^VV(?:\d{3}|\/\/\/)$/.test(token))) return unknown("VV", "Sky obscured");
  if (tokens.includes("CAVOK")) return unknown("CAVOK", "No significant cloud");
  if (tokens.includes("NSC")) return unknown("NSC", "No significant cloud");
  if (tokens.includes("NCD")) return unknown("NCD", "No cloud detected");
  if (tokens.includes("CLR")) return unknown("CLR", "No cloud detected");
  const layers = tokens.map((token) => /^(FEW|SCT|BKN|OVC)(\d{3}|\/\/\/)(?:CB|TCU)?$/.exec(token))
    .filter(Boolean).map((match) => ({ ...CLOUD_AMOUNTS[match[1]], token: match[0] }));
  if (layers.length) {
    const primary = layers.reduce((best, layer) => (layer.min > best.min ? layer : best));
    return {
      code: layers.map((layer) => layer.token).join(" "), label: primary.label,
      minOktas: Math.max(...layers.map((layer) => layer.min)),
      maxOktas: Math.min(8, layers.reduce((total, layer) => total + layer.max, 0)),
    };
  }
  if (tokens.includes("SKC")) return { code: "SKC", label: "Clear sky", minOktas: 0, maxOktas: 0 };
  return unknown("", "Cloud cover not reported");
}
