const MEXICO_TIMEZONE = "America/Mexico_City";

export const POLYMARKET_MAX_CONTINUOUS_GAP_MS = 90 * 1000;

function localMinute(localValue) {
  const match = /(?:^|\s)(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    String(localValue ?? ""),
  );
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }
  return hour * 60 + minute + second / 60;
}

function mexicoMinuteForEpoch(epochMs) {
  const parts = {};
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MEXICO_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") {
      parts[part.type] = part.value;
    }
  }
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const millisecond = new Date(epochMs).getUTCMilliseconds();
  return [hour, minute, second, millisecond].every(Number.isFinite)
    ? hour * 60 + minute + (second + millisecond / 1000) / 60
    : null;
}

function mexicoDateForEpoch(epochMs) {
  const parts = {};
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MEXICO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") {
      parts[part.type] = part.value;
    }
  }
  return parts.year && parts.month && parts.day
    ? [parts.year, parts.month, parts.day].join("-")
    : null;
}

export function buildMetarReleaseMarkers(
  metarRows,
  date,
  minMinute = 0,
  maxMinute = 1440,
) {
  return [...(metarRows ?? [])]
    .map((row) => {
      const hasAwcReceipt = Number.isFinite(row?.initialAwcReceiptTimeUtc);
      const releaseAt = hasAwcReceipt
        ? row.initialAwcReceiptTimeUtc
        : row?.firstSeenAt;
      if (
        !Number.isFinite(releaseAt) ||
        mexicoDateForEpoch(releaseAt) !== date
      ) {
        return null;
      }
      const x = mexicoMinuteForEpoch(releaseAt);
      if (!Number.isFinite(x) || x < minMinute || x > maxMinute) {
        return null;
      }
      return {
        x,
        releaseAt,
        releaseSource: hasAwcReceipt ? "awcReceipt" : "firstSeen",
        reportType: row?.reportType === "SPECI" ? "SPECI" : "METAR",
        isCorrection: row?.isCorrection === true,
        reportKey: row?.reportKey ?? row?._id ?? String(releaseAt),
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        left.releaseAt - right.releaseAt ||
        String(left.reportKey).localeCompare(String(right.reportKey)),
    );
}

export function buildPolymarketChartPoints(snapshots, marketId) {
  const sortedSnapshots = [...(snapshots ?? [])]
    .filter((snapshot) => Number.isFinite(snapshot?.capturedAt))
    .sort((left, right) => left.capturedAt - right.capturedAt);
  const points = [];
  let previous = null;
  for (const snapshot of sortedSnapshots) {
    const parsedMinute = localMinute(snapshot.capturedAtLocal);
    const x = Number.isFinite(parsedMinute)
      ? parsedMinute
      : mexicoMinuteForEpoch(snapshot.capturedAt);
    if (!Number.isFinite(x)) {
      continue;
    }
    if (
      previous &&
      snapshot.capturedAt - previous.capturedAt >
        POLYMARKET_MAX_CONTINUOUS_GAP_MS
    ) {
      points.push({
        x: previous.x + (x - previous.x) / 2,
        y: null,
        sourceRole: "polymarketGap",
      });
    }
    const probability = (snapshot.probabilities ?? []).find(
      (candidate) => candidate.marketId === marketId,
    );
    points.push({
      ...(probability ?? {}),
      x,
      y: Number.isFinite(probability?.yesProbabilityPct)
        ? probability.yesProbabilityPct
        : null,
      capturedAt: snapshot.capturedAt,
      capturedAtLocal: snapshot.capturedAtLocal,
      sourceRole: probability ? "polymarket" : "polymarketGap",
    });
    previous = { x, capturedAt: snapshot.capturedAt };
  }
  return points;
}
