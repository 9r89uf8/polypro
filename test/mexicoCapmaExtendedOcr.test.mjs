import assert from "node:assert/strict";
import test from "node:test";

import {
  capmaDewpointTripleIsFeasible,
  capmaMagnusDewpointC,
  capmaOcrTestSupport,
  capmaPressureQnhIsConsistent,
  extractCapmaExtendedFields,
} from "../convex/mexicoCapmaOcr.js";

const { getDigitTemplates, templateWidth, templateHeight } = capmaOcrTestSupport;

const WIDTH = 1366;
const HEIGHT = 768;
// Invisible to every OCR palette predicate: not dark, not yellow, not neutral.
const BACKGROUND = [40, 40, 140];
const YELLOW = [250, 220, 40];

function blankImage() {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
    data[index * 4] = BACKGROUND[0];
    data[index * 4 + 1] = BACKGROUND[1];
    data[index * 4 + 2] = BACKGROUND[2];
    data[index * 4 + 3] = 255;
  }
  return { width: WIDTH, height: HEIGHT, data };
}

function setPixel(image, x, y, [red, green, blue]) {
  const offset = (y * image.width + x) * 4;
  image.data[offset] = red;
  image.data[offset + 1] = green;
  image.data[offset + 2] = blue;
  image.data[offset + 3] = 255;
}

function stampDigit(image, digit, x, y, height) {
  // Preserve the 32x48 template aspect so normalizeComponent reproduces the
  // template silhouette; live glyphs are rendered from the same font.
  const width = Math.round((height * templateWidth) / templateHeight);
  const bits = getDigitTemplates()[digit];
  for (let py = 0; py < height; py += 1) {
    const sourceY = Math.min(
      templateHeight - 1,
      Math.floor(((py + 0.5) * templateHeight) / height),
    );
    for (let px = 0; px < width; px += 1) {
      const sourceX = Math.min(
        templateWidth - 1,
        Math.floor(((px + 0.5) * templateWidth) / width),
      );
      if (bits[sourceY * templateWidth + sourceX]) {
        setPixel(image, x + px, y + py, YELLOW);
      }
    }
  }
}

function stampBlob(image, x, y, width, height) {
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      setPixel(image, x + px, y + py, YELLOW);
    }
  }
}

// Field geometry mirrors live captures of both TDZ displays verified on
// 2026-08-22 (yellow-on-dark night palette and dark-on-light day palette).
function paintExtendedFields(image, { humidityDigits = [8, 1] } = {}) {
  // % HUMEDAD "81 %"
  let humidityX = 170;
  for (const digit of humidityDigits) {
    stampDigit(image, digit, humidityX, 272, 20);
    humidityX += 16;
  }
  stampBlob(image, 211, 272, 9, 10); // percent upper circle
  stampBlob(image, 224, 284, 8, 8); // percent lower circle
  // PRESION "787.3 hPa"
  stampDigit(image, 7, 130, 320, 20);
  stampDigit(image, 8, 145, 320, 20);
  stampDigit(image, 7, 160, 320, 20);
  stampBlob(image, 176, 345, 4, 4); // decimal point
  stampDigit(image, 3, 184, 320, 20);
  // PUNTO DE ROCIO "12 °C"
  stampDigit(image, 1, 373, 360, 46);
  stampDigit(image, 2, 406, 360, 46);
  stampBlob(image, 459, 360, 21, 23); // degree ring
  // QNH "30.45"
  stampDigit(image, 3, 333, 502, 70);
  stampDigit(image, 0, 386, 502, 70);
  stampBlob(image, 442, 558, 14, 13); // decimal point
  stampDigit(image, 4, 464, 504, 66);
  stampDigit(image, 5, 517, 503, 68);
  // 2 min rocio "12 °C"
  stampDigit(image, 1, 164, 608, 20);
  stampDigit(image, 2, 178, 608, 20);
  stampBlob(image, 201, 608, 8, 10); // degree ring
}

test("extended CAPMA OCR reads humidity, pressure, dew point, QNH and 2-min rocio", () => {
  const image = blankImage();
  paintExtendedFields(image);
  const extended = extractCapmaExtendedFields(image, { currentTempC: 15 });

  assert.equal(extended.humidityPercent, 81);
  assert.equal(extended.stationPressureHpa, 787.3);
  assert.equal(extended.dewpointC, 12);
  assert.equal(extended.qnhInHg, 30.45);
  assert.equal(extended.twoMinuteDewpointC, 12);
  for (const key of [
    "humidityConfidence",
    "stationPressureConfidence",
    "dewpointConfidence",
    "qnhConfidence",
    "twoMinuteDewpointConfidence",
  ]) {
    assert.ok(extended[key] >= 0.62, `${key} is ${extended[key]}`);
  }
});

test("extended CAPMA OCR returns nulls on an empty frame instead of throwing", () => {
  const extended = extractCapmaExtendedFields(blankImage(), {
    currentTempC: 15,
  });
  assert.equal(extended.humidityPercent, null);
  assert.equal(extended.stationPressureHpa, null);
  assert.equal(extended.dewpointC, null);
  assert.equal(extended.qnhInHg, null);
  assert.equal(extended.twoMinuteDewpointC, null);
});

test("an infeasible temperature/dew-point/humidity triple drops both implicated fields", () => {
  const image = blankImage();
  paintExtendedFields(image, { humidityDigits: [2, 0] }); // RH 20% with T 15, Td 12
  const extended = extractCapmaExtendedFields(image, { currentTempC: 15 });

  assert.equal(extended.dewpointC, null);
  assert.equal(extended.humidityPercent, null);
  // The pressure pair is independent of the Magnus check.
  assert.equal(extended.stationPressureHpa, 787.3);
  assert.equal(extended.qnhInHg, 30.45);
});

test("Magnus feasibility matches live-verified display triples", () => {
  // Observed live on 2026-08-22/23: (15, 12, 81), (14, 12, 86), (20, 12, 62).
  for (const [t, td, rh] of [
    [15, 12, 81],
    [14, 12, 86],
    [20, 12, 62],
  ]) {
    assert.ok(
      capmaDewpointTripleIsFeasible({
        currentTempC: t,
        dewpointC: td,
        humidityPercent: rh,
      }),
      `expected (${t}, ${td}, ${rh}) to be feasible`,
    );
  }
  assert.ok(
    !capmaDewpointTripleIsFeasible({
      currentTempC: 15,
      dewpointC: 12,
      humidityPercent: 20,
    }),
  );
  // A missing field never blocks the others.
  assert.ok(
    capmaDewpointTripleIsFeasible({
      currentTempC: 15,
      dewpointC: null,
      humidityPercent: 20,
    }),
  );
  // Magnus dew point of saturated air is the temperature itself.
  assert.ok(Math.abs(capmaMagnusDewpointC(15, 100) - 15) < 0.01);
});

test("QNH must match the 0.1 hPa station pressure within tolerance", () => {
  // Observed live pairs.
  for (const [pressure, qnh] of [
    [787.2, 30.44],
    [787.4, 30.45],
    [783.6, 30.31],
  ]) {
    assert.ok(
      capmaPressureQnhIsConsistent({
        stationPressureHpa: pressure,
        qnhInHg: qnh,
      }),
      `expected ${pressure} hPa / ${qnh} inHg to be consistent`,
    );
  }
  assert.ok(
    !capmaPressureQnhIsConsistent({
      stationPressureHpa: 787.3,
      qnhInHg: 30.15,
    }),
  );
  assert.ok(
    capmaPressureQnhIsConsistent({ stationPressureHpa: null, qnhInHg: 30.44 }),
  );
});
