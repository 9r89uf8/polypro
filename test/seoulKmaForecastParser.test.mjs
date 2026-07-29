import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseKmaAirportForecastHtml } from "../convex/seoulKmaForecastParser.js";

const fixtureUrl = new URL(
  "./fixtures/seoul-kma-airport-forecast.html",
  import.meta.url,
);

test("parses KMA/AMO daily highs and categorical hourly airport guidance", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const parsed = parseKmaAirportForecastHtml(html, {
    expectedStationIcao: "RKSI",
  });

  assert.equal(parsed.stationIcao, "RKSI");
  assert.equal(parsed.stationName, "INCHEON Int'l Airport");
  assert.equal(parsed.pageReportedAtLocal, "2026-07-30 02:30");
  assert.equal(parsed.pageReportedAt, Date.parse("2026-07-30T02:30:00+09:00"));
  assert.deepEqual(
    parsed.dailyRows.map(({ date, minTempC, maxTempC, forecastType }) => ({
      date,
      minTempC,
      maxTempC,
      forecastType,
    })),
    [
      {
        date: "2026-07-30",
        minTempC: 24,
        maxTempC: 30,
        forecastType: "short_term",
      },
      {
        date: "2026-08-06",
        minTempC: 26,
        maxTempC: 35,
        forecastType: "midterm",
      },
    ],
  );

  assert.equal(parsed.hourlyRows.length, 2);
  assert.deepEqual(
    {
      phrase: parsed.hourlyRows[0].phrase,
      conditionCode: parsed.hourlyRows[0].conditionCode,
      ceilingFt: parsed.hourlyRows[0].ceilingFt,
      visibilityM: parsed.hourlyRows[0].visibilityM,
      windDirectionDeg: parsed.hourlyRows[0].windDirectionDeg,
      windSpeedKt: parsed.hourlyRows[0].windSpeedKt,
    },
    {
      phrase: "Mostly cloudy",
      conditionCode: "mtph03",
      ceilingFt: 500,
      visibilityM: 6000,
      windDirectionDeg: 290,
      windSpeedKt: 6,
    },
  );
  assert.equal(parsed.hourlyRows[1].tempC, 30);
  assert.equal(parsed.hourlyRows[1].ceilingFt, 1000);
  assert.equal(parsed.hourlyRows[1].visibilityM, 10000);
  assert.equal(parsed.hourlyRows[1].windGustKt, 12);
});

test("fails closed when the server-rendered forecast structure disappears", () => {
  assert.throws(
    () => parseKmaAirportForecastHtml("<html><body>maintenance</body></html>"),
    /no daily min\/max rows/i,
  );
});

test("rejects a default or redirected airport page before it can be stored", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  assert.throws(
    () =>
      parseKmaAirportForecastHtml(html.replace(">RKSI<", ">RKSS<"), {
        expectedStationIcao: "RKSI",
      }),
    /provenance mismatch.*requested RKSI.*displayed RKSS/i,
  );
});
