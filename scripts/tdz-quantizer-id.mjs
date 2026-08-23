// v2 sub-degree TDZ toolkit: quantizer identification by finite-grid
// approximate marginal likelihood.
//
// Review-driven redesign (docs/mexico-edge-investigation-2026-08-23.md): the
// v1 residual statistic could not separate rounding rules. v2 treats the
// problem as model comparison. A joint latent (temperature, humidity) state
// evolves as a random walk; each frame observes the state through three
// quantized channels (T display, RH display, and a dew point computed via a
// Magnus-like relation plus a formula-bias term, then quantized). For every
// quantizer-rule hypothesis the forward filter of a 2-D grid HMM approximates
// the sequence marginal likelihood; hypotheses are ranked by family evidence,
// per-hour-block stability instead of naive per-frame standard errors, and
// the whole pipeline must first pass a numerical-safety suite before a live
// run is allowed. Passing that suite rules out known numerical artifacts; it
// does not prove that the quantizer is identifiable.
//
// Outputs remain estimates of the TDZ display's own underlying value —
// never the METAR-selected sensor, never settlement truth. Offline research
// tooling only.
//
// Usage:
//   node scripts/tdz-quantizer-id.mjs safety
//   node scripts/tdz-quantizer-id.mjs identify <dump.json...> --tdz 05
//   node scripts/tdz-quantizer-id.mjs estimate <dump.json...> --tdz 05 --out r.json

import fs from "node:fs";
import { createHash } from "node:crypto";

export const MODEL_VERSION = "tdz-quantizer-id-v2.1";
export const DEFAULT_GRID_OPTIONS = Object.freeze({
  tStep: 0.1,
  rhStep: 0.5,
  tPad: 2,
  rhPad: 5,
});
export const DEFAULT_DYNAMICS = Object.freeze({
  sigmaTPerSqrtMin: 0.08,
  sigmaRHPerSqrtMin: 0.7,
  eps: 0.01,
});
// This is an explicitly discrete approximation to a broad continuous-uniform
// formula-bias nuisance. It includes the +/-0.5 C shift that is confounded
// with a change of display quantizer. Callers may supply a denser grid.
export const DEFAULT_BIAS_GRID = Object.freeze([
  -0.5, -0.25, -0.15, -0.1, -0.025, 0, 0.025, 0.1, 0.15, 0.25, 0.5,
]);
export const DEFAULT_BLOCK_MS = 3_600_000;
export const PLAUSIBLE_MODEL_DELTA_LOGL = 10;
export const QUADRATURE_ORDER = 8;
export const QUADRATURE_PANELS = 4;

// ---------- Magnus ----------
const esat = (t) => 6.112 * Math.exp((17.62 * t) / (243.12 + t));
export const magnusTd = (T, rh) => {
  const gamma = Math.log(rh / 100) + (17.62 * T) / (243.12 + T);
  return (243.12 * gamma) / (17.62 - gamma);
};

export const magnusRhForTd = (T, Td) => {
  const tdGamma = (17.62 * Td) / (243.12 + Td);
  return 100 * Math.exp(tdGamma - (17.62 * T) / (243.12 + T));
};

// Eight-point Gauss-Legendre quadrature on [-1, 1]. Dew point is monotone in
// RH at fixed T, so inverse Magnus turns the area of a cell inside a dew-point
// box into a stable one-dimensional integral over T. This computes the actual
// rectangular-cell area fraction rather than pretending that transformed
// values are uniform across their min/max span.
const GL8_X = Object.freeze([
  -0.9602898564975363, -0.7966664774136267, -0.525532409916329,
  -0.1834346424956498, 0.1834346424956498, 0.525532409916329,
  0.7966664774136267, 0.9602898564975363,
]);
const GL8_W = Object.freeze([
  0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362,
  0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763,
]);

export function tdCellOverlapFraction(T, RH, tStep, rhStep, lo, hi) {
  if (![T, RH, tStep, rhStep, lo, hi].every(Number.isFinite)) {
    throw new TypeError("Td cell-overlap arguments must be finite numbers.");
  }
  if (!(tStep > 0) || !(rhStep > 0) || !(hi > lo)) {
    throw new RangeError(
      "Td cell-overlap requires positive steps and hi > lo.",
    );
  }
  const cellTLo = T - tStep / 2;
  const rhLo = Math.max(1e-6, RH - rhStep / 2);
  const rhHi = Math.min(100, RH + rhStep / 2);
  const rhWidth = rhHi - rhLo;
  if (!(rhWidth > 0)) return 0;
  let area = 0;
  const panelWidth = tStep / QUADRATURE_PANELS;
  for (let panel = 0; panel < QUADRATURE_PANELS; panel += 1) {
    const panelCenter = cellTLo + (panel + 0.5) * panelWidth;
    const panelHalf = panelWidth / 2;
    let weightedRhOverlap = 0;
    for (let q = 0; q < QUADRATURE_ORDER; q += 1) {
      const tq = panelCenter + panelHalf * GL8_X[q];
      const tdRhLo = magnusRhForTd(tq, lo);
      const tdRhHi = magnusRhForTd(tq, hi);
      const overlap = Math.max(
        0,
        Math.min(rhHi, tdRhHi) - Math.max(rhLo, tdRhLo),
      );
      weightedRhOverlap += GL8_W[q] * overlap;
    }
    area += panelHalf * weightedRhOverlap;
  }
  return Math.min(1, Math.max(0, area / (tStep * rhWidth)));
}

// ---------- Quantizer rules ----------
// 'round' = nearest; 'floor' = Math.floor. For the MMMX climate (always
// above 0 degC in retained data) floor and truncation-toward-zero coincide;
// a distinct 'trunc' rule must be added before applying this to sub-zero
// data.
export const QRULES = {
  round: { q: (x) => Math.round(x), lo: (d) => d - 0.5, hi: (d) => d + 0.5 },
  floor: { q: (x) => Math.floor(x), lo: (d) => d, hi: (d) => d + 1 },
};

// ---------- Deterministic RNG (reproducible synthetics) ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rng) => {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
};

// ---------- Synthetic generator ----------
export function synthesizeFrames({
  n = 720,
  dtMs = 60_000,
  seed = 7,
  rules = { tRule: "round", tdRule: "round", rhRule: "round" },
  tdBias = 0,
  sensorNoise = 0.03,
  extendedEvery = 1,
} = {}) {
  const rng = mulberry32(seed);
  const frames = [];
  let arT = 0,
    arRH = 0;
  const t0 = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i += 1) {
    const tMin = (i * dtMs) / 60000;
    const diurnal = 16 + 6 * Math.sin((2 * Math.PI * (tMin - 300)) / 1440);
    arT = 0.995 * arT + 0.05 * gauss(rng);
    const T = diurnal + arT;
    const rhBase = 95 - 3.2 * (T - 8);
    arRH = 0.99 * arRH + 0.5 * gauss(rng);
    const RH = Math.min(98, Math.max(20, rhBase + arRH));
    const Td = magnusTd(T, RH) + tdBias;
    const frame = {
      screenTimeUtc: t0 + i * dtMs,
      currentTempC: QRULES[rules.tRule].q(T + sensorNoise * gauss(rng)),
    };
    if (i % extendedEvery === 0) {
      frame.dewpointC = QRULES[rules.tdRule].q(Td + sensorNoise * gauss(rng));
      frame.humidityPercent = QRULES[rules.rhRule].q(
        Math.min(98, Math.max(20, RH + 3 * sensorNoise * gauss(rng))),
      );
    }
    frames.push(frame);
  }
  return frames;
}

// ---------- Joint grid HMM ----------
export function validateFrames(frames, { requireStrictTimes = true } = {}) {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new RangeError("At least one TDZ frame is required.");
  }
  let previousTime = -Infinity;
  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i];
    if (
      !Number.isFinite(f?.screenTimeUtc) ||
      !Number.isFinite(f?.currentTempC)
    ) {
      throw new TypeError(
        `Frame ${i} requires finite screenTimeUtc and currentTempC.`,
      );
    }
    if (requireStrictTimes && f.screenTimeUtc <= previousTime) {
      throw new RangeError(
        `Frame times must be strictly increasing (index ${i}).`,
      );
    }
    previousTime = f.screenTimeUtc;
    const haveTd = Number.isFinite(f.dewpointC);
    const haveRh = Number.isFinite(f.humidityPercent);
    if (haveTd !== haveRh) {
      throw new TypeError(
        `Frame ${i} must provide dew point and humidity together.`,
      );
    }
    if (haveRh && !(f.humidityPercent > 0 && f.humidityPercent <= 100)) {
      throw new RangeError(`Frame ${i} humidity is outside (0, 100].`);
    }
  }
  return frames;
}

function validateGridOptions({ tStep, rhStep, tPad, rhPad }) {
  for (const [name, value] of Object.entries({ tStep, rhStep, tPad, rhPad })) {
    if (!Number.isFinite(value) || !(value > 0)) {
      throw new RangeError(`${name} must be a finite positive number.`);
    }
  }
  for (const [name, step] of Object.entries({ tStep, rhStep })) {
    const scale = Math.round(1 / step);
    if (scale < 1 || Math.abs(1 / scale - step) > 1e-12) {
      throw new RangeError(`${name} must be the reciprocal of an integer.`);
    }
  }
}

export function makeGrid(frames, options = {}) {
  validateFrames(frames);
  const { tStep, rhStep, tPad, rhPad } = {
    ...DEFAULT_GRID_OPTIONS,
    ...options,
  };
  validateGridOptions({ tStep, rhStep, tPad, rhPad });
  const ts = frames.map((f) => f.currentTempC);
  const rhs = frames
    .filter((f) => Number.isFinite(f.humidityPercent))
    .map((f) => f.humidityPercent);
  const tMin = Math.min(...ts) - tPad;
  const tMax = Math.max(...ts) + 1 + tPad;
  const rhMin = Math.max(2, (rhs.length ? Math.min(...rhs) : 30) - rhPad);
  const rhMax = Math.min(100, (rhs.length ? Math.max(...rhs) + 1 : 95) + rhPad);
  // Cell CENTERS deliberately offset half a step from the box boundaries of
  // both rule hypotheses, built by exact integer arithmetic. Accumulating
  // `v += 0.1` drifts, and boundary-aligned points fall inside boxes
  // inconsistently between hypotheses — that alignment artifact alone
  // produced multi-logL spurious preferences before this fix.
  const tGrid = [],
    rhGrid = [];
  const tScale = Math.round(1 / tStep);
  const tFirst = Math.ceil(tMin * tScale - 0.5);
  const tLast = Math.floor(tMax * tScale - 0.5);
  for (let k = tFirst; k <= tLast; k += 1) {
    tGrid.push((k + 0.5) / tScale);
  }
  const rScale = Math.round(1 / rhStep);
  const rhFirst = Math.ceil(rhMin * rScale - 0.5);
  const rhLast = Math.floor(rhMax * rScale - 0.5);
  for (let k = rhFirst; k <= rhLast; k += 1) {
    rhGrid.push((k + 0.5) / rScale);
  }
  if (!tGrid.length || !rhGrid.length)
    throw new RangeError("Grid is empty after applying bounds.");
  // Dew point at cell centers, used only by the broad contamination component.
  // The main Td likelihood is an inverse-Magnus area integral over each cell.
  const td = new Float64Array(tGrid.length * rhGrid.length);
  for (let i = 0; i < tGrid.length; i += 1) {
    for (let j = 0; j < rhGrid.length; j += 1) {
      const idx = i * rhGrid.length + j;
      const T = tGrid[i],
        RH = rhGrid[j];
      td[idx] = magnusTd(T, RH);
    }
  }
  return {
    tGrid,
    rhGrid,
    td,
    tStep,
    rhStep,
    options: { tStep, rhStep, tPad, rhPad },
  };
}

function axisKernel(step, sigma, maxHalfWidthCells = 60) {
  const half = Math.min(
    maxHalfWidthCells,
    Math.max(1, Math.ceil((4 * sigma) / step)),
  );
  const k = new Float64Array(2 * half + 1);
  let s = 0;
  for (let d = -half; d <= half; d += 1) {
    const x = d * step;
    k[d + half] = Math.exp(-(x * x) / (2 * sigma * sigma));
    s += k[d + half];
  }
  for (let i = 0; i < k.length; i += 1) k[i] /= s;
  return { k, half };
}

function convolveAxis(belief, nT, nRH, kernel, alongT) {
  const { k, half } = kernel;
  const out = new Float64Array(belief.length);
  if (alongT) {
    for (let j = 0; j < nRH; j += 1) {
      for (let s = 0; s < nT; s += 1) {
        const lo = Math.max(0, s - half),
          hi = Math.min(nT - 1, s + half);
        let norm = 0;
        for (let i = lo; i <= hi; i += 1) norm += k[i - s + half];
        const source = belief[s * nRH + j] / norm;
        for (let i = lo; i <= hi; i += 1) {
          out[i * nRH + j] += source * k[i - s + half];
        }
      }
    }
  } else {
    for (let i = 0; i < nT; i += 1) {
      const base = i * nRH;
      for (let s = 0; s < nRH; s += 1) {
        const lo = Math.max(0, s - half),
          hi = Math.min(nRH - 1, s + half);
        let norm = 0;
        for (let j = lo; j <= hi; j += 1) norm += k[j - s + half];
        const source = belief[base + s] / norm;
        for (let j = lo; j <= hi; j += 1)
          out[base + j] += source * k[j - s + half];
      }
    }
  }
  return out;
}

// Per-channel observation probability via the analytic overlap fraction of
// each grid CELL with the hypothesis box, not a point test at the cell
// center. Point tests are alignment-fragile: whenever cell centers land on
// one rule's box edges but inside the other's, the likelihood comparison
// acquires a structural bias that has nothing to do with the data (this
// exact artifact produced systematic wrong-rule wins before the fix). The
// overlap fraction is exact for the axis channels and alignment-invariant.
function overlapFraction(cellCenter, halfSpan, lo, hi) {
  const overlap =
    Math.min(hi, cellCenter + halfSpan) - Math.max(lo, cellCenter - halfSpan);
  return Math.max(0, overlap) / (2 * halfSpan);
}
function channelVec(
  gridValues,
  step,
  display,
  rule,
  { eps = 0.01, broad = 2.5 } = {},
) {
  const lo = QRULES[rule].lo(display),
    hi = QRULES[rule].hi(display);
  const center = (lo + hi) / 2;
  const half = step / 2;
  const v = new Float64Array(gridValues.length);
  for (let i = 0; i < gridValues.length; i += 1) {
    const x = gridValues[i];
    const frac = overlapFraction(x, half, lo, hi);
    const inBroad = Math.abs(x - center) <= broad;
    v[i] = (1 - eps) * frac + (inBroad ? eps / (2 * broad) : 0) + 1e-9;
  }
  return v;
}

// Forward filter over the joint grid. Returns the total log marginal
// likelihood plus the per-frame predictive log terms (for block stability),
// and optionally the source-time forward-filtered mean/quantiles per frame
// under this fixed model. Any later full-sample model selection is separate.
export function sequenceLogLikelihood(
  frames,
  {
    grid,
    rules,
    tdBias = 0,
    sigmaTPerSqrtMin = DEFAULT_DYNAMICS.sigmaTPerSqrtMin,
    sigmaRHPerSqrtMin = DEFAULT_DYNAMICS.sigmaRHPerSqrtMin,
    eps = DEFAULT_DYNAMICS.eps,
    wantFiltered = false,
  } = {},
) {
  validateFrames(frames);
  if (!grid?.tGrid?.length || !grid?.rhGrid?.length)
    throw new TypeError("A non-empty grid is required.");
  for (const name of [rules?.tRule, rules?.tdRule, rules?.rhRule]) {
    if (!QRULES[name]) throw new RangeError(`Unknown quantizer rule: ${name}`);
  }
  if (
    ![tdBias, sigmaTPerSqrtMin, sigmaRHPerSqrtMin, eps].every(Number.isFinite)
  ) {
    throw new TypeError(
      "Bias, dynamics, and contamination settings must be finite.",
    );
  }
  if (
    !(sigmaTPerSqrtMin > 0) ||
    !(sigmaRHPerSqrtMin > 0) ||
    eps < 0 ||
    eps >= 1
  ) {
    throw new RangeError(
      "Dynamics must be positive and eps must be in [0, 1).",
    );
  }
  const { tGrid, rhGrid, td, tStep, rhStep } = grid;
  const nT = tGrid.length,
    nRH = rhGrid.length,
    S = nT * nRH;
  const kernelCache = new Map();
  const tdChannelCache = new Map();
  const kernelsFor = (dtMin) => {
    const key = Math.min(15, Math.max(0.5, Math.round(dtMin * 2) / 2));
    if (!kernelCache.has(key)) {
      kernelCache.set(key, {
        kT: axisKernel(tStep, sigmaTPerSqrtMin * Math.sqrt(key)),
        kRH: axisKernel(rhStep, sigmaRHPerSqrtMin * Math.sqrt(key)),
      });
    }
    return kernelCache.get(key);
  };
  const tdChannelFor = (display) => {
    const key = `${display}|${rules.tdRule}|${tdBias}|${eps}`;
    if (tdChannelCache.has(key)) return tdChannelCache.get(key);
    const lo = QRULES[rules.tdRule].lo(display) - tdBias;
    const hi = QRULES[rules.tdRule].hi(display) - tdBias;
    const center = (lo + hi) / 2;
    const vec = new Float64Array(S);
    for (let i = 0; i < nT; i += 1) {
      const base = i * nRH;
      for (let j = 0; j < nRH; j += 1) {
        const idx = base + j;
        const frac = tdCellOverlapFraction(
          tGrid[i],
          rhGrid[j],
          tStep,
          rhStep,
          lo,
          hi,
        );
        const inBroad = Math.abs(td[idx] - center) <= 2.5;
        vec[idx] = (1 - eps) * frac + (inBroad ? eps / 5 : 0) + 1e-12;
      }
    }
    tdChannelCache.set(key, vec);
    return vec;
  };

  let belief = new Float64Array(S).fill(1 / S);
  let logL = 0;
  const perFrame = [];
  const filtered = [];

  for (let n = 0; n < frames.length; n += 1) {
    const f = frames[n];
    if (n > 0) {
      const dtMin = (f.screenTimeUtc - frames[n - 1].screenTimeUtc) / 60000;
      const { kT, kRH } = kernelsFor(dtMin);
      belief = convolveAxis(belief, nT, nRH, kT, true);
      belief = convolveAxis(belief, nT, nRH, kRH, false);
      if (dtMin > 15) {
        // Long gap: exponentially forget the pre-gap state. Unlike the former
        // 0.5 cap, this approaches a full reset as the unobserved gap grows.
        const mix = 1 - Math.exp(-(dtMin - 15) / 15);
        for (let i = 0; i < S; i += 1)
          belief[i] = (1 - mix) * belief[i] + mix / S;
      }
    }
    const tVec = channelVec(tGrid, tStep, f.currentTempC, rules.tRule, { eps });
    const haveExt =
      Number.isFinite(f.dewpointC) && Number.isFinite(f.humidityPercent);
    let rhVec = null,
      tdVec = null;
    if (haveExt) {
      rhVec = channelVec(rhGrid, rhStep, f.humidityPercent, rules.rhRule, {
        eps,
        broad: 6,
      });
      tdVec = tdChannelFor(f.dewpointC);
    }
    let predictive = 0;
    for (let i = 0; i < nT; i += 1) {
      const tl = tVec[i];
      const base = i * nRH;
      for (let j = 0; j < nRH; j += 1) {
        let like = tl;
        if (haveExt) {
          const idx = base + j;
          like *= tdVec[idx] * rhVec[j];
        }
        const w = belief[base + j] * like;
        belief[base + j] = w;
        predictive += w;
      }
    }
    if (!(predictive > 0) || !Number.isFinite(predictive)) {
      throw new RangeError(`Non-finite predictive probability at frame ${n}.`);
    }
    logL += Math.log(predictive);
    perFrame.push({ t: f.screenTimeUtc, logp: Math.log(predictive) });
    for (let i = 0; i < S; i += 1) belief[i] /= predictive;
    if (wantFiltered) {
      let mean = 0;
      const tMarg = new Float64Array(nT);
      for (let i = 0; i < nT; i += 1) {
        let m = 0;
        for (let j = 0; j < nRH; j += 1) m += belief[i * nRH + j];
        tMarg[i] = m;
        mean += m * tGrid[i];
      }
      let acc = 0,
        p10 = tGrid[0],
        p90 = tGrid[nT - 1],
        seen10 = false,
        seen90 = false;
      for (let i = 0; i < nT; i += 1) {
        acc += tMarg[i];
        if (!seen10 && acc >= 0.1) {
          p10 = tGrid[i];
          seen10 = true;
        }
        if (!seen90 && acc >= 0.9) {
          p90 = tGrid[i];
          seen90 = true;
        }
      }
      filtered.push({ t: f.screenTimeUtc, mean: +mean.toFixed(3), p10, p90 });
    }
  }
  return { logL, perFrame, filtered: wantFiltered ? filtered : null };
}

// ---------- Identification ----------
export const DEFAULT_COMBOS = Object.freeze(
  ["round", "floor"].flatMap((tRule) =>
    ["round", "floor"].flatMap((tdRule) =>
      ["round", "floor"].map((rhRule) =>
        Object.freeze({ tRule, tdRule, rhRule }),
      ),
    ),
  ),
);

const roundForOutput = (x, digits = 4) => +x.toFixed(digits);
const logSumExp = (xs) => {
  const m = Math.max(...xs);
  return m + Math.log(xs.reduce((sum, x) => sum + Math.exp(x - m), 0));
};

function resolveBiasModel(biasGrid) {
  const values = [...biasGrid].sort((a, b) => a - b);
  if (!values.length || values.some((x) => !Number.isFinite(x))) {
    throw new RangeError("biasGrid must contain finite values.");
  }
  if (new Set(values).size !== values.length)
    throw new RangeError("biasGrid values must be unique.");
  if (values.length === 1) return { values, weights: [1] };
  const rawWeights = values.map((_, i) => {
    if (i === 0) return (values[1] - values[0]) / 2;
    if (i === values.length - 1) return (values[i] - values[i - 1]) / 2;
    return (values[i + 1] - values[i - 1]) / 2;
  });
  if (rawWeights.some((x) => !(x > 0)))
    throw new RangeError("biasGrid must be strictly increasing.");
  const total = rawWeights.reduce((sum, x) => sum + x, 0);
  return { values, weights: rawWeights.map((x) => x / total) };
}

function mixturePredictiveFrames(components) {
  if (!components.length) return [];
  const cumulative = new Float64Array(components.length);
  let previousLogEvidence = logSumExp(
    components.map((c) => Math.log(c.priorWeight)),
  );
  const out = [];
  for (let n = 0; n < components[0].perFrame.length; n += 1) {
    for (let m = 0; m < components.length; m += 1)
      cumulative[m] += components[m].perFrame[n].logp;
    const logEvidence = logSumExp(
      components.map((c, m) => Math.log(c.priorWeight) + cumulative[m]),
    );
    out.push({
      t: components[0].perFrame[n].t,
      logp: logEvidence - previousLogEvidence,
    });
    previousLogEvidence = logEvidence;
  }
  return out;
}

function blockComparison(first, second, blockMs) {
  const byBlock = new Map();
  const secondByTime = new Map(second.perFrame.map((p) => [p.t, p.logp]));
  for (const p of first.perFrame) {
    const other = secondByTime.get(p.t);
    if (other === undefined) continue;
    const block = Math.floor(p.t / blockMs);
    byBlock.set(block, (byBlock.get(block) ?? 0) + p.logp - other);
  }
  const margins = [...byBlock.values()];
  if (!margins.length) return null;
  return {
    comparison: `${first.family ?? "first"} vs ${second.family ?? "second"}`,
    note: "descriptive contributions from dependent forward filters; not independent replicates",
    blockCount: margins.length,
    blocksFavoringWinner: margins.filter((m) => m > 0).length,
    meanBlockMargin: roundForOutput(
      margins.reduce((s, x) => s + x, 0) / margins.length,
      3,
    ),
    minBlockMargin: roundForOutput(Math.min(...margins), 3),
  };
}

function familySummary(comboResults, familyOf, blockMs) {
  const groups = new Map();
  for (const result of comboResults) {
    const family = familyOf(result.rules);
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family).push(result);
  }
  const internal = [...groups.entries()]
    .map(([family, members]) => {
      const priorWeight = 1 / members.length;
      return {
        family,
        logEvidence:
          logSumExp(members.map((m) => m.logEvidence)) -
          Math.log(members.length),
        perFrame: mixturePredictiveFrames(
          members.map((m) => ({
            priorWeight,
            perFrame: m.perFrame,
          })),
        ),
      };
    })
    .sort((a, b) => b.logEvidence - a.logEvidence);
  const normalizer = logSumExp(internal.map((x) => x.logEvidence));
  const entries = internal.map((x) => ({
    family: x.family,
    logEvidence: roundForOutput(x.logEvidence),
    posteriorProbability: roundForOutput(
      Math.exp(x.logEvidence - normalizer),
      6,
    ),
  }));
  return {
    entries,
    deltaLogEvidence:
      internal.length > 1
        ? roundForOutput(internal[0].logEvidence - internal[1].logEvidence)
        : null,
    blocks:
      internal.length > 1
        ? blockComparison(internal[0], internal[1], blockMs)
        : null,
  };
}

export function buildModelSpec({
  gridOpts = {},
  dyn = {},
  biasGrid = DEFAULT_BIAS_GRID,
  combos = DEFAULT_COMBOS,
  blockMs = DEFAULT_BLOCK_MS,
  plausibleDeltaLogL = PLAUSIBLE_MODEL_DELTA_LOGL,
} = {}) {
  const bias = resolveBiasModel(biasGrid);
  return {
    modelVersion: MODEL_VERSION,
    likelihood: "finite-grid approximate sequence marginal likelihood",
    transitionBoundary:
      "truncated Gaussian kernel renormalized per source cell",
    longGapPolicy:
      "transition variance capped at 15 min, then exponential mixing toward uniform with 15 min time constant",
    tdCellObservation: `inverse-Magnus ${QUADRATURE_PANELS}x${QUADRATURE_ORDER}-point composite Gauss-Legendre area integration`,
    gridOpts: { ...DEFAULT_GRID_OPTIONS, ...gridOpts },
    dynamics: { ...DEFAULT_DYNAMICS, ...dyn },
    biasGrid: bias.values,
    biasWeights: bias.weights,
    biasModel: {
      interpretation:
        "discrete quadrature approximation to a continuous-uniform additive Td formula bias",
      values: bias.values,
      weights: bias.weights,
    },
    combos: combos.map((r) => ({ ...r })),
    blockMs,
    plausibleDeltaLogL,
  };
}

export function identifyQuantizer(
  frames,
  {
    combos = DEFAULT_COMBOS,
    biasGrid = DEFAULT_BIAS_GRID,
    gridOpts = {},
    dyn = {},
    blockMs = DEFAULT_BLOCK_MS,
  } = {},
) {
  validateFrames(frames);
  if (!Array.isArray(combos) || combos.length < 2)
    throw new RangeError("At least two rule combinations are required.");
  const comboKeys = combos.map((r) => `${r.tRule}/${r.tdRule}/${r.rhRule}`);
  if (new Set(comboKeys).size !== comboKeys.length)
    throw new RangeError("Rule combinations must be unique.");
  if (!Number.isFinite(blockMs) || !(blockMs > 0))
    throw new RangeError("blockMs must be positive.");
  const bias = resolveBiasModel(biasGrid);
  const grid = makeGrid(frames, gridOpts);
  const results = [];
  const allModels = [];
  for (const rules of combos) {
    let best = null;
    const biasRuns = [];
    for (let b = 0; b < bias.values.length; b += 1) {
      const tdBias = bias.values[b];
      const r = sequenceLogLikelihood(frames, { grid, rules, tdBias, ...dyn });
      if (!best || r.logL > best.logL) best = { tdBias, ...r };
      const model = { rules, tdBias, priorWeight: bias.weights[b], ...r };
      biasRuns.push(model);
      allModels.push(model);
    }
    const logEvidence = logSumExp(
      biasRuns.map((r) => r.logL + Math.log(r.priorWeight)),
    );
    results.push({
      rules,
      tdBias: best.tdBias,
      logL: best.logL,
      logEvidence,
      perFrame: mixturePredictiveFrames(biasRuns),
    });
  }
  results.sort((a, b) => b.logEvidence - a.logEvidence);
  const comboNormalizer = logSumExp(results.map((r) => r.logEvidence));
  const modelNormalizer = logSumExp(
    allModels.map(
      (m) => m.logL + Math.log(m.priorWeight) - Math.log(combos.length),
    ),
  );
  allModels.sort((a, b) => b.logL - a.logL);
  const blocks = blockComparison(results[0], results[1], blockMs);
  const familyEvidence = {
    temperatureRule: familySummary(results, (r) => r.tRule, blockMs),
    tTdRelationship: familySummary(
      results,
      (r) => (r.tRule === r.tdRule ? "shared" : "mixed"),
      blockMs,
    ),
    humidityRule: familySummary(results, (r) => r.rhRule, blockMs),
  };
  return {
    ranking: results.map(({ rules, tdBias, logL, logEvidence }) => ({
      rules,
      tdBias,
      logL: roundForOutput(logL),
      logEvidence: roundForOutput(logEvidence),
      posteriorProbability: roundForOutput(
        Math.exp(logEvidence - comboNormalizer),
        6,
      ),
    })),
    modelRanking: allModels.map(({ rules, tdBias, logL, priorWeight }) => ({
      rules,
      tdBias,
      logL: roundForOutput(logL),
      biasPriorWeight: priorWeight,
      posteriorProbability: roundForOutput(
        Math.exp(
          logL +
            Math.log(priorWeight) -
            Math.log(combos.length) -
            modelNormalizer,
        ),
        8,
      ),
    })),
    deltaLogEvidence: roundForOutput(
      results[0].logEvidence - results[1].logEvidence,
    ),
    // Backward-compatible alias. This is now an evidence margin, not a
    // profile-likelihood margin.
    deltaLogL: roundForOutput(results[0].logEvidence - results[1].logEvidence),
    blocks,
    familyEvidence,
    modelSpec: buildModelSpec({ gridOpts, dyn, biasGrid, combos, blockMs }),
  };
}

// ---------- Numerical-safety suite ----------
// This suite is a regression barrier against decisively wrong numerical
// conclusions. An undecided result passes because this is deliberately not
// advertised as an identifiability or accuracy validation.
export const DECISIVE_LOGL = 10;

export function runNumericalSafetySuite({
  n = 180,
  seeds = [11, 29],
  quiet = false,
  biasGrid = [-0.5, -0.15, 0, 0.15, 0.5],
  includePositiveControls = biasGrid.length > 1,
} = {}) {
  const cases = seeds.flatMap((seed) =>
    DEFAULT_COMBOS.map((rules) => ({
      name: `${rules.tRule}/${rules.tdRule}/${rules.rhRule}@${seed}`,
      rules,
      truth: rules,
      seed,
      tdBias: 0,
    })),
  );
  const outcomes = [];
  for (const c of cases) {
    const frames = synthesizeFrames({
      n,
      seed: c.seed,
      rules: c.rules,
      tdBias: c.tdBias,
    });
    const id = identifyQuantizer(frames, {
      biasGrid,
      gridOpts: { tStep: 0.1, rhStep: 0.5 },
    });
    const top = id.ranking[0].rules;
    const topCorrect =
      top.tRule === c.rules.tRule &&
      top.tdRule === c.rules.tdRule &&
      top.rhRule === c.rules.rhRule;
    const familyTruth = {
      temperatureRule: c.rules.tRule,
      tTdRelationship: c.rules.tRule === c.rules.tdRule ? "shared" : "mixed",
      humidityRule: c.rules.rhRule,
    };
    let decisiveCorrect = false;
    let decisiveWrong = false;
    const familyChecks = {};
    for (const [question, truth] of Object.entries(familyTruth)) {
      const summary = id.familyEvidence[question];
      const decisive = summary.deltaLogEvidence >= DECISIVE_LOGL;
      const winner = summary.entries[0].family;
      familyChecks[question] = {
        truth,
        winner,
        decisive,
        deltaLogEvidence: summary.deltaLogEvidence,
      };
      if (decisive && winner === truth) decisiveCorrect = true;
      if (decisive && winner !== truth) decisiveWrong = true;
    }
    const verdict = decisiveWrong
      ? "DECISIVE-WRONG"
      : decisiveCorrect
        ? "decisive-correct"
        : "undecided";
    const pass = verdict !== "DECISIVE-WRONG";
    outcomes.push({
      name: c.name,
      truth: c.truth,
      seed: c.seed,
      tdBias: c.tdBias,
      verdict,
      pass,
      topCorrect,
      deltaLogEvidence: id.deltaLogEvidence,
      top,
      familyChecks,
    });
    if (!quiet) {
      console.log(
        `  ${c.name.padEnd(26)} -> ${verdict} (top ${top.tRule}/${top.tdRule}/${top.rhRule}${topCorrect ? " = truth" : ""}, combo evidence margin ${id.deltaLogEvidence})`,
      );
    }
  }
  // Broad bias support is intentionally close to non-identifiable, so those
  // cases may all return the honest "undecided" verdict. Matched fixed-bias
  // controls prove the implementation still has rule-specific discriminating
  // power; otherwise an always-tied implementation could pass vacuously.
  if (includePositiveControls) {
    const controls = runNumericalSafetySuite({
      n: Math.min(n, 72),
      seeds: [seeds[0]],
      quiet: true,
      biasGrid: [0],
      includePositiveControls: false,
    });
    for (const outcome of controls) {
      outcomes.push({
        ...outcome,
        name: `fixed-bias-control:${outcome.name}`,
      });
    }
  }
  return outcomes;
}

export const runRecoverySuite = runNumericalSafetySuite;
export const numericalSafetyGatePassed = (outcomes) =>
  Array.isArray(outcomes) &&
  outcomes.length > 0 &&
  outcomes.every((o) => o.pass === true) &&
  outcomes.some((o) => o.verdict === "decisive-correct");

export function buildRobustEnvelope(runs, modelWeights = null) {
  if (
    !Array.isArray(runs) ||
    runs.length === 0 ||
    runs.some((r) => !Array.isArray(r))
  ) {
    throw new TypeError(
      "Robust envelope requires one or more filtered-model arrays.",
    );
  }
  const length = runs[0].length;
  if (!length || runs.some((r) => r.length !== length)) {
    throw new RangeError(
      "Filtered-model arrays must have the same non-zero length.",
    );
  }
  const weights =
    modelWeights == null
      ? new Array(runs.length).fill(1 / runs.length)
      : [...modelWeights];
  if (
    weights.length !== runs.length ||
    weights.some((w) => !Number.isFinite(w) || w < 0)
  ) {
    throw new RangeError(
      "Model weights must be finite, non-negative, and match the runs.",
    );
  }
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (!(totalWeight > 0))
    throw new RangeError("At least one model weight must be positive.");
  for (let i = 0; i < weights.length; i += 1) weights[i] /= totalWeight;
  return runs[0].map((point, i) => {
    const atTime = runs.map((r) => r[i]);
    if (atTime.some((p) => p.t !== point.t))
      throw new RangeError(`Filtered timestamps differ at index ${i}.`);
    return {
      t: point.t,
      modelWeightedMean: roundForOutput(
        atTime.reduce((sum, p, m) => sum + weights[m] * p.mean, 0),
        3,
      ),
      conditionalP10Envelope: Math.min(...atTime.map((p) => p.p10)),
      conditionalP90Envelope: Math.max(...atTime.map((p) => p.p90)),
    };
  });
}

function scriptManifest() {
  const raw = fs.readFileSync(new URL(import.meta.url));
  return {
    modelVersion: MODEL_VERSION,
    sha256: createHash("sha256").update(raw).digest("hex"),
    bytes: raw.length,
  };
}

// ---------- Data + manifest ----------
export function loadFrames(paths, tdz) {
  if (!Array.isArray(paths) || paths.length === 0)
    throw new RangeError("At least one input dump is required.");
  const all = [];
  const inputs = [];
  let incompleteAuxiliaryPairsDiscarded = 0;
  for (const p of paths) {
    const raw = fs.readFileSync(p);
    inputs.push({
      path: p,
      sha256: createHash("sha256").update(raw).digest("hex"),
      bytes: raw.length,
    });
    const j = JSON.parse(raw.toString("utf8"));
    for (const row of j.capma?.rows ?? []) {
      if (row.tdz !== tdz) continue;
      const haveTd = Number.isFinite(row.dewpointC);
      const haveRh = Number.isFinite(row.humidityPercent);
      if (haveTd === haveRh) {
        all.push(row);
        continue;
      }
      // Production retention can contain just one auxiliary field. Magnus
      // requires the Td/RH pair, so discard both auxiliaries explicitly while
      // retaining the independently valid temperature observation.
      const temperatureOnly = { ...row };
      delete temperatureOnly.dewpointC;
      delete temperatureOnly.humidityPercent;
      all.push(temperatureOnly);
      incompleteAuxiliaryPairsDiscarded += 1;
    }
  }
  const seen = new Set();
  const unique = all
    .filter((r) => {
      const identity =
        r.rawHash ??
        `${r.tdz}|${r.screenTimeUtc}|${r.currentTempC}|${r.dewpointC}|${r.humidityPercent}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .sort((a, b) => a.screenTimeUtc - b.screenTimeUtc);
  const frames = [];
  for (const row of unique) {
    const previous = frames.at(-1);
    if (!previous || row.screenTimeUtc !== previous.screenTimeUtc) {
      frames.push(row);
      continue;
    }
    const sameTemperature = row.currentTempC === previous.currentTempC;
    const rowExtended =
      Number.isFinite(row.dewpointC) && Number.isFinite(row.humidityPercent);
    const previousExtended =
      Number.isFinite(previous.dewpointC) &&
      Number.isFinite(previous.humidityPercent);
    const extendedConflict =
      rowExtended &&
      previousExtended &&
      (row.dewpointC !== previous.dewpointC ||
        row.humidityPercent !== previous.humidityPercent);
    if (!sameTemperature || extendedConflict) {
      throw new RangeError(
        `Conflicting frames share screenTimeUtc=${row.screenTimeUtc}.`,
      );
    }
    // Benign duplicate source timestamps are collapsed deterministically,
    // preferring the row that retained both extended channels.
    if (rowExtended && !previousExtended) frames[frames.length - 1] = row;
  }
  validateFrames(frames);
  return {
    frames,
    inputs,
    normalization: { incompleteAuxiliaryPairsDiscarded },
  };
}

// ---------- CLI ----------
export function runCli(argv = process.argv.slice(2), io = {}) {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const loadFramesFn = io.loadFramesFn ?? loadFrames;
  const safetySuiteFn = io.safetySuiteFn ?? runNumericalSafetySuite;
  try {
    const [mode, ...rest] = argv;
    if (
      !mode ||
      !["synthetic", "safety", "identify", "estimate"].includes(mode)
    ) {
      error(
        "Usage: tdz-quantizer-id.mjs safety|identify|estimate <dump.json...> [--tdz 05] [--out result.json]",
      );
      return 2;
    }
    const flagValue = (name, fallback) => {
      const i = rest.indexOf(name);
      if (i < 0) return fallback;
      if (i + 1 >= rest.length || rest[i + 1].startsWith("--"))
        throw new Error(`${name} requires a value.`);
      return rest[i + 1];
    };
    const valueFlags = new Set(["--tdz", "--out"]);
    const paths = [];
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (valueFlags.has(arg)) {
        i += 1;
        continue;
      }
      if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
      paths.push(arg);
    }

    if (mode === "synthetic" || mode === "safety") {
      log(
        "== numerical-safety suite (not an identifiability or accuracy validation)",
      );
      const outcomes = safetySuiteFn({});
      const passed = numericalSafetyGatePassed(outcomes);
      const failed = outcomes.filter((o) => !o.pass);
      log(
        passed
          ? "NUMERICAL SAFETY GATE PASSED"
          : `NUMERICAL SAFETY GATE FAILED: ${failed.map((f) => f.name).join(", ")}`,
      );
      return passed ? 0 : 1;
    }

    log("== required numerical-safety gate");
    const safetyOutcomes = safetySuiteFn({ quiet: true });
    const safetyGatePassed = numericalSafetyGatePassed(safetyOutcomes);
    if (!safetyGatePassed) {
      error(
        `Numerical safety gate failed; live ${mode} is blocked. Failures: ${safetyOutcomes
          .filter((o) => !o.pass)
          .map((o) => o.name)
          .join(", ")}`,
      );
      return 1;
    }
    log(
      "  passed; this excludes known numerical artifacts but does not validate identifiability",
    );

    const tdz = flagValue("--tdz", "05");
    const outPath = flagValue("--out", null);
    const {
      frames,
      inputs,
      normalization = { incompleteAuxiliaryPairsDiscarded: 0 },
    } = loadFramesFn(paths, tdz);
    validateFrames(frames);
    log(
      `TDZ${tdz}: ${frames.length} frames from ${inputs.length} input file(s)`,
    );
    if (normalization.incompleteAuxiliaryPairsDiscarded > 0) {
      log(
        `  retained ${normalization.incompleteAuxiliaryPairsDiscarded} temperature-only frame(s) after discarding incomplete Td/RH auxiliary pairs`,
      );
    }

    log(
      "\n== quantizer identification by finite-grid approximate marginal evidence",
    );
    const id = identifyQuantizer(frames, {});
    for (const r of id.ranking) {
      log(
        `  ${r.rules.tRule}/${r.rules.tdRule}/${r.rules.rhRule} (profile bias ${r.tdBias >= 0 ? "+" : ""}${r.tdBias}) -> log evidence ${r.logEvidence}, posterior ${r.posteriorProbability}`,
      );
    }
    for (const [question, summary] of Object.entries(id.familyEvidence)) {
      log(
        `  family ${question}: ${summary.entries.map((x) => `${x.family}=${x.posteriorProbability}`).join(", ")} (delta ${summary.deltaLogEvidence} log evidence)`,
      );
    }
    log(
      "  Family probabilities and block contributions are model-conditional; they do not identify a software formatter code path.",
    );

    const commonOutput = {
      generatedAt: new Date().toISOString(),
      script: scriptManifest(),
      cli: { argv: [...argv] },
      tdz,
      inputs,
      frameCount: frames.length,
      inputNormalization: normalization,
      numericalSafetyGate: {
        passed: safetyGatePassed,
        meaning:
          "regression safety only; not identifiability or accuracy validation",
        outcomes: safetyOutcomes,
      },
      identification: id,
    };

    if (mode === "identify" && outPath) {
      fs.writeFileSync(outPath, JSON.stringify(commonOutput, null, 1));
      log(
        `  wrote ${outPath} with input and script SHA-256 manifests plus resolved model configuration`,
      );
    }

    if (mode === "estimate") {
      const maxLogL = id.modelRanking[0].logL;
      const plausibleModels = id.modelRanking.filter(
        (model) => maxLogL - model.logL <= PLAUSIBLE_MODEL_DELTA_LOGL,
      );
      const grid = makeGrid(frames, id.modelSpec.gridOpts);
      log(
        `\n== source-time forward-filtered robust envelope over ${plausibleModels.length} quantizer/bias models within ${PLAUSIBLE_MODEL_DELTA_LOGL} logL of the best`,
      );
      log(
        "  model inclusion and model weights use the complete sample; this is retrospective, not a live rolling-origin estimate",
      );
      const runs = plausibleModels.map(
        (model) =>
          sequenceLogLikelihood(frames, {
            grid,
            rules: model.rules,
            tdBias: model.tdBias,
            ...id.modelSpec.dynamics,
            wantFiltered: true,
          }).filtered,
      );
      const filtered = buildRobustEnvelope(
        runs,
        plausibleModels.map((model) => model.posteriorProbability),
      );
      const widths = filtered
        .map((p) => p.conditionalP90Envelope - p.conditionalP10Envelope)
        .sort((a, b) => a - b);
      const q = (p) => widths[Math.floor(p * (widths.length - 1))].toFixed(2);
      log(
        `  envelope width: p25=${q(0.25)} median=${q(0.5)} p75=${q(0.75)}; this envelopes conditional 10-90 bands and is not itself a calibrated 10-90 interval or accuracy`,
      );
      if (outPath) {
        fs.writeFileSync(
          outPath,
          JSON.stringify(
            {
              ...commonOutput,
              estimate: {
                kind: "source-time forward-filtered robust envelope of model-conditional 10-90 bands",
                note: "model set and weights use the complete sample; retrospective, not rolling-origin, not a posterior-mixture 10-90 interval, and not validated accuracy",
                plausibleModelRule: `profile logL within ${PLAUSIBLE_MODEL_DELTA_LOGL} of best`,
                models: plausibleModels,
                filtered,
              },
            },
            null,
            1,
          ),
        );
        log(
          `  wrote ${outPath} with input and script SHA-256 manifests plus resolved model configuration`,
        );
      }
    }
    return 0;
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const isMain =
  process.argv[1] &&
  import.meta.url.endsWith(
    process.argv[1].replace(/\\/g, "/").split("/").pop(),
  );
if (isMain) process.exitCode = runCli();
