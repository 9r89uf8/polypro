import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildModelSpec,
  buildRobustEnvelope,
  DECISIVE_LOGL,
  DEFAULT_BIAS_GRID,
  DEFAULT_COMBOS,
  identifyQuantizer,
  loadFrames,
  magnusTd,
  makeGrid,
  mulberry32,
  numericalSafetyGatePassed,
  QRULES,
  runCli,
  runNumericalSafetySuite,
  sequenceLogLikelihood,
  synthesizeFrames,
  tdCellOverlapFraction,
  validateFrames,
} from "../scripts/tdz-quantizer-id.mjs";

function ruleKey(rules) {
  return `${rules.tRule}/${rules.tdRule}/${rules.rhRule}`;
}

function denseDewCellOverlapFraction(
  T,
  RH,
  tStep,
  rhStep,
  lo,
  hi,
  subdivisions = 320,
) {
  let inside = 0;
  for (let i = 0; i < subdivisions; i += 1) {
    const t = T - tStep / 2 + ((i + 0.5) * tStep) / subdivisions;
    for (let j = 0; j < subdivisions; j += 1) {
      const rh = RH - rhStep / 2 + ((j + 0.5) * rhStep) / subdivisions;
      const td = magnusTd(t, rh);
      if (td >= lo && td < hi) inside += 1;
    }
  }
  return inside / (subdivisions * subdivisions);
}

test("synthetic generator is deterministic per seed", () => {
  const a = synthesizeFrames({ n: 50, seed: 3 });
  const b = synthesizeFrames({ n: 50, seed: 3 });
  const c = synthesizeFrames({ n: 50, seed: 4 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(Math.abs(mulberry32(1)() - mulberry32(1)()) < 1e-12);
});

test("grid cell centers never sit on either rule's box boundaries", () => {
  const frames = synthesizeFrames({ n: 200, seed: 5 });
  const grid = makeGrid(frames, { tStep: 0.1, rhStep: 0.5 });
  for (const v of grid.tGrid) {
    const twice = v * 2;
    assert.ok(
      Math.abs(twice - Math.round(twice)) > 1e-6,
      `T center ${v} sits on a 0.5-multiple box edge`,
    );
  }
  for (const v of grid.rhGrid) {
    const twice = v * 2;
    assert.ok(
      Math.abs(twice - Math.round(twice)) > 1e-6,
      `RH center ${v} sits on a 0.5-multiple box edge`,
    );
  }
});

test("grid reports the cell spacing it actually uses", () => {
  const frames = synthesizeFrames({ n: 80, seed: 17 });
  const grid = makeGrid(frames, { tStep: 0.2, rhStep: 0.25 });
  assert.equal(grid.tStep, 0.2);
  assert.equal(grid.rhStep, 0.25);
  for (let i = 1; i < grid.tGrid.length; i += 1) {
    assert.ok(Math.abs(grid.tGrid[i] - grid.tGrid[i - 1] - grid.tStep) < 1e-10);
  }
  for (let i = 1; i < grid.rhGrid.length; i += 1) {
    assert.ok(
      Math.abs(grid.rhGrid[i] - grid.rhGrid[i - 1] - grid.rhStep) < 1e-10,
    );
  }
  assert.throws(
    () => makeGrid(frames, { tStep: 0.3, rhStep: 0.5 }),
    /reciprocal of an integer/,
  );
});

test("magnus dew point stays below temperature and is monotone in humidity", () => {
  for (const T of [5, 15, 25]) {
    assert.ok(magnusTd(T, 99.9) < T + 0.01);
    assert.ok(magnusTd(T, 50) < magnusTd(T, 80));
  }
});

test("dew-cell quadrature agrees with a dense area oracle", () => {
  for (const c of [
    {
      T: 15.05,
      RH: 60.25,
      tStep: 0.1,
      rhStep: 0.5,
      loOffset: 0.04,
      hiOffset: 1,
    },
    {
      T: 24.05,
      RH: 40.25,
      tStep: 0.1,
      rhStep: 0.5,
      loOffset: -0.06,
      hiOffset: 0.015,
    },
    {
      T: 8.05,
      RH: 90.25,
      tStep: 0.1,
      rhStep: 0.5,
      loOffset: -1,
      hiOffset: -0.025,
    },
  ]) {
    const center = magnusTd(c.T, c.RH);
    const lo = center + c.loOffset;
    const hi = center + c.hiOffset;
    const actual = tdCellOverlapFraction(c.T, c.RH, c.tStep, c.rhStep, lo, hi);
    const oracle = denseDewCellOverlapFraction(
      c.T,
      c.RH,
      c.tStep,
      c.rhStep,
      lo,
      hi,
    );
    assert.ok(
      Math.abs(actual - oracle) < 0.015,
      `quadrature ${actual} differs from dense oracle ${oracle} at T=${c.T}, RH=${c.RH}`,
    );
  }
});

test("default hypotheses are the complete quantizer Cartesian product", () => {
  const expected = new Set();
  for (const tRule of ["round", "floor"]) {
    for (const tdRule of ["round", "floor"]) {
      for (const rhRule of ["round", "floor"]) {
        expected.add(ruleKey({ tRule, tdRule, rhRule }));
      }
    }
  }
  const actual = new Set(DEFAULT_COMBOS.map(ruleKey));
  assert.equal(DEFAULT_COMBOS.length, 8);
  assert.equal(actual.size, 8);
  assert.deepEqual(actual, expected);
});

test(
  "numerical safety suite covers every truth, multiple seeds, and is not vacuously undecided",
  { timeout: 300_000 },
  () => {
    const seeds = [11, 29];
    const outcomes = runNumericalSafetySuite({
      n: 72,
      seeds,
      quiet: true,
      biasGrid: [0],
    });
    const expectedTruths = new Set(DEFAULT_COMBOS.map(ruleKey));

    for (const seed of seeds) {
      const covered = new Set(
        outcomes
          .filter((o) => o.seed === seed && o.truth)
          .map((o) => ruleKey(o.truth)),
      );
      assert.deepEqual(
        covered,
        expectedTruths,
        `seed ${seed} did not cover all rule truths`,
      );
    }
    assert.ok(
      outcomes.some((o) => o.verdict === "decisive-correct"),
      "an always-undecided implementation must not satisfy the safety suite",
    );
    assert.ok(numericalSafetyGatePassed(outcomes));
    assert.equal(
      numericalSafetyGatePassed([
        { name: "always tied", pass: true, verdict: "undecided" },
      ]),
      false,
      "an always-undecided implementation must not pass the runtime gate",
    );
    assert.equal(
      numericalSafetyGatePassed([
        ...outcomes,
        { name: "injected failure", pass: false },
      ]),
      false,
    );
  },
);

test(
  "profiled half-unit bias cannot create a decisive false T/Td-family claim",
  { timeout: 300_000 },
  () => {
    assert.ok(DEFAULT_BIAS_GRID.includes(-0.5));
    assert.ok(DEFAULT_BIAS_GRID.includes(0.5));
    const cases = [
      {
        truth: { tRule: "round", tdRule: "round", rhRule: "round" },
        tdBias: 0.5,
        seed: 41,
      },
      {
        truth: { tRule: "floor", tdRule: "floor", rhRule: "floor" },
        tdBias: -0.5,
        seed: 42,
      },
      {
        truth: { tRule: "round", tdRule: "floor", rhRule: "floor" },
        tdBias: 0.5,
        seed: 43,
      },
      {
        truth: { tRule: "floor", tdRule: "round", rhRule: "floor" },
        tdBias: -0.5,
        seed: 44,
      },
    ];
    for (const c of cases) {
      const frames = synthesizeFrames({
        n: 120,
        seed: c.seed,
        rules: c.truth,
        tdBias: c.tdBias,
      });
      const id = identifyQuantizer(frames, {
        biasGrid: [-0.5, 0, 0.5],
        gridOpts: { tStep: 0.1, rhStep: 0.5 },
      });
      const entries = new Map(
        id.familyEvidence.tTdRelationship.entries.map((entry) => [
          entry.family,
          entry,
        ]),
      );
      assert.ok(
        id.familyEvidence.tTdRelationship.deltaLogEvidence < DECISIVE_LOGL,
        `${ruleKey(c.truth)} bias ${c.tdBias} should remain relationship-undecided`,
      );
      const correctFamily =
        c.truth.tRule === c.truth.tdRule ? "shared" : "mixed";
      const wrongFamily = correctFamily === "shared" ? "mixed" : "shared";
      assert.ok(entries.has(correctFamily) && entries.has(wrongFamily));
      const wrongAdvantage =
        entries.get(wrongFamily).logEvidence -
        entries.get(correctFamily).logEvidence;
      assert.ok(
        wrongAdvantage < DECISIVE_LOGL,
        `${ruleKey(c.truth)} bias ${c.tdBias} falsely favored ${wrongFamily} by ${wrongAdvantage}`,
      );
    }
  },
);

test(
  "likelihood prefers the true trajectory family over a broken one",
  { timeout: 120_000 },
  () => {
    // Sanity: shuffling the frame order destroys the random-walk structure and
    // must sharply reduce the sequence likelihood under the same rules.
    const frames = synthesizeFrames({ n: 300, seed: 9 });
    const grid = makeGrid(frames, { tStep: 0.1, rhStep: 0.5 });
    const rules = { tRule: "round", tdRule: "round", rhRule: "round" };
    const ordered = sequenceLogLikelihood(frames, { grid, rules }).logL;
    const rng = mulberry32(2);
    const shuffled = frames
      .map((f, i) => ({
        ...f,
        screenTimeUtc: frames[0].screenTimeUtc + i * 60_000,
      }))
      .sort(() => rng() - 0.5)
      .map((f, i) => ({
        ...f,
        screenTimeUtc: frames[0].screenTimeUtc + i * 60_000,
      }));
    const broken = sequenceLogLikelihood(shuffled, { grid, rules }).logL;
    assert.ok(
      ordered > broken + 50,
      `ordered ${ordered} should beat shuffled ${broken}`,
    );
  },
);

test("quantizer rule boxes are consistent with their quantizers", () => {
  for (const rule of ["round", "floor"]) {
    const { q, lo, hi } = QRULES[rule];
    for (const x of [13.2, 13.5, 13.9, 14.0, 14.49]) {
      const d = q(x);
      assert.ok(
        x >= lo(d) - 1e-9 && x < hi(d) + 1e-9,
        `${rule}: ${x} outside box of ${d}`,
      );
    }
  }
});

test("robust envelope labels conditional bounds and uses explicit model weights", () => {
  const runs = [
    [
      { t: 1, mean: 10, p10: 9.8, p90: 10.2 },
      { t: 2, mean: 11, p10: 10.7, p90: 11.2 },
    ],
    [
      { t: 1, mean: 10.5, p10: 10.3, p90: 10.8 },
      { t: 2, mean: 10.6, p10: 10.2, p90: 11.0 },
    ],
  ];
  const envelope = buildRobustEnvelope(runs, [0.8, 0.2]);
  assert.deepEqual(envelope, [
    {
      t: 1,
      modelWeightedMean: 10.1,
      conditionalP10Envelope: 9.8,
      conditionalP90Envelope: 10.8,
    },
    {
      t: 2,
      modelWeightedMean: 10.92,
      conditionalP10Envelope: 10.2,
      conditionalP90Envelope: 11.2,
    },
  ]);
  assert.ok(!("p10" in envelope[0]) && !("p90" in envelope[0]));
});

test("input manifest fingerprints exact bytes and model spec is fully resolved", () => {
  const dir = mkdtempSync(join(tmpdir(), "tdz-quantizer-test-"));
  try {
    const path = join(dir, "day.json");
    const rows = [
      {
        tdz: "05",
        rawHash: "a",
        screenTimeUtc: 1,
        currentTempC: 15,
        dewpointC: 10,
        humidityPercent: 70,
      },
      {
        tdz: "23",
        rawHash: "b",
        screenTimeUtc: 2,
        currentTempC: 16,
      },
    ];
    const raw = Buffer.from(JSON.stringify({ capma: { rows } }), "utf8");
    writeFileSync(path, raw);
    const loaded = loadFrames([path], "05");
    assert.equal(loaded.frames.length, 1);
    assert.deepEqual(loaded.inputs, [
      {
        path,
        sha256: createHash("sha256").update(raw).digest("hex"),
        bytes: raw.length,
      },
    ]);

    const spec = buildModelSpec();
    assert.deepEqual(spec.biasGrid, [...DEFAULT_BIAS_GRID]);
    assert.deepEqual(spec.combos, DEFAULT_COMBOS);
    assert.ok(spec.gridOpts && spec.dynamics);
    assert.ok(Number.isFinite(spec.blockMs));
    assert.ok(Number.isFinite(spec.plausibleDeltaLogL));
    assert.equal(JSON.stringify(spec), JSON.stringify(buildModelSpec()));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("live input normalizes one-sided extended OCR to temperature-only while model APIs stay strict", () => {
  const dir = mkdtempSync(join(tmpdir(), "tdz-quantizer-partial-ext-test-"));
  try {
    const path = join(dir, "partial-extended.json");
    const rows = [
      {
        tdz: "05",
        rawHash: "only-td",
        screenTimeUtc: 1,
        currentTempC: 15,
        dewpointC: 10,
      },
      {
        tdz: "05",
        rawHash: "only-rh",
        screenTimeUtc: 2,
        currentTempC: 16,
        humidityPercent: 65,
      },
      {
        tdz: "05",
        rawHash: "paired",
        screenTimeUtc: 3,
        currentTempC: 17,
        dewpointC: 11,
        humidityPercent: 60,
      },
    ];
    writeFileSync(path, JSON.stringify({ capma: { rows } }));
    const loaded = loadFrames([path], "05");
    assert.equal(loaded.frames.length, 3);
    assert.equal(loaded.normalization.incompleteAuxiliaryPairsDiscarded, 2);
    for (const frame of loaded.frames.slice(0, 2)) {
      assert.ok(Number.isFinite(frame.currentTempC));
      assert.equal(Number.isFinite(frame.dewpointC), false);
      assert.equal(Number.isFinite(frame.humidityPercent), false);
      assert.equal(Object.hasOwn(frame, "dewpointC"), false);
      assert.equal(Object.hasOwn(frame, "humidityPercent"), false);
    }
    assert.ok(Number.isFinite(loaded.frames[2].dewpointC));
    assert.ok(Number.isFinite(loaded.frames[2].humidityPercent));

    const logs = [];
    const exitCode = runCli(["identify", path, "--tdz", "05"], {
      log: (...args) => logs.push(args.join(" ")),
      error: (...args) => logs.push(args.join(" ")),
      safetySuiteFn: () => [
        {
          name: "injected positive control",
          pass: true,
          verdict: "decisive-correct",
        },
      ],
    });
    assert.equal(exitCode, 0, logs.join("\n"));
    assert.match(logs.join("\n"), /TDZ05: 3 frames/);

    assert.throws(
      () => validateFrames([rows[0]]),
      /must provide dew point and humidity together/,
    );
    assert.throws(
      () => validateFrames([rows[1]]),
      /must provide dew point and humidity together/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI fails closed before loading live inputs when numerical safety fails", () => {
  let loadAttempted = false;
  const logs = [];
  const exitCode = runCli(["identify", "must-not-load.json", "--tdz", "05"], {
    log: (...args) => logs.push(args.join(" ")),
    error: (...args) => logs.push(args.join(" ")),
    safetySuiteFn: () => [{ name: "injected failure", pass: false }],
    loadFramesFn: () => {
      loadAttempted = true;
      throw new Error("gate allowed input loading");
    },
  });
  assert.notEqual(exitCode, 0);
  assert.equal(loadAttempted, false);
  assert.match(logs.join("\n"), /gate failed|safety failed|refus/i);
});

test("retired v1 CLI delegates to the guarded v2 estimate path", () => {
  const source = readFileSync(
    new URL("../scripts/tdz-subdegree-estimator.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /runCli as runQuantizerCli/);
  assert.match(
    source,
    /runQuantizerCli\(\["estimate", \.\.\.process\.argv\.slice\(2\)\]\)/,
  );
  assert.match(source, /TDZ_RUN_RETIRED_V1/);
});

test("persisted estimate carries input/script manifests, resolved model, and honest envelope labels", () => {
  const dir = mkdtempSync(join(tmpdir(), "tdz-quantizer-output-test-"));
  try {
    const outPath = join(dir, "result.json");
    const inputs = [
      { path: "frozen-day.json", sha256: "a".repeat(64), bytes: 1234 },
    ];
    const frames = synthesizeFrames({ n: 6, seed: 71 });
    const exitCode = runCli(
      ["estimate", "frozen-day.json", "--tdz", "05", "--out", outPath],
      {
        log: () => {},
        error: () => {},
        safetySuiteFn: () => [
          {
            name: "injected positive control",
            pass: true,
            verdict: "decisive-correct",
          },
        ],
        loadFramesFn: () => ({ frames, inputs }),
      },
    );
    assert.equal(exitCode, 0);
    const output = JSON.parse(readFileSync(outPath, "utf8"));
    assert.deepEqual(output.inputs, inputs);
    assert.match(output.script.sha256, /^[a-f0-9]{64}$/);
    assert.ok(output.script.bytes > 0);
    assert.deepEqual(output.identification.modelSpec.biasGrid, [
      ...DEFAULT_BIAS_GRID,
    ]);
    assert.match(output.estimate.kind, /robust envelope/i);
    assert.match(
      output.estimate.note,
      /not a posterior-mixture 10-90 interval/i,
    );
    assert.ok(output.estimate.filtered.length > 0);
    assert.ok("conditionalP10Envelope" in output.estimate.filtered[0]);
    assert.ok("conditionalP90Envelope" in output.estimate.filtered[0]);
    assert.ok(
      !("p10" in output.estimate.filtered[0]) &&
        !("p90" in output.estimate.filtered[0]),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
