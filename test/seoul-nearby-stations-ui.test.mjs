import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AIRPORT_STALE_MS, MAP_SPAN_KM, RUNWAYS, STATION_STALE_MS, ageLabel, buildNearbyState, compassPoint, describeWind, mapOffset, runwayMiddle } from "../app/seoul/day/[date]/nearbyStationsState.js";

const MINUTE = 60_000, NOW = Date.parse("2026-11-02T12:31:30+09:00");
const LIVE = { isToday: true };
const station = (id, name, elevationM, distanceKm, bearingDeg, reading = null) => ({ id, name, nameKo: name, elevationM, distanceKm, bearingDeg, reading });
// Synthetic readings.
const dashboard = (fields = {}) => ({
  status: "ok", approved: true, configured: true, collector: { status: "ok", lastAttemptAt: NOW - MINUTE, lastSuccessAt: NOW - MINUTE, errorCode: null },
  airport: { icao: "RKSI", name: "Incheon Airport", elevationM: 7, reference: { rwyDir: "15L", obsTimeUtc: NOW - MINUTE, tempC: 13.8, windDirDeg: 310, windSpeedKt: 9.2 }, comparison: { rwyDir: "16L", obsTimeUtc: NOW - MINUTE, tempC: 13.2, windDirDeg: 300, windSpeedKt: 8 } },
  stations: [
    station(508, "Wangsan", 141, 7.1, 276, { obsTimeUtc: NOW - 2 * MINUTE, tempC: 12.4, windDirDeg: 315, windSpeedMs: 5.2 }),
    station(665, "Muui-do", 28, 7.9, 190, { obsTimeUtc: NOW - 25 * MINUTE, tempC: 13.1, windDirDeg: 300, windSpeedMs: 3 }),
    station(543, "Yeongjong-do", 26, 10.5, 66, null),
    station(577, "Jangbong-do", 9, 12.3, 312, { obsTimeUtc: NOW - MINUTE, windDirDeg: 0, windSpeedMs: 0 }),
  ],
  ...fields,
});
const named = (state, name) => state.stations.find((row) => row.name === name);

test("the arrow points where the air is going and the text names where it comes from", () => {
  const wind = describeWind({ dirDeg: 315, speedMs: 5.2 });
  assert.equal(wind.arrowDeg, 135);
  assert.equal(wind.short, "from NW 10 kt");
  assert.equal(wind.detail, "from NW (315°) · 10 kt (5.2 m/s)");
  assert.equal(describeWind({ dirDeg: 310, speedKt: 9.2 }).short, "from NW 9 kt");
  assert.equal(describeWind({ dirDeg: 360, speedKt: 4 }).arrowDeg, 180);
  assert.equal(describeWind({ dirDeg: 360, speedKt: 4 }).short, "from N 4 kt");
  assert.equal(describeWind({ dirDeg: 90, speedMs: 0.1 }).short, "from E under 1 kt");
  assert.equal(compassPoint(359), "N");
});

test("calm and missing wind never draw a direction", () => {
  for (const reading of [{ dirDeg: 53.7, speedMs: 0 }, { dirDeg: 0, speedKt: 0 }]) assert.deepEqual([describeWind(reading).kind, describeWind(reading).arrowDeg, describeWind(reading).short], ["calm", null, "Calm"]);
  assert.deepEqual([describeWind({}).kind, describeWind({}).arrowDeg, describeWind({}).short], ["missing", null, "Wind not reported"]);
  assert.deepEqual([describeWind({ speedMs: 3 }).kind, describeWind({ speedMs: 3 }).arrowDeg], ["speed_only", null]);
  assert.match(describeWind({ speedMs: 3 }).detail, /direction not reported/);
  assert.match(describeWind({ dirDeg: 90 }).detail, /speed not reported/);
  assert.equal(describeWind({ dirDeg: 90 }).arrowDeg, 270);
});

test("a compass-only source draws the arrow but claims no degrees", () => {
  const wind = describeWind({ dirDeg: 157.5, compass: "SSE", speedMs: 1.8 });
  assert.deepEqual([wind.kind, wind.arrowDeg, wind.short, wind.detail], ["wind", 337.5, "from SSE 3 kt", "from SSE · 3 kt (1.8 m/s)"]);
  assert.equal(describeWind({ dirDeg: 157.5, compass: "SSE" }).detail, "from SSE, speed not reported");
  assert.equal(describeWind({ dirDeg: 157.5, compass: "SSE", speedMs: 0 }).short, "Calm");
  const reading = { obsTimeUtc: NOW - MINUTE, tempC: 9.7, windDirDeg: 135, windDirCompass: "SE", windSpeedMs: 1.3 };
  const state = buildNearbyState(dashboard({ source: "kma_public_aws_page", stations: [station(543, "Yeongjong-do", 26, 10.5, 66, reading)] }), NOW, LIVE);
  assert.equal(state.usesPublicPage, true);
  assert.deepEqual([state.stations[0].temperature, state.stations[0].wind.detail], ["9.7°", "from SE · 3 kt (1.3 m/s)"]);
  assert.equal(buildNearbyState(dashboard(), NOW, LIVE).usesPublicPage, false);
});

test("stations sit at their true bearing on one scale", () => {
  const north = mapOffset({ distanceKm: MAP_SPAN_KM, bearingDeg: 0 });
  assert.ok(Math.abs(north.x) < 1e-9 && Math.abs(north.y + 1) < 1e-9);
  const east = mapOffset({ distanceKm: MAP_SPAN_KM / 2, bearingDeg: 90 });
  assert.ok(Math.abs(east.x - 0.5) < 1e-9 && Math.abs(east.y) < 1e-9);
  const state = buildNearbyState(dashboard(), NOW, LIVE);
  assert.ok(named(state, "Wangsan").offset.x < 0, "Wangsan is west");
  assert.ok(named(state, "Muui-do").offset.y > 0, "Muui-do is south");
  assert.ok(named(state, "Yeongjong-do").offset.x > 0 && named(state, "Yeongjong-do").offset.y < 0, "Yeongjong-do is north-east");
  assert.ok(named(state, "Jangbong-do").offset.x < 0 && named(state, "Jangbong-do").offset.y < 0, "Jangbong-do is north-west");
  for (const row of state.stations) assert.ok(Math.hypot(row.offset.x, row.offset.y) < 1);
  assert.equal(named(state, "Wangsan").directionLabel, "W");
  assert.equal(named(state, "Jangbong-do").directionLabel, "NW");
});

test("15L and 16L sit on their own runways at the AIP's positions", () => {
  const km = ({ x, y }) => [x * MAP_SPAN_KM, -y * MAP_SPAN_KM];
  const near = ([east, north], [wantEast, wantNorth]) => assert.ok(Math.abs(east - wantEast) < 0.02 && Math.abs(north - wantNorth) < 0.02, `${east}, ${north}`);
  near(km(RUNWAYS.reference.north), [-0.05, 2.64]);
  near(km(RUNWAYS.reference.south), [2.12, -0.42]);
  near(km(RUNWAYS.comparison.north), [-2.22, 1.40]);
  near(km(RUNWAYS.comparison.south), [0.09, -1.87]);
  const [eastKm, northKm] = km(runwayMiddle(RUNWAYS.reference)), [westKm, westNorthKm] = km(runwayMiddle(RUNWAYS.comparison));
  assert.ok(eastKm > westKm, "15L is the eastern runway");
  assert.ok(Math.abs(Math.hypot(eastKm - westKm, northKm - westNorthKm) - 2.49) < 0.02);
  const panel = readFileSync(new URL("../app/seoul/day/[date]/NearbyStations.js", import.meta.url), "utf8");
  assert.match(panel, /<RunwayReading runway=\{RUNWAYS\.reference\} reading=\{state\.airport\.reference\}/);
  assert.match(panel, /<RunwayReading runway=\{RUNWAYS\.comparison\} reading=\{state\.airport\.comparison\}/);
  assert.match(panel, /gives no exact position for either thermometer/);
});

test("stale and missing readings say so and no value is invented", () => {
  const state = buildNearbyState(dashboard(), NOW, LIVE);
  assert.deepEqual([state.kind, state.badge], ["ok", "Live"]);
  const fresh = named(state, "Wangsan");
  assert.deepEqual([fresh.state, fresh.temperature, fresh.ageLabel, fresh.timeLabel], ["fresh", "12.4°", "2 min ago", "12:29 PM"]);
  const stale = named(state, "Muui-do");
  assert.deepEqual([stale.state, stale.temperature, stale.ageLabel, stale.mapAgeLabel], ["stale", "13.1°", "Stale · 25 min ago", "Stale · 25 min"]);
  const missing = named(state, "Yeongjong-do");
  assert.deepEqual([missing.state, missing.temperature, missing.observedAt, missing.ageLabel, missing.wind.kind], ["missing", "—", null, "No reading", "missing"]);
  const noTemperature = named(state, "Jangbong-do");
  assert.deepEqual([noTemperature.state, noTemperature.temperature, noTemperature.tempC, noTemperature.wind.short], ["fresh", "—", null, "Calm"]);
  assert.equal(buildNearbyState(dashboard({ stations: [station(508, "Wangsan", 141, 7.1, 276, { obsTimeUtc: NOW - STATION_STALE_MS, tempC: 1 })] }), NOW, LIVE).stations[0].state, "fresh");
  assert.equal(buildNearbyState(dashboard({ stations: [station(508, "Wangsan", 141, 7.1, 276, { obsTimeUtc: NOW - STATION_STALE_MS - 1, tempC: 1 })] }), NOW, LIVE).stations[0].state, "stale");
  assert.equal(ageLabel(30_000), "Under 1 min ago");
  assert.equal(ageLabel(65 * MINUTE), "1 h 5 min ago");
});

test("the airport reads 15L and 16L as stored and goes stale on its own limit", () => {
  const { airport } = buildNearbyState(dashboard(), NOW, LIVE);
  assert.deepEqual([airport.reference.temperature, airport.comparison.temperature, airport.reference.wind.short], ["13.8°", "13.2°", "from NW 9 kt"]);
  const old = dashboard();
  old.airport.reference.obsTimeUtc = NOW - AIRPORT_STALE_MS - 1;
  const state = buildNearbyState(old, NOW, LIVE);
  assert.equal(state.airport.reference.state, "stale");
  assert.deepEqual([state.kind, state.badge], ["delayed", "Delayed"]);
  assert.match(state.message, /airport’s own reading is old/);
});

test("only Wangsan gets the height mark", () => {
  const state = buildNearbyState(dashboard(), NOW, LIVE);
  assert.equal(named(state, "Wangsan").heightNote, "134 m above RKSI");
  assert.deepEqual(state.tallStations.map((row) => row.name), ["Wangsan"]);
  assert.equal(named(state, "Muui-do").heightNote, null);
});

test("approval, setup, waiting and failure states are honest and keep the airport", () => {
  const empty = dashboard().stations.map((row) => ({ ...row, reading: null }));
  const approval = buildNearbyState(dashboard({ status: "approval_required", approved: false, configured: false, collector: null, stations: empty }), NOW, LIVE);
  assert.deepEqual([approval.kind, approval.badge, approval.withheld], ["approval_required", "Approval required", true]);
  assert.match(approval.message, /nothing new is requested from KMA/);
  assert.ok(approval.stations.every((row) => row.state === "missing" && row.temperature === "—"));
  assert.equal(approval.airport.reference.temperature, "13.8°");
  assert.equal(buildNearbyState(dashboard({ status: "setup_required", stations: empty, collector: null }), NOW, LIVE).badge, "Setup required");
  assert.equal(buildNearbyState(dashboard({ status: "building", stations: empty, collector: null }), NOW, LIVE).badge, "Waiting");
  assert.match(buildNearbyState(dashboard({ status: "building", stations: empty, collector: { status: "partial", lastAttemptAt: NOW - MINUTE } }), NOW, LIVE).message, /at 12:30 PM returned no station readings/);
  const failed = buildNearbyState(dashboard({ status: "error", collector: { status: "error", lastAttemptAt: NOW - MINUTE, errorCode: "api_not_applied" } }), NOW, LIVE);
  assert.equal(failed.badge, "Refresh failed");
  assert.match(failed.message, /at 12:30 PM failed: KMA says the key has no application for this API\. Readings below are the last stored ones\./);
  assert.equal(buildNearbyState(dashboard({ status: "partial" }), NOW, LIVE).badge, "Some missing");
  const allStale = dashboard({ stations: [station(508, "Wangsan", 141, 7.1, 276, { obsTimeUtc: NOW - 30 * MINUTE, tempC: 1 })] });
  assert.deepEqual([buildNearbyState(allStale, NOW, LIVE).kind, buildNearbyState(allStale, NOW, LIVE).badge], ["delayed", "Delayed"]);
  assert.equal(buildNearbyState(dashboard({ status: "surprise" }), NOW, LIVE).kind, "unavailable");
  assert.equal(buildNearbyState(null, NOW, LIVE).kind, "unavailable");
});

test("past and future dates say the panel is today only, and loading stays loading", () => {
  const past = buildNearbyState(undefined, NOW, { isToday: false, isPast: true });
  assert.deepEqual([past.kind, past.badge], ["not_live", "Today only"]);
  assert.match(past.message, /empty for past dates/);
  assert.match(buildNearbyState(undefined, NOW, { isToday: false }).message, /empty for future dates/);
  assert.equal(past.stations, undefined);
  assert.equal(buildNearbyState(undefined, NOW, LIVE).kind, "loading");
  assert.equal(buildNearbyState(undefined, null, { isToday: false }).kind, "loading");
});

test("the page subscribes on today only and says which way arrows point", () => {
  const page = readFileSync(new URL("../app/seoul/day/[date]/page.js", import.meta.url), "utf8");
  assert.match(page, /useQuery\("seoulNearbyStations:getDashboard", isToday \? \{ \.\.\.STATION, date \} : "skip"\)/);
  const panel = readFileSync(new URL("../app/seoul/day/[date]/NearbyStations.js", import.meta.url), "utf8");
  assert.match(panel, /Arrows show where the air is going/);
  assert.match(panel, /Korea Meteorological Administration/);
  assert.match(panel, /usesPublicPage \? "AWS readings on its public observation page/);
  assert.doesNotMatch(panel, /apihub\.kma\.go\.kr|authKey/);
});
