import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReactionIntervals,
  dedupeWeatherSourceEvents,
  firstNewDailyMaximumEvents,
  platformDisplayTransitions,
  reactionChartSeries,
  reactionRowMatchesContract,
  tdzDailySeriesStates,
} from "./reaction-metrics.mjs";

const COMPLETE_OFFICIAL_EVIDENCE = {
  status: "complete",
  truncated: false,
  metarTruncated: false,
  relayTruncated: false,
};

test("trade reaction uses a no-change heartbeat as the lower boundary", () => {
  const source = [{ id: "weather", at: 1_000 }];
  const rows = [
    { at: 900, lastTradePrice: "0.40", platformDisplayPrice: "0.50" },
    {
      at: 1_100,
      lastTradePrice: "0.40",
      platformDisplayPrice: "0.70",
      isHeartbeat: true,
    },
    { at: 1_300, lastTradePrice: "0.55", platformDisplayPrice: "0.70" },
  ];
  const [reaction] = buildReactionIntervals(source, rows, "trade");
  assert.equal(reaction.before.valuePct, 40);
  assert.equal(reaction.after.valuePct, 55);
  assert.equal(reaction.detectionStartAt, 1_100);
  assert.equal(reaction.detectionEndAt, 1_300);
  assert.equal(reaction.boundaryEvidence, "heartbeat_bounded");
});

test("trade reaction ignores browser ticks and platform-only changes", () => {
  const source = [{ id: "weather", at: 1_000 }];
  const rows = [
    { at: 900, lastTradePrice: "0.40", platformDisplayPrice: "0.40" },
    {
      at: 1_050,
      lastTradePrice: "0.70",
      platformDisplayPrice: "0.70",
      sessionOnly: true,
    },
    { at: 1_100, lastTradePrice: "0.40", platformDisplayPrice: "0.60" },
  ];
  const [reaction] = buildReactionIntervals(source, rows, "trade");
  assert.equal(reaction.intervalStatus, "waiting");
});

test("persisted detection bounds win over inferred poll boundaries", () => {
  const source = [{ id: "weather", at: 1_000 }];
  const rows = [
    { at: 900, lastTradePrice: "0.40" },
    {
      at: 1_300,
      lastTradePrice: "0.55",
      detectionStartAt: 1_080,
      detectionEndAt: 1_290,
      detectionIntervalKind: "bounded",
    },
  ];
  const [reaction] = buildReactionIntervals(source, rows, "trade");
  assert.equal(reaction.detectionStartAt, 1_080);
  assert.equal(reaction.detectionEndAt, 1_290);
  assert.equal(reaction.boundaryEvidence, "persisted_bounded");
});

test("a weather receipt inside a trade-detection bracket is indeterminate", () => {
  const source = [{ id: "weather", at: 1_200 }];
  const rows = [
    { at: 1_000, lastTradePrice: "0.40" },
    {
      at: 1_300,
      lastTradePrice: "0.55",
      detectionStartAt: 1_100,
      detectionEndAt: 1_300,
      detectionIntervalKind: "bounded",
    },
  ];
  const [reaction] = buildReactionIntervals(source, rows, "trade");
  assert.equal(reaction.ordering, "ordering_indeterminate");
  assert.equal(reaction.detectionStartDelayMs, -100);
  assert.equal(reaction.detectionEndDelayMs, 100);
});

test("pre-source trade evidence remains separate from the next compatible update", () => {
  const source = [{ id: "weather", at: 2_000 }];
  const rows = [
    { at: 1_000, lastTradePrice: "0.30" },
    { at: 1_200, lastTradePrice: "0.40" },
    { at: 2_100, lastTradePrice: "0.40", isHeartbeat: true },
    { at: 2_300, lastTradePrice: "0.50" },
  ];
  const [reaction] = buildReactionIntervals(source, rows, "trade");
  assert.equal(reaction.ordering, "compatible_after");
  assert.equal(reaction.priorTransition.after.valuePct, 40);
  assert.equal(reaction.after.valuePct, 50);
});

test("a left-unbounded transition is insufficient baseline, not overlap", () => {
  const source = [{ id: "weather", at: 1_200 }];
  const rows = [
    { at: 1_000, lastTradePrice: "0.40" },
    {
      at: 1_300,
      lastTradePrice: "0.55",
      detectionEndAt: 1_300,
      detectionIntervalKind: "left_unbounded",
    },
  ];
  const [reaction] = buildReactionIntervals(source, rows, "trade");
  assert.equal(reaction.ordering, "left_censored");
  assert.equal(reaction.detectionStartAt, null);
});

test("changed-only legacy rows never fabricate a successful-poll lower bound", () => {
  const source = [{ id: "weather", at: 1_100 }];
  const rows = [
    { at: 1_000, lastTradePrice: "0.40" },
    { at: 1_300, lastTradePrice: "0.55" },
  ];
  const [reaction] = buildReactionIntervals(source, rows, "trade");
  assert.equal(reaction.ordering, "left_censored");
  assert.equal(reaction.detectionStartAt, null);
  assert.equal(reaction.boundaryEvidence, "legacy_left_censored");
});

test("reaction intervals reset at a market contract rollover", () => {
  const [reaction] = buildReactionIntervals(
    [{ id: "weather", at: 1_150 }],
    [
      {
        at: 900,
        eventId: "old-event",
        marketId: "reused-market",
        yesTokenId: "old-token",
        lastTradePrice: "0.40",
        isHeartbeat: true,
      },
      {
        at: 1_000,
        eventId: "new-event",
        marketId: "reused-market",
        yesTokenId: "new-token",
        lastTradePrice: "0.50",
        isHeartbeat: true,
      },
      {
        at: 1_300,
        eventId: "new-event",
        marketId: "reused-market",
        yesTokenId: "new-token",
        lastTradePrice: "0.60",
        isHeartbeat: true,
      },
    ],
    "trade",
  );
  assert.equal(reaction.before.valuePct, 50);
  assert.equal(reaction.after.valuePct, 60);
  assert.equal(reaction.detectionStartAt, 1_000);
  assert.equal(reaction.detectionEndAt, 1_300);
});

test("selected history requires the current event and token identities", () => {
  const selected = {
    eventId: "new-event",
    marketId: "reused-market",
    yesTokenId: "new-token",
  };
  assert.equal(
    reactionRowMatchesContract(
      {
        eventId: "old-event",
        marketId: "reused-market",
        yesTokenId: "old-token",
      },
      selected,
    ),
    false,
  );
  assert.equal(
    reactionRowMatchesContract(
      {
        eventId: "new-event",
        marketId: "reused-market",
        yesTokenId: "new-token",
      },
      selected,
    ),
    true,
  );
  assert.equal(
    reactionRowMatchesContract(
      { marketId: "reused-market", yesTokenId: "new-token" },
      selected,
    ),
    false,
  );
});

test("no-trades heartbeats bound the first reported last-trade price", () => {
  const source = [{ id: "weather", at: 1_150 }];
  const rows = [
    {
      at: 1_000,
      lastTradeReceivedAt: 1_000,
      lastTradeStatus: "no_trades",
      isHeartbeat: true,
    },
    {
      at: 1_100,
      lastTradeReceivedAt: 1_100,
      lastTradeStatus: "no_trades",
      isHeartbeat: true,
    },
    {
      at: 1_300,
      lastTradeReceivedAt: 1_300,
      lastTradeStatus: "reported",
      lastTradePrice: "0.55",
      isHeartbeat: true,
    },
  ];
  const [reaction] = buildReactionIntervals(source, rows, "trade");
  assert.equal(reaction.before.noTrades, true);
  assert.equal(reaction.after.valuePct, 55);
  assert.equal(reaction.delta, null);
  assert.equal(reaction.detectionStartAt, 1_100);
  assert.equal(reaction.detectionEndAt, 1_300);
});

test("reported-to-no-trades regressions are ignored defensively", () => {
  const series = reactionChartSeries(
    [
      {
        at: 100,
        lastTradeStatus: "reported",
        lastTradePrice: "0.40",
      },
      { at: 200, lastTradeStatus: "no_trades" },
    ],
    "trade",
  );
  assert.equal(series[0].points.length, 1);
  assert.equal(series[0].points[0].probabilityPct, 40);
});

test("interval boundary classifications honor (L, U] exactly", () => {
  const rows = [
    { at: 900, lastTradePrice: "0.40" },
    {
      at: 1_300,
      lastTradePrice: "0.55",
      detectionStartAt: 1_100,
      detectionEndAt: 1_300,
      detectionIntervalKind: "bounded",
    },
  ];
  const [atLower, atUpper, afterUpper] = buildReactionIntervals(
    [
      { id: "at-lower", at: 1_100 },
      { id: "at-upper", at: 1_300 },
      { id: "after-upper", at: 1_301 },
    ],
    rows,
    "trade",
  ).reverse();
  assert.equal(atLower.ordering, "compatible_after");
  assert.equal(atUpper.ordering, "ordering_indeterminate");
  assert.equal(afterUpper.ordering, "no_compatible_update_observed");
  assert.equal(afterUpper.priorTransition.detectionEndAt, 1_300);
});

test("post-source rows without a pre-source baseline are not labeled waiting", () => {
  const [reaction] = buildReactionIntervals(
    [{ id: "weather", at: 1_000 }],
    [
      {
        at: 1_100,
        lastTradeStatus: "reported",
        lastTradePrice: "0.40",
        isHeartbeat: true,
      },
      {
        at: 1_200,
        lastTradeStatus: "reported",
        lastTradePrice: "0.40",
        isHeartbeat: true,
      },
    ],
    "trade",
  );
  assert.equal(reaction.intervalStatus, "baseline_unavailable");
  assert.equal(reaction.before, null);
});

test("all certified current-day source rows are returned without a silent cap", () => {
  const sourceEvents = Array.from({ length: 13 }, (_, index) => ({
    id: `weather-${index}`,
    at: 1_000 + index,
  }));
  assert.equal(buildReactionIntervals(sourceEvents, [], "trade").length, 13);
});

test("BBO exposes distinct executable bid and ask chart series", () => {
  const series = reactionChartSeries(
    [
      { at: 100, bestBidPrice: "0.30", bestAskPrice: "0.40" },
      { at: 200, bestBidPrice: "0.31", bestAskPrice: "0.42" },
    ],
    "bbo",
  );
  assert.deepEqual(
    series.map((item) => item.key),
    ["bbo_bid", "bbo_ask"],
  );
  assert.deepEqual(
    series.map((item) => item.points.at(-1).probabilityPct),
    [31, 42],
  );
});

test("platform source transitions are marked even when displayed price is flat", () => {
  const transitions = platformDisplayTransitions([
    {
      at: 100,
      platformDisplayPrice: "0.50",
      platformDisplaySource: "midpoint",
    },
    {
      at: 200,
      platformDisplayPrice: "0.50",
      platformDisplaySource: "last_trade",
    },
  ]);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].from, "midpoint");
  assert.equal(transitions[0].to, "last_trade");
});

test("weather rails dedupe and only strictly higher daily maxima survive", () => {
  const sourceEvents = [
    {
      id: "official-1",
      source: "capma_aftn",
      reportKey: "report-a",
      obsTimeUtc: 500,
      at: 600,
    },
    {
      id: "sighting-1",
      source: "capma_aftn",
      typelessHash: "hash-a",
      obsTimeUtc: 500,
      at: 600,
    },
    { id: "same", source: "capma_aftn", obsTimeUtc: 700, at: 800 },
    { id: "higher", source: "capma_aftn", obsTimeUtc: 900, at: 1_000 },
  ];
  const temperatures = [
    {
      kind: "official_report",
      reportKey: "report-a",
      obsTimeUtc: 500,
      tempC: 20,
    },
    { kind: "official_report", obsTimeUtc: 700, tempC: 20 },
    { kind: "official_report", obsTimeUtc: 900, tempC: 21 },
  ];
  assert.equal(dedupeWeatherSourceEvents(sourceEvents).length, 3);
  assert.deepEqual(
    firstNewDailyMaximumEvents(sourceEvents, temperatures, {
      officialDailyMaximumEvidence: COMPLETE_OFFICIAL_EVIDENCE,
    }).map((event) => event.tempC),
    [20, 21],
  );
});

test("an original and correction sharing a poll are not collapsed", () => {
  const sourceEvents = [
    {
      id: "original",
      source: "awc",
      reportKey: "report-original",
      obsTimeUtc: 500,
      at: 600,
      isCorrection: false,
    },
    {
      id: "correction",
      source: "awc",
      reportKey: "report-correction",
      obsTimeUtc: 500,
      at: 600,
      isCorrection: true,
    },
  ];
  const temperatures = [
    {
      kind: "official_report",
      reportKey: "report-original",
      obsTimeUtc: 500,
      tempC: 20,
    },
    {
      kind: "official_report",
      reportKey: "report-correction",
      obsTimeUtc: 500,
      tempC: 21,
    },
  ];
  assert.equal(dedupeWeatherSourceEvents(sourceEvents).length, 2);
  assert.deepEqual(
    firstNewDailyMaximumEvents(sourceEvents, temperatures, {
      officialDailyMaximumEvidence: COMPLETE_OFFICIAL_EVIDENCE,
    }).map((event) => event.tempC),
    [20, 21],
  );
});

test("conflicting report identities do not collapse when correction flags are absent", () => {
  const events = [
    {
      id: "first",
      source: "awc",
      reportKey: "report-a",
      obsTimeUtc: 500,
      at: 600,
    },
    {
      id: "second",
      source: "awc",
      reportKey: "report-b",
      obsTimeUtc: 500,
      at: 600,
    },
  ];
  assert.equal(dedupeWeatherSourceEvents(events).length, 2);
});

test("official maxima prefer source-event temperatures over a capped timeline", () => {
  const result = firstNewDailyMaximumEvents(
    [
      {
        id: "morning",
        source: "awc",
        reportKey: "morning-25",
        obsTimeUtc: 100,
        at: 200,
        tempC: 25,
      },
      {
        id: "afternoon",
        source: "awc",
        reportKey: "afternoon-20",
        obsTimeUtc: 300,
        at: 400,
        tempC: 20,
      },
    ],
    [
      {
        kind: "official_report",
        reportKey: "afternoon-20",
        obsTimeUtc: 300,
        tempC: 20,
      },
    ],
    { officialDailyMaximumEvidence: COMPLETE_OFFICIAL_EVIDENCE },
  );
  assert.deepEqual(
    result.map((event) => event.tempC),
    [25],
  );
});

test("official daily maxima fail closed when retained history is partial", () => {
  const result = firstNewDailyMaximumEvents(
    [
      {
        id: "report",
        source: "awc",
        reportKey: "report",
        obsTimeUtc: 100,
        at: 200,
        tempC: 25,
      },
    ],
    [],
    {
      officialDailyMaximumEvidence: {
        status: "partial",
        truncated: true,
        metarTruncated: true,
        relayTruncated: false,
      },
    },
  );
  assert.deepEqual(result, []);
});

test("TDZ 05 and 23 maxima remain separate and repeated frames are excluded", () => {
  const temperatures = [
    { id: "05-a", series: "capma_tdz_05", tdz: "05", at: 100, tempC: 20 },
    { id: "23-a", series: "capma_tdz_23", tdz: "23", at: 110, tempC: 21 },
    { id: "05-repeat", series: "capma_tdz_05", tdz: "05", at: 120, tempC: 20 },
    { id: "05-high", series: "capma_tdz_05", tdz: "05", at: 130, tempC: 22 },
  ];
  assert.deepEqual(
    firstNewDailyMaximumEvents([], temperatures, {
      tdzDailyMaximumEvidence: {
        status: "complete",
        truncated: false,
        events: temperatures,
        series: [
          {
            tdz: "05",
            series: "capma_tdz_05",
            status: "complete",
            complete: true,
          },
          {
            tdz: "23",
            series: "capma_tdz_23",
            status: "complete",
            complete: true,
          },
        ],
      },
    }).map((event) => [event.source, event.tempC]),
    [
      ["CAPMA TDZ 05", 20],
      ["CAPMA TDZ 23", 21],
      ["CAPMA TDZ 05", 22],
    ],
  );
});

test("TDZ daily maxima fail closed without explicit full-day coverage", () => {
  const temperatures = [
    { id: "05-a", series: "capma_tdz_05", tdz: "05", at: 100, tempC: 25 },
  ];
  assert.deepEqual(firstNewDailyMaximumEvents([], temperatures), []);
  assert.deepEqual(
    firstNewDailyMaximumEvents([], temperatures, {
      tdzDailyMaximumEvidence: {
        status: "partial",
        truncated: true,
        events: temperatures,
        series: [
          {
            tdz: "05",
            series: "capma_tdz_05",
            status: "partial",
            complete: false,
          },
        ],
      },
    }),
    [],
  );
});

test("partial TDZ evidence includes only its independently complete series", () => {
  const events = [
    { id: "05", series: "capma_tdz_05", tdz: "05", at: 100, tempC: 20 },
    { id: "23", series: "capma_tdz_23", tdz: "23", at: 110, tempC: 21 },
  ];
  const result = firstNewDailyMaximumEvents([], [], {
    tdzDailyMaximumEvidence: {
      status: "partial",
      truncated: false,
      events,
      series: [
        {
          tdz: "05",
          series: "capma_tdz_05",
          status: "complete",
          complete: true,
        },
        {
          tdz: "23",
          series: "capma_tdz_23",
          status: "partial",
          complete: false,
        },
      ],
    },
  });
  assert.deepEqual(
    result.map((event) => event.source),
    ["CAPMA TDZ 05"],
  );
});

test("a live TDZ rail expires when browser time passes its coverage tolerance", () => {
  const evidence = {
    status: "complete",
    liveDate: true,
    truncated: false,
    coverageToleranceMs: 300_000,
    events: [
      {
        id: "05",
        series: "capma_tdz_05",
        tdz: "05",
        at: 100,
        tempC: 20,
      },
    ],
    series: [
      {
        tdz: "05",
        series: "capma_tdz_05",
        status: "complete",
        complete: true,
        coverageEndAt: 1_000_000,
      },
    ],
  };
  const freshNow = 1_300_000;
  assert.equal(tdzDailySeriesStates(evidence, freshNow)[0].eligible, true);
  assert.equal(
    firstNewDailyMaximumEvents([], [], {
      tdzDailyMaximumEvidence: evidence,
      nowMs: freshNow,
    }).length,
    1,
  );

  const staleNow = freshNow + 1;
  const [staleState] = tdzDailySeriesStates(evidence, staleNow);
  assert.equal(staleState.eligible, false);
  assert.equal(staleState.reason, "stale");
  assert.deepEqual(
    firstNewDailyMaximumEvents([], [], {
      tdzDailyMaximumEvidence: evidence,
      nowMs: staleNow,
    }),
    [],
  );

  const excessiveFutureSkewNow = 699_999;
  const [futureSkewState] = tdzDailySeriesStates(
    evidence,
    excessiveFutureSkewNow,
  );
  assert.equal(futureSkewState.eligible, false);
  assert.equal(futureSkewState.reason, "stale");
});
