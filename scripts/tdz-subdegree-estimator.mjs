// RETIRED v1 sub-degree TDZ research prototype.
//
// Inputs are day-dashboard JSON dumps produced by:
//   npx convex run mexico:getDayDashboard '{"stationIcao":"MMMX","date":"YYYY-MM-DD"}' --prod
//
// Direct CLI use now delegates to scripts/tdz-quantizer-id.mjs. The exports
// and an explicit TDZ_RUN_RETIRED_V1=true escape hatch remain only for
// reproducing historical analyses. Review findings (2026-08-23):
//  - The display's rounding rule is UNDETERMINED. The residual statistic
//    below was falsified as a discriminator: on synthetic data with known
//    quantizers it returns ~0.0 under all-nearest but only ~+0.10 to +0.15
//    under all-floor (not +0.5, as an earlier analysis wrongly assumed),
//    and the live values sit between the two. Everything downstream runs
//    under an ASSUMED rule (default nearest) and inherits +/-0.5 boundary
//    ambiguity.
//  - The posterior bands are model-conditional inferred ranges: obsSigma
//    and the random-walk sigma are hand-chosen and materially change the
//    widths. They are not demonstrated accuracy.
//  - The "validation" stages are retrospective consistency checks, not
//    out-of-sample tests: the retained data passed the production OCR's
//    Magnus gate, the smoother is non-causal, and no untouched period is
//    held out. See docs/mexico-edge-investigation-2026-08-23.md.
//
// Stages:
//  1. Rounding-rule diagnostics (descriptive only — see above).
//  2. Constrained HMM smoother: per-frame feasible temperature intervals
//     (three-way Magnus intersection where extended fields exist, plain
//     T box otherwise) as soft observation costs; random-walk prior;
//     forward-backward marginals give a posterior mean and band.
//  3. Consistency checks against the 2-minute display (assumes an exact,
//     correctly phased 2-sample mean — unestablished) and against the dew
//     point after refitting without it.
//
// This estimates the TDZ display's own underlying value. It is not the
// METAR-selected sensor and never settlement truth. Usage:
//   node scripts/tdz-subdegree-estimator.mjs <dump1.json> [dump2.json ...] \
//     [--tdz 05] [--out results.json]

import fs from "node:fs";
import { runCli as runQuantizerCli } from "./tdz-quantizer-id.mjs";

// ---------- Magnus ----------
const esat = (t) => 6.112 * Math.exp((17.62 * t) / (243.12 + t));
export const magnusRH = (T, Td) => (100 * esat(Td)) / esat(T);
export const magnusTd = (T, rh) => {
  const gamma = Math.log(rh / 100) + (17.62 * T) / (243.12 + T);
  return (243.12 * gamma) / (17.62 - gamma);
};

// ---------- Rounding-rule hypotheses ----------
// interval(value) -> [lo, hi) of the unrounded quantity.
export const RULES = {
  round: (x) => [x - 0.5, x + 0.5],
  floor: (x) => [x, x + 1],
};
export function applyRule(rule, x) {
  return RULES[rule](x);
}
export function roundByRule(rule, x) {
  return rule === "floor" ? Math.floor(x) : Math.round(x);
}

// Feasible T interval for one frame under {tempRule, dewRule, rhRule}.
// Returns null when the three boxes are jointly infeasible.
export function feasibleTemperatureInterval(frame, rules) {
  const [tLo, tHi] = applyRule(rules.tempRule, frame.currentTempC);
  const haveTd = Number.isFinite(frame.dewpointC);
  const haveRh = Number.isFinite(frame.humidityPercent);
  if (!haveTd || !haveRh) {
    return { lo: tLo, hi: tHi, threeWay: false };
  }
  const [dLo, dHi] = applyRule(rules.dewRule, frame.dewpointC);
  const [rLo, rHi] = applyRule(rules.rhRule, frame.humidityPercent);
  let lo = null;
  let hi = null;
  for (let T = tLo; T <= tHi + 1e-9; T += 0.005) {
    // Td(T, rh) is monotone increasing in rh, so the reachable dew-point
    // range at this T comes from the rh endpoints.
    const tdAtLo = magnusTd(T, Math.max(0.1, rLo));
    const tdAtHi = magnusTd(T, Math.min(100, rHi));
    if (tdAtHi >= dLo && tdAtLo <= dHi) {
      if (lo === null) lo = T;
      hi = T;
    }
  }
  return lo === null ? null : { lo, hi, threeWay: true };
}

// Feasible RH interval for one frame (for the independent RH smoother).
export function feasibleHumidityInterval(frame, rules) {
  if (!Number.isFinite(frame.humidityPercent)) {
    return null;
  }
  const [rLo, rHi] = applyRule(rules.rhRule, frame.humidityPercent);
  return { lo: rLo, hi: rHi };
}

// ---------- Stage 1: calibration ----------
export function evaluateRoundingRules(frames) {
  const combos = [];
  for (const tempRule of ["round", "floor"]) {
    for (const rhRule of ["round", "floor"]) {
      // The dew point is computed from the unrounded pair and then rounded;
      // assume it shares the temperature channel's display rule.
      combos.push({ tempRule, dewRule: tempRule, rhRule });
    }
  }
  const usable = frames.filter(
    (f) => Number.isFinite(f.dewpointC) && Number.isFinite(f.humidityPercent),
  );
  return combos.map((rules) => {
    let infeasible = 0;
    for (const frame of usable) {
      if (feasibleTemperatureInterval(frame, rules) === null) {
        infeasible += 1;
      }
    }
    return {
      rules,
      frames: usable.length,
      infeasible,
      infeasiblePct: usable.length
        ? +((100 * infeasible) / usable.length).toFixed(2)
        : null,
    };
  });
}

// DESCRIPTIVE ONLY — NOT a rule discriminator. This statistic was falsified
// for that purpose: it hard-codes a centered Td window and exact RH, so
// under an all-floor display the channel shifts largely cancel and it
// returns ~+0.10 to +0.15 (verified on synthetic data), not the +0.5 an
// earlier analysis assumed. Live values (~+0.05 to +0.08) cannot separate
// the hypotheses. Frames are also heavily autocorrelated (lag-1 ~0.6-0.8,
// few distinct triples), so the naive standard error understates
// uncertainty by 2-3x. Kept as a diagnostic of Magnus/sensor consistency.
export function roundingResiduals(frames) {
  const tResiduals = [];
  const tdResiduals = [];
  for (const f of frames) {
    if (!Number.isFinite(f.dewpointC) || !Number.isFinite(f.humidityPercent)) {
      continue;
    }
    // implied T from dew/humidity centers, scanning a generous window
    let lo = null,
      hi = null;
    for (let T = f.currentTempC - 3; T <= f.currentTempC + 3; T += 0.01) {
      const td = magnusTd(T, f.humidityPercent);
      if (td >= f.dewpointC - 0.5 && td < f.dewpointC + 0.5) {
        if (lo === null) lo = T;
        hi = T;
      }
    }
    if (lo !== null) tResiduals.push((lo + hi) / 2 - f.currentTempC);
    const impliedTd = magnusTd(f.currentTempC, f.humidityPercent);
    tdResiduals.push(impliedTd - f.dewpointC);
  }
  const stats = (arr) => {
    if (!arr.length) return null;
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    const sd = Math.sqrt(
      arr.reduce((s, x) => s + (x - mean) * (x - mean), 0) / arr.length,
    );
    return {
      n: arr.length,
      mean: +mean.toFixed(3),
      standardError: +(sd / Math.sqrt(arr.length)).toFixed(3),
    };
  };
  return { temperature: stats(tResiduals), dewpoint: stats(tdResiduals) };
}

// ---------- Stage 2: constrained HMM smoother ----------
// 1-D grid smoother. Observation cost is soft outside the feasible interval
// so an occasional OCR slip or model violation degrades gracefully instead
// of breaking the fit.
export function smoothSeries({
  times,
  intervals,
  gridStep = 0.05,
  pad = 1.5,
  obsSigma = 0.12,
  walkSigmaPerSqrtMin = 0.1,
}) {
  const finite = intervals.filter(Boolean);
  if (finite.length < 3) {
    return null;
  }
  const gridLo =
    Math.floor((Math.min(...finite.map((i) => i.lo)) - pad) / gridStep) *
    gridStep;
  const gridHi =
    Math.ceil((Math.max(...finite.map((i) => i.hi)) + pad) / gridStep) *
    gridStep;
  const grid = [];
  for (let v = gridLo; v <= gridHi + 1e-9; v += gridStep) grid.push(v);
  const S = grid.length;
  const N = times.length;

  const obsLogProb = (interval, v) => {
    if (!interval) return 0;
    const d =
      v < interval.lo ? interval.lo - v : v > interval.hi ? v - interval.hi : 0;
    return -(d * d) / (2 * obsSigma * obsSigma);
  };

  // forward-backward in log space with Gaussian transition kernels
  const logKernel = (dtMin) => {
    const sigma = Math.max(
      1e-3,
      walkSigmaPerSqrtMin * Math.sqrt(Math.max(0.2, dtMin)),
    );
    const row = new Float64Array(2 * S - 1);
    for (let k = -(S - 1); k <= S - 1; k += 1) {
      const d = k * gridStep;
      row[k + S - 1] = -(d * d) / (2 * sigma * sigma);
    }
    return row;
  };
  const logSumExp = (arr) => {
    let m = -Infinity;
    for (const x of arr) if (x > m) m = x;
    if (m === -Infinity) return m;
    let s = 0;
    for (const x of arr) s += Math.exp(x - m);
    return m + Math.log(s);
  };
  const propagate = (vec, kernel) => {
    const out = new Float64Array(S);
    const tmp = new Float64Array(S);
    for (let j = 0; j < S; j += 1) {
      for (let i = 0; i < S; i += 1) tmp[i] = vec[i] + kernel[j - i + S - 1];
      out[j] = logSumExp(tmp);
    }
    return out;
  };

  const fwd = [];
  let cur = new Float64Array(S);
  for (let j = 0; j < S; j += 1) cur[j] = obsLogProb(intervals[0], grid[j]);
  fwd.push(cur);
  for (let n = 1; n < N; n += 1) {
    const kernel = logKernel((times[n] - times[n - 1]) / 60000);
    const prop = propagate(fwd[n - 1], kernel);
    const next = new Float64Array(S);
    for (let j = 0; j < S; j += 1)
      next[j] = prop[j] + obsLogProb(intervals[n], grid[j]);
    fwd.push(next);
  }
  const bwd = new Array(N);
  bwd[N - 1] = new Float64Array(S);
  for (let n = N - 2; n >= 0; n -= 1) {
    const kernel = logKernel((times[n + 1] - times[n]) / 60000);
    const withObs = new Float64Array(S);
    for (let j = 0; j < S; j += 1)
      withObs[j] = bwd[n + 1][j] + obsLogProb(intervals[n + 1], grid[j]);
    bwd[n] = propagate(withObs, kernel);
  }

  const points = [];
  for (let n = 0; n < N; n += 1) {
    const logPost = new Float64Array(S);
    for (let j = 0; j < S; j += 1) logPost[j] = fwd[n][j] + bwd[n][j];
    const z = logSumExp(logPost);
    let mean = 0;
    const cdf = [];
    let acc = 0;
    for (let j = 0; j < S; j += 1) {
      const p = Math.exp(logPost[j] - z);
      mean += p * grid[j];
      acc += p;
      cdf.push(acc);
    }
    const quantile = (q) => {
      for (let j = 0; j < S; j += 1) if (cdf[j] >= q) return grid[j];
      return grid[S - 1];
    };
    points.push({
      t: times[n],
      mean: +mean.toFixed(3),
      p10: +quantile(0.1).toFixed(3),
      p90: +quantile(0.9).toFixed(3),
    });
  }
  return points;
}

// ---------- Stage 3: held-out validation ----------
// The displayed 2-minute value is the rounded mean of the last two 1-minute
// instantaneous samples. Predict it from the estimate; the fit never saw it.
export function validateTwoMinute({ frames, estimate, rule }) {
  const byTime = new Map(estimate.map((p) => [p.t, p]));
  const interp = (t) => {
    let before = null;
    let after = null;
    for (const p of estimate) {
      if (p.t <= t) before = p;
      if (p.t >= t) {
        after = p;
        break;
      }
    }
    if (!before || !after) return null;
    if (after.t === before.t) return before.mean;
    if (after.t - before.t > 5 * 60000) return null;
    const w = (t - before.t) / (after.t - before.t);
    return before.mean * (1 - w) + after.mean * w;
  };
  let n = 0,
    hit = 0,
    baselineHit = 0;
  // Frames where the two displays disagree are the only informative cases at
  // night (elsewhere predicting "T2 = T" is trivially right), so track them
  // separately.
  let hardN = 0,
    hardHit = 0;
  for (const f of frames) {
    if (!Number.isFinite(f.twoMinuteTempC)) continue;
    const now = byTime.get(f.screenTimeUtc);
    const prev = interp(f.screenTimeUtc - 60000);
    if (!now || prev === null) continue;
    n += 1;
    const predicted = roundByRule(rule, (now.mean + prev) / 2);
    if (predicted === f.twoMinuteTempC) hit += 1;
    if (f.currentTempC === f.twoMinuteTempC) baselineHit += 1;
    if (f.currentTempC !== f.twoMinuteTempC) {
      hardN += 1;
      if (predicted === f.twoMinuteTempC) hardHit += 1;
    }
  }
  return {
    n,
    matchPct: n ? +((100 * hit) / n).toFixed(1) : null,
    baselineMatchPct: n ? +((100 * baselineHit) / n).toFixed(1) : null,
    disagreementFrames: hardN,
    disagreementMatchPct: hardN ? +((100 * hardHit) / hardN).toFixed(1) : null,
  };
}

// Refit T and RH independently WITHOUT the dew-point constraint, then predict
// the displayed dew point. Independence makes the test strictly harder.
export function validateDewpointHoldout({ frames, rules }) {
  const times = frames.map((f) => f.screenTimeUtc);
  const tIntervals = frames.map((f) => {
    const [lo, hi] = applyRule(rules.tempRule, f.currentTempC);
    return { lo, hi };
  });
  const rhIntervals = frames.map((f) => feasibleHumidityInterval(f, rules));
  const tFit = smoothSeries({ times, intervals: tIntervals });
  const rhFit = smoothSeries({
    times,
    intervals: rhIntervals,
    gridStep: 0.25,
    pad: 4,
    obsSigma: 0.4,
    walkSigmaPerSqrtMin: 0.8,
  });
  if (!tFit || !rhFit) return null;
  let n = 0,
    hit = 0,
    baselineHit = 0;
  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i];
    if (!Number.isFinite(f.dewpointC) || !rhIntervals[i]) continue;
    n += 1;
    const predicted = roundByRule(
      rules.dewRule,
      magnusTd(tFit[i].mean, Math.max(0.1, Math.min(100, rhFit[i].mean))),
    );
    if (predicted === f.dewpointC) hit += 1;
    const baseline = roundByRule(
      rules.dewRule,
      magnusTd(f.currentTempC, f.humidityPercent),
    );
    if (baseline === f.dewpointC) baselineHit += 1;
  }
  return {
    n,
    matchPct: n ? +((100 * hit) / n).toFixed(1) : null,
    baselineMatchPct: n ? +((100 * baselineHit) / n).toFixed(1) : null,
  };
}

// ---------- CLI ----------
function loadFrames(paths, tdz) {
  const all = [];
  for (const p of paths) {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const r of j.capma?.rows ?? []) {
      if (r.tdz === tdz) all.push(r);
    }
  }
  const seen = new Set();
  return all
    .filter((r) => {
      if (seen.has(r.rawHash)) return false;
      seen.add(r.rawHash);
      return true;
    })
    .sort((a, b) => a.screenTimeUtc - b.screenTimeUtc);
}

const isMain =
  process.argv[1] &&
  import.meta.url.endsWith(
    process.argv[1].replace(/\\/g, "/").split("/").pop(),
  );
const runRetiredV1 = process.env.TDZ_RUN_RETIRED_V1 === "true";
if (isMain && !runRetiredV1) {
  console.error(
    "tdz-subdegree-estimator.mjs v1 is retired; delegating to " +
      "tdz-quantizer-id.mjs with full quantizer and formula-bias uncertainty.",
  );
  process.exitCode = runQuantizerCli(["estimate", ...process.argv.slice(2)]);
}
if (isMain && runRetiredV1) {
  const args = process.argv.slice(2);
  const tdz = args.includes("--tdz") ? args[args.indexOf("--tdz") + 1] : "05";
  const outPath = args.includes("--out")
    ? args[args.indexOf("--out") + 1]
    : null;
  const paths = args.filter(
    (a, i) =>
      !a.startsWith("--") && args[i - 1] !== "--tdz" && args[i - 1] !== "--out",
  );
  const frames = loadFrames(paths, tdz);
  console.log(`TDZ${tdz}: ${frames.length} distinct frames loaded`);

  console.log(
    "\n== Stage 1: rounding-rule calibration (lower infeasible % wins)",
  );
  const calib = evaluateRoundingRules(frames);
  for (const c of calib) {
    console.log(
      `  temp/dew=${c.rules.tempRule.padEnd(5)} rh=${c.rules.rhRule.padEnd(5)} -> infeasible ${c.infeasible}/${c.frames} (${c.infeasiblePct}%)`,
    );
  }
  const residuals = roundingResiduals(frames);
  if (residuals.temperature) {
    console.log(
      `  descriptive residuals (NOT a rule discriminator; ~0.0 all-nearest vs ~+0.1-0.15 all-floor, naive SE understated 2-3x):\n` +
        `    implied-T minus displayed-T:   mean ${residuals.temperature.mean} +/- ${residuals.temperature.standardError} (n=${residuals.temperature.n})\n` +
        `    implied-Td minus displayed-Td: mean ${residuals.dewpoint.mean} +/- ${residuals.dewpoint.standardError} (n=${residuals.dewpoint.n})`,
    );
  }
  const best = calib.slice().sort((a, b) => a.infeasible - b.infeasible)[0];
  console.log(
    `  rounding rule UNDETERMINED by these diagnostics; proceeding under the ASSUMPTION temp/dew=${best.rules.tempRule}, rh=${best.rules.rhRule} — all downstream numbers are conditional on it`,
  );

  console.log(
    "\n== Stage 2: constrained smoother (bands are model-conditional, not accuracy)",
  );
  // Keep every frame: feasibleTemperatureInterval falls back to the plain
  // temperature box when the extended fields are absent, and dropping those
  // frames loses exactly the tick information the method depends on.
  const usable = frames;
  const intervals = usable.map((f) =>
    feasibleTemperatureInterval(f, best.rules),
  );
  const estimate = smoothSeries({
    times: usable.map((f) => f.screenTimeUtc),
    intervals,
  });
  if (!estimate) {
    console.log("  not enough frames");
    process.exit(1);
  }
  const bandWidths = estimate.map((p) => p.p90 - p.p10).sort((a, b) => a - b);
  const q = (p) =>
    bandWidths[Math.floor(p * (bandWidths.length - 1))].toFixed(2);
  console.log(
    `  ${estimate.length} points; 10-90% band width: p25=${q(0.25)} median=${q(0.5)} p75=${q(0.75)} (deg C)`,
  );

  console.log(
    "\n== Stage 3: retrospective consistency checks (NOT out-of-sample validation; data passed the OCR Magnus gate, smoother is non-causal, no held-out period)",
  );
  const v2 = validateTwoMinute({
    frames: usable,
    estimate,
    rule: best.rules.tempRule,
  });
  console.log(
    `  2-minute display (not used in fit; assumes exact 2-sample phasing): matched ${v2.matchPct}% of ${v2.n} frames (naive baseline ${v2.baselineMatchPct}%)`,
  );
  console.log(
    `    on the ${v2.disagreementFrames} frames where T2 differs from T (the informative cases): ${v2.disagreementMatchPct}%`,
  );
  const vd = validateDewpointHoldout({ frames: usable, rules: best.rules });
  if (vd) {
    console.log(
      `  dew point (refit without it; rule-insensitive, so it cannot identify the quantizer): matched ${vd.matchPct}% of ${vd.n} frames (rounded-inputs baseline ${vd.baselineMatchPct}%)`,
    );
  }

  if (outPath) {
    fs.writeFileSync(
      outPath,
      JSON.stringify({
        tdz,
        rules: best.rules,
        estimate,
        frames: usable.map((f) => ({
          t: f.screenTimeUtc,
          T: f.currentTempC,
          T2: f.twoMinuteTempC,
          Td: f.dewpointC ?? null,
          RH: f.humidityPercent ?? null,
        })),
      }),
    );
    console.log(`\nwrote ${outPath}`);
  }
}
