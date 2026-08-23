const TEMPLATE_WIDTH = 32;
const TEMPLATE_HEIGHT = 48;
const MIN_TIMESTAMP_GLYPH_SCORE = 0.55;
const MAX_SCREEN_FUTURE_MS = 15 * 60 * 1000;
const MAX_SCREEN_AGE_MS = 24 * 60 * 60 * 1000;

// Arial Bold digit silhouettes, normalized to 32x48 and packed one bit per
// pixel. The CAPMA legacy AWOS display uses this same fixed Windows font and
// layout. Keeping the templates in-repo makes OCR deterministic and avoids
// sending protected airport screenshots to a third-party vision service.
const DIGIT_TEMPLATE_BASE64 = [
  "AA/wAAB//gAB//+AA///wAf//+AH///gD///8A////gf/B/4H/AP+D/wB/w/4Af8P+AH/D/gA/5/wAP+f8AD/n/AA/5/wAP+f8AD/n/AA/5/wAP+f8AD/n/AA/5/wAP+f8AD/n/AA/5/wAP+f8AD/n/AA/5/wAP+f8AD/j/AA/4/4Af8P+AH/D/wB/wf8A/4H/wf+B////gP///wB///4Af//+AD///AAP//gAB//gAAD/AA",
  "AAAfwAAAP8AAAD/AAAB/wAAAf8AAAf/AAAP/wAAH/8AAH//AAD//wAD//8AD///AA///wAf//8AH///AB/5/wAf8f8AH+H/AB/B/wAfAf8AHAH/ABAB/wAAAf8AAAH/AAAB/wAAAf8AAAH/AAAB/wAAAf8AAAH/AAAB/wAAAf8AAAH/AAAB/wAAAf8AAAH/AAAB/wAAAf8AAAH/AAAB/wAAAf8AAAH/AAAB/wAAAf8AAAH/A",
  "AA/4AAB//wAB///AB///4A////AP///4H////D////w/+B/+P+AH/n/gA/5/wAP+f8AD/n/AA/5/wAH+B4AB/gAAA/4AAAP+AAAD/AAAB/wAAAf8AAAP+AAAH/AAAD/wAAB/4AAB/8AAA/+AAAf/AAAP/gAAP/wAAH/4AAD/8AAB/+AAAf/AAAP/gAAH/gAAB/4AAA/8AAAf+AAAH////j////5////+f////n////7////+/////v////7////+",
  "AD/gAAH//AAD//8AD///gA///8Af///gP///4D////B/8H/wf8Af8H+AD/j/gA/4/wAP+AcAD/gAAA/wAAAf8AAAP/AAAf/gAA//wAAf/4AAH/8AAB/+AAAf/4AAH//gAB//4AAf//AAAD/4AAAP+AAAB/wAAAf8AAAD/AAAA/4AAAP+DwAD/v8AA/7/AAf+/4AH/P+AD/x/wB/8f/A/+H////g////wH///8A///+AH///AA///AAD//AAAH/AA",
  "AAAAAAAAAAAAAB/AAAA/wAAAf8AAAH/AAAD/wAAA/8AAAf/AAAH/wAAD/8AAB//AAAf/wAAP/8AAH//AAB//wAA/v8AAfz/AAP8/wAD/P8AB/j/AA/w/wAP8P8AH+D/AH/A/wB/gP8A/wD/Af4A/wH+AP8D//////////////////////////////////////////wAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAAAAAAAAA",
  "B////Af///wH///8B////Af///wP///8D////A////wP///8D/AAAA/wAAAf8AAAH+AAAB/gAAAf4AAAH+P4AD///wA////AP///4D////A////4P///+H////x/8B/8f/Af/H/AD/4PgAf+AAAD/gAAA/4AAAH/AAAB/wAAAf8PgAH//4AD/v+AA/7/wAP+f8AH/n/gD/x/+B/8P///+D////gf///wD///4Af//8AD//+AAP/+AAAf8AAAAAAA",
  "AA/4AAA//wAA//+AAf//wAf//+AH///wD///+B////gf/B/4P/AH/D/gB/x/4AP8f8ADwH/AAAB/wAAA/4AAAP+AAAD/g/gA/4//AP+//8D////g////8P////D////4////+P////z/+B/8/+AH/P/gA/7/wAP+/8AD/v/AAf7/wAH+/8AB/n/AAf5/wAH+f8AD/n/gA/4/8Af8P/wP/B////wf///4D///8Af//+AD///AAf//gAB//gAAD/gA",
  "//////////////////////////////////////////7////+/////AAAD/gAAA/4AAAf8AAAP+AAAH/AAAB/wAAA/4AAAP+AAAH+AAAD/gAAA/wAAAf4AAAH+AAAD/gAAA/4AAAP8AAAD/AAAB/gAAAf4AAAP+AAAD/AAAA/wAAAf8AAAH+AAAB/gAAAf4AAAf+AAAH/AAAB/wAAAf8AAAH/AAAB/wAAA/8AAAP/AAAD/gAAA/4AAAP+AAAD/gAA",
  "AD/wAAH//gAD//8AD///wB///+Af///gP///8D/wP/B/4A/4f8AP+H+AB/h/gAf4f4AH+H+AB/h/gAf4f8AP+D/gD/A/8D/wH///4A///8AD//8AAf/+AAf//4AP///gD///4B////A/8D/wf+AP+H/AB/z/gAf8/4AD/P8AA/7/AAP+/wAD/v8AA/7/AAP+/4AD/P+AB/z/wAf8f+AP/H/wP/g////4P///8B///+AP///AA///gAD//gAAH/AA",
  "AB/wAAD//AAD//8AB///gA///8Af///gP///8D////h/8D/4f8Af+H/AD/z/gAf8/4AH/P+AA/7/gAP+/4AD/v+AA/7/gAP+/4AH/n/AB/5/4A//f/A//z////8/////P////x////8P////B////gP/+/4B//P+AD+D/gAAA/4AAAP+AAAD/gAAB/4HgAf8f8AH/H/AD/w/4B/4P/A/+D////Af///wH///4A///8AH//+AA///AAH//AAAP+AA",
];

let decodedTemplates = null;

function decodeBase64Bytes(value) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function getDigitTemplates() {
  if (decodedTemplates) {
    return decodedTemplates;
  }
  decodedTemplates = DIGIT_TEMPLATE_BASE64.map((encoded) => {
    const bytes = decodeBase64Bytes(encoded);
    const bits = new Uint8Array(TEMPLATE_WIDTH * TEMPLATE_HEIGHT);
    for (let index = 0; index < bits.length; index += 1) {
      bits[index] = (bytes[index >> 3] >> (7 - (index & 7))) & 1;
    }
    return bits;
  });
  return decodedTemplates;
}

function pixelOffset(width, x, y) {
  return (y * width + x) * 4;
}

function findComponents(image, rectangle, predicate) {
  const x0 = Math.max(0, Math.floor(rectangle.x0));
  const y0 = Math.max(0, Math.floor(rectangle.y0));
  const x1 = Math.min(image.width, Math.ceil(rectangle.x1));
  const y1 = Math.min(image.height, Math.ceil(rectangle.y1));
  const regionWidth = x1 - x0;
  const regionHeight = y1 - y0;
  const foreground = new Uint8Array(regionWidth * regionHeight);

  for (let y = 0; y < regionHeight; y += 1) {
    for (let x = 0; x < regionWidth; x += 1) {
      const offset = pixelOffset(image.width, x + x0, y + y0);
      if (
        predicate(
          image.data[offset],
          image.data[offset + 1],
          image.data[offset + 2],
        )
      ) {
        foreground[y * regionWidth + x] = 1;
      }
    }
  }

  const components = [];
  const queue = [];
  for (let y = 0; y < regionHeight; y += 1) {
    for (let x = 0; x < regionWidth; x += 1) {
      const startIndex = y * regionWidth + x;
      if (!foreground[startIndex]) {
        continue;
      }
      foreground[startIndex] = 0;
      queue.length = 0;
      queue.push(startIndex);
      const points = [];
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;

      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        const currentY = Math.floor(current / regionWidth);
        const currentX = current - currentY * regionWidth;
        points.push([currentX, currentY]);
        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);

        const neighbors = [
          [currentX - 1, currentY],
          [currentX + 1, currentY],
          [currentX, currentY - 1],
          [currentX, currentY + 1],
          [currentX - 1, currentY - 1],
          [currentX + 1, currentY - 1],
          [currentX - 1, currentY + 1],
          [currentX + 1, currentY + 1],
        ];
        for (const [neighborX, neighborY] of neighbors) {
          if (
            neighborX < 0 ||
            neighborY < 0 ||
            neighborX >= regionWidth ||
            neighborY >= regionHeight
          ) {
            continue;
          }
          const neighborIndex = neighborY * regionWidth + neighborX;
          if (foreground[neighborIndex]) {
            foreground[neighborIndex] = 0;
            queue.push(neighborIndex);
          }
        }
      }

      if (points.length >= 4) {
        components.push({
          points,
          area: points.length,
          x0: minX + x0,
          x1: maxX + x0 + 1,
          y0: minY + y0,
          y1: maxY + y0 + 1,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        });
      }
    }
  }

  return components.sort((left, right) => left.x0 - right.x0);
}

function normalizeComponent(component) {
  const sourceWidth = component.width;
  const sourceHeight = component.height;
  const scale = Math.min(
    TEMPLATE_WIDTH / sourceWidth,
    TEMPLATE_HEIGHT / sourceHeight,
  );
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const offsetX = Math.floor((TEMPLATE_WIDTH - targetWidth) / 2);
  const offsetY = Math.floor((TEMPLATE_HEIGHT - targetHeight) / 2);
  // findComponents stores points relative to the crop, while the bounds are
  // absolute. Rebase with the minimum relative coordinates instead of relying
  // on the crop origin.
  let minPointX = Number.POSITIVE_INFINITY;
  let minPointY = Number.POSITIVE_INFINITY;
  for (const [x, y] of component.points) {
    minPointX = Math.min(minPointX, x);
    minPointY = Math.min(minPointY, y);
  }
  const source = new Set();
  for (const [x, y] of component.points) {
    source.add(`${x - minPointX},${y - minPointY}`);
  }

  const normalized = new Uint8Array(TEMPLATE_WIDTH * TEMPLATE_HEIGHT);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(
      sourceHeight - 1,
      Math.floor(((y + 0.5) * sourceHeight) / targetHeight),
    );
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.floor(((x + 0.5) * sourceWidth) / targetWidth),
      );
      if (source.has(`${sourceX},${sourceY}`)) {
        normalized[(offsetY + y) * TEMPLATE_WIDTH + offsetX + x] = 1;
      }
    }
  }
  return normalized;
}

export function classifyCapmaDigitCandidates(component) {
  const normalized = normalizeComponent(component);
  const templates = getDigitTemplates();
  const candidates = [];

  for (let digit = 0; digit < templates.length; digit += 1) {
    let intersection = 0;
    let union = 0;
    const template = templates[digit];
    for (let index = 0; index < normalized.length; index += 1) {
      if (normalized[index] || template[index]) {
        union += 1;
      }
      if (normalized[index] && template[index]) {
        intersection += 1;
      }
    }
    candidates.push({ digit, score: union ? intersection / union : 0 });
  }

  return candidates.sort((left, right) => right.score - left.score);
}

export function classifyCapmaDigit(component) {
  const [best, second] = classifyCapmaDigitCandidates(component);

  return {
    digit: best?.digit ?? null,
    score: best?.score ?? -1,
    margin: (best?.score ?? -1) - Math.max(0, second?.score ?? -1),
  };
}

const darkText = (red, green, blue) => Math.max(red, green, blue) < 120;
const lightNeutralText = (red, green, blue) =>
  red > 45 &&
  green > 45 &&
  blue > 45 &&
  Math.max(red, green, blue) - Math.min(red, green, blue) < 80;
const yellowText = (red, green, blue) => red > 120 && green > 90 && blue < 110;

function recognizeComponents(
  components,
  minimumScore = 0.68,
  minimumMargin = 0,
) {
  return components.map((component) => {
    const match = classifyCapmaDigit(component);
    if (match.score < minimumScore || match.margin < minimumMargin) {
      throw new Error(
        `CAPMA OCR rejected an ambiguous digit (${match.score.toFixed(3)} confidence, ${match.margin.toFixed(3)} margin).`,
      );
    }
    return { ...match, component };
  });
}

function readTemperatureWithPredicate(
  image,
  rectangle,
  size,
  predicate,
  palette,
) {
  const components = findComponents(image, rectangle, predicate);
  const degreeCandidates = components.filter(
    (component) =>
      component.height >= size.degreeMinHeight &&
      component.height <= size.degreeMaxHeight &&
      component.width >= size.degreeMinWidth &&
      component.y0 <= size.degreeMaxY,
  );
  const degree = degreeCandidates[0];
  if (!degree) {
    throw new Error("CAPMA OCR could not locate the temperature degree mark.");
  }

  const digitComponents = components.filter(
    (component) =>
      component.x1 < degree.x0 &&
      component.height >= size.digitMinHeight &&
      component.width >= size.digitMinWidth &&
      component.area >= size.digitMinArea,
  );
  if (!digitComponents.length || digitComponents.length > 2) {
    throw new Error("CAPMA OCR found an unexpected temperature digit count.");
  }
  const matches = recognizeComponents(
    digitComponents,
    palette === "yellow_on_dark" ? 0.6 : 0.68,
    palette === "yellow_on_dark" ? 0.08 : 0,
  );
  const signComponent = components.find(
    (component) =>
      component.x1 < (digitComponents[0]?.x0 ?? degree.x0) &&
      component.width >= size.minusMinWidth &&
      component.height <= size.minusMaxHeight &&
      component.y0 >= size.minusMinY,
  );
  const magnitude = Number(matches.map((match) => match.digit).join(""));
  const value = signComponent ? -magnitude : magnitude;
  if (!Number.isInteger(value) || value < -30 || value > 60) {
    throw new Error("CAPMA OCR temperature is outside the allowed range.");
  }
  return {
    value,
    confidence: Math.min(...matches.map((match) => match.score)),
    glyphs: matches.map((match) => match.digit).join(""),
    palette,
  };
}

function readTemperature(image, rectangle, size) {
  const candidates = [];
  const errors = [];
  for (const [palette, predicate] of [
    ["dark_on_light", darkText],
    ["yellow_on_dark", yellowText],
  ]) {
    try {
      candidates.push(
        readTemperatureWithPredicate(
          image,
          rectangle,
          size,
          predicate,
          palette,
        ),
      );
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!candidates.length) {
    throw new Error(
      `CAPMA OCR could not read the temperature in either supported display palette (${errors.join("; ")}).`,
    );
  }
  return candidates.sort(
    (left, right) => right.confidence - left.confidence,
  )[0];
}

// Extended display fields beyond the two whole-degree temperatures. The same
// fixed 1366x768 layout carries % HUMEDAD (integer percent), PRESION
// (0.1 hPa station pressure), PUNTO DE ROCIO (whole-degree computed dew
// point), QNH (0.01 inHg) and the 2-minute rocio value. Each field is read
// independently and fails soft to null so a degraded box never rejects the
// frame that the core temperature/timestamp gates already accepted.
const EXTENDED_SMALL_DIGIT_MIN_SCORE = 0.62;

const DEWPOINT_RECTANGLE = { x0: 328, y0: 352, x1: 552, y1: 416 };
const DEWPOINT_SIZE = {
  degreeMinHeight: 18,
  degreeMaxHeight: 30,
  degreeMinWidth: 10,
  degreeMaxY: 369,
  digitMinHeight: 35,
  digitMinWidth: 7,
  digitMinArea: 250,
  minusMinWidth: 10,
  minusMaxHeight: 12,
  minusMinY: 375,
};
const TWO_MINUTE_DEWPOINT_RECTANGLE = { x0: 145, y0: 602, x1: 245, y1: 636 };
const TWO_MINUTE_DEWPOINT_SIZE = {
  degreeMinHeight: 8,
  degreeMaxHeight: 16,
  degreeMinWidth: 5,
  degreeMaxY: 614,
  digitMinHeight: 16,
  digitMinWidth: 4,
  digitMinArea: 60,
  minusMinWidth: 6,
  minusMaxHeight: 8,
  minusMinY: 614,
};
const HUMIDITY_RECTANGLE = { x0: 135, y0: 262, x1: 270, y1: 303 };
// The pressure string is centered in its box and its width changes: the
// display drops a trailing ".0" and shows e.g. "787 hPa". The rectangle spans
// the whole box so the unit letters are never clipped into digit-like shapes.
const PRESSURE_RECTANGLE = { x0: 112, y0: 313, x1: 275, y1: 354 };
const QNH_RECTANGLE = { x0: 318, y0: 492, x1: 588, y1: 585 };

function classifyExtendedDigit(component) {
  const [best] = classifyCapmaDigitCandidates(component);
  if (!best || best.score < EXTENDED_SMALL_DIGIT_MIN_SCORE) {
    throw new Error("CAPMA extended OCR rejected a low-confidence digit.");
  }
  return { digit: best.digit, score: best.score };
}

function readHumidityWithPredicate(image, predicate) {
  const components = findComponents(image, HUMIDITY_RECTANGLE, predicate);
  const percentCircles = components.filter(
    (component) =>
      component.height >= 7 &&
      component.height <= 12 &&
      component.width >= 6 &&
      component.width <= 12,
  );
  if (!percentCircles.length) {
    throw new Error("CAPMA extended OCR could not locate the percent mark.");
  }
  const percentX = Math.min(...percentCircles.map((circle) => circle.x0));
  const digitComponents = components.filter(
    (component) =>
      component.height >= 16 &&
      component.height <= 26 &&
      component.width >= 4 &&
      component.x1 <= percentX - 2,
  );
  if (!digitComponents.length || digitComponents.length > 3) {
    throw new Error("CAPMA extended OCR found an unexpected humidity digit count.");
  }
  const matches = digitComponents.map(classifyExtendedDigit);
  const value = Number(matches.map((match) => match.digit).join(""));
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("CAPMA extended OCR humidity is outside the allowed range.");
  }
  return {
    value,
    confidence: Math.min(...matches.map((match) => match.score)),
  };
}

function readStationPressureWithPredicate(image, predicate) {
  const components = findComponents(image, PRESSURE_RECTANGLE, predicate);
  const digitSized = components.filter(
    (component) =>
      component.height >= 16 && component.height <= 26 && component.width >= 4,
  );
  // Left-to-right prefix of confidently classified digits. The first glyph
  // that fails classification is the unit text ("hPa") and ends the value.
  const matches = [];
  let stopper = null;
  for (const component of digitSized) {
    const [best] = classifyCapmaDigitCandidates(component);
    if (best && best.score >= EXTENDED_SMALL_DIGIT_MIN_SCORE) {
      matches.push({ component, digit: best.digit, score: best.score });
    } else {
      stopper = component;
      break;
    }
  }
  if (matches.length < 3 || matches.length > 4) {
    throw new Error("CAPMA extended OCR expected 3 or 4 station-pressure digits.");
  }
  const decimalDots = components.filter(
    (component) =>
      component.width >= 3 &&
      component.width <= 9 &&
      component.height >= 3 &&
      component.height <= 9 &&
      component.y0 >= PRESSURE_RECTANGLE.y0 + 20,
  );
  const integerEnd = matches[2].component.x1;
  const nextStart =
    matches[3]?.component.x0 ?? stopper?.x0 ?? integerEnd + 24;
  const dotBetween = decimalDots.some(
    (dot) => dot.x0 >= integerEnd - 2 && dot.x1 <= nextStart + 2,
  );
  let tenths;
  if (matches.length === 4) {
    // "787.2 hPa": the tenth digit sits after the decimal gap.
    if (!dotBetween || nextStart - integerEnd < 6) {
      throw new Error("CAPMA extended OCR could not confirm the pressure decimal.");
    }
    tenths = matches[3].digit;
  } else {
    // "787 hPa": the display drops a trailing ".0". A visible dot with a
    // missing tenth digit means the tenth failed OCR; fail closed instead of
    // guessing zero.
    if (dotBetween) {
      throw new Error("CAPMA extended OCR lost the pressure tenth digit.");
    }
    tenths = 0;
  }
  const value =
    (matches[0].digit * 1000 +
      matches[1].digit * 100 +
      matches[2].digit * 10 +
      tenths) /
    10;
  if (!Number.isFinite(value) || value < 700 || value > 820) {
    throw new Error("CAPMA extended OCR station pressure is outside the allowed range.");
  }
  return {
    value,
    confidence: Math.min(...matches.map((match) => match.score)),
  };
}

function readQnhWithPredicate(image, predicate) {
  const digitComponents = findComponents(image, QNH_RECTANGLE, predicate).filter(
    (component) =>
      component.height >= 55 && component.height <= 80 && component.width >= 12,
  );
  if (digitComponents.length !== 4) {
    throw new Error("CAPMA extended OCR expected four QNH digits.");
  }
  const decimalGap = digitComponents[2].x0 - digitComponents[1].x1;
  if (decimalGap < 15) {
    throw new Error("CAPMA extended OCR could not confirm the QNH decimal gap.");
  }
  const matches = digitComponents.map(classifyExtendedDigit);
  const value =
    (matches[0].digit * 1000 +
      matches[1].digit * 100 +
      matches[2].digit * 10 +
      matches[3].digit) /
    100;
  if (!Number.isFinite(value) || value < 27 || value > 32) {
    throw new Error("CAPMA extended OCR QNH is outside the allowed range.");
  }
  return {
    value,
    confidence: Math.min(...matches.map((match) => match.score)),
  };
}

function bestAcrossPalettes(image, reader) {
  const candidates = [];
  for (const predicate of [darkText, yellowText]) {
    try {
      candidates.push(reader(image, predicate));
    } catch {
      // The other palette may still validate.
    }
  }
  if (!candidates.length) {
    return null;
  }
  return candidates.sort((left, right) => right.confidence - left.confidence)[0];
}

// Magnus form used only as a physical consistency band. The display computes
// dew point from its unrounded temperature and humidity, so a displayed
// (T, Td, RH) triple that cannot coexist within display quantization means at
// least one of the three was misread.
export function capmaMagnusDewpointC(temperatureC, humidityPercent) {
  const gamma =
    Math.log(humidityPercent / 100) +
    (17.62 * temperatureC) / (243.12 + temperatureC);
  return (243.12 * gamma) / (17.62 - gamma);
}

export function capmaDewpointTripleIsFeasible({
  currentTempC,
  dewpointC,
  humidityPercent,
}) {
  if (
    !Number.isFinite(currentTempC) ||
    !Number.isFinite(dewpointC) ||
    !Number.isFinite(humidityPercent)
  ) {
    return true;
  }
  const lowest = capmaMagnusDewpointC(
    currentTempC - 0.5,
    Math.max(0.5, humidityPercent - 0.6),
  );
  const highest = capmaMagnusDewpointC(
    currentTempC + 0.5,
    Math.min(100, humidityPercent + 0.6),
  );
  return highest >= dewpointC - 0.6 && lowest <= dewpointC + 0.6;
}

const PRESSURE_QNH_RATIO = 1.3097;
const PRESSURE_QNH_TOLERANCE_HPA = 1.2;
const INHG_TO_HPA = 33.8639;

export function capmaPressureQnhIsConsistent({ stationPressureHpa, qnhInHg }) {
  if (!Number.isFinite(stationPressureHpa) || !Number.isFinite(qnhInHg)) {
    return true;
  }
  const predictedQnhHpa = stationPressureHpa * PRESSURE_QNH_RATIO;
  return (
    Math.abs(qnhInHg * INHG_TO_HPA - predictedQnhHpa) <=
    PRESSURE_QNH_TOLERANCE_HPA
  );
}

export function extractCapmaExtendedFields(image, options = {}) {
  const read = (reader) => bestAcrossPalettes(image, reader);
  const tryTemperature = (rectangle, size) => {
    try {
      const result = readTemperature(image, rectangle, size);
      return { value: result.value, confidence: result.confidence };
    } catch {
      return null;
    }
  };

  let dewpoint = tryTemperature(DEWPOINT_RECTANGLE, DEWPOINT_SIZE);
  let humidity = read(readHumidityWithPredicate);
  let stationPressure = read(readStationPressureWithPredicate);
  let qnh = read(readQnhWithPredicate);
  const twoMinuteDewpoint = tryTemperature(
    TWO_MINUTE_DEWPOINT_RECTANGLE,
    TWO_MINUTE_DEWPOINT_SIZE,
  );

  // Cross-checks fail closed on the fields they implicate: an infeasible
  // (T, Td, RH) triple drops dew point and humidity, and a QNH that does not
  // match the 0.1 hPa station pressure drops both pressure fields.
  if (
    !capmaDewpointTripleIsFeasible({
      currentTempC: options.currentTempC,
      dewpointC: dewpoint?.value,
      humidityPercent: humidity?.value,
    })
  ) {
    dewpoint = null;
    humidity = null;
  }
  if (
    !capmaPressureQnhIsConsistent({
      stationPressureHpa: stationPressure?.value,
      qnhInHg: qnh?.value,
    })
  ) {
    stationPressure = null;
    qnh = null;
  }

  return {
    dewpointC: dewpoint?.value ?? null,
    dewpointConfidence: dewpoint?.confidence ?? null,
    humidityPercent: humidity?.value ?? null,
    humidityConfidence: humidity?.confidence ?? null,
    stationPressureHpa: stationPressure?.value ?? null,
    stationPressureConfidence: stationPressure?.confidence ?? null,
    qnhInHg: qnh?.value ?? null,
    qnhConfidence: qnh?.confidence ?? null,
    twoMinuteDewpointC: twoMinuteDewpoint?.value ?? null,
    twoMinuteDewpointConfidence: twoMinuteDewpoint?.confidence ?? null,
  };
}

function readFixedDigits(image, rectangle, predicate, componentFilter, count) {
  const components = findComponents(image, rectangle, predicate).filter(
    componentFilter,
  );
  const matches = [];
  for (const component of components) {
    const candidates = classifyCapmaDigitCandidates(component);
    const [best, second] = candidates;
    const match = {
      digit: best?.digit ?? null,
      score: best?.score ?? -1,
      margin: (best?.score ?? -1) - Math.max(0, second?.score ?? -1),
    };
    if (match.score >= 0.68) {
      matches.push({ ...match, component, candidates });
    }
  }
  if (matches.length !== count) {
    throw new Error(
      `CAPMA OCR expected ${count} timestamp digits but found ${matches.length}.`,
    );
  }
  return {
    text: matches.map((match) => match.digit).join(""),
    confidence: Math.min(...matches.map((match) => match.score)),
    glyphs: matches.map((match) => match.candidates),
  };
}

function padTimestampPart(value, length = 2) {
  return String(value).padStart(length, "0");
}

function timestampDigitStrings(epochMs) {
  const value = new Date(epochMs);
  return {
    dateText: `${padTimestampPart(value.getUTCDate())}${padTimestampPart(value.getUTCMonth() + 1)}${padTimestampPart(value.getUTCFullYear(), 4)}`,
    timeText: `${padTimestampPart(value.getUTCHours())}${padTimestampPart(value.getUTCMinutes())}${padTimestampPart(value.getUTCSeconds())}`,
  };
}

function scoreTimestampDigits(glyphs, digits) {
  let score = 0;
  let confidence = 1;
  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[index]);
    const candidate = glyphs[index]?.find((item) => item.digit === digit);
    if (!candidate || candidate.score < MIN_TIMESTAMP_GLYPH_SCORE) {
      return null;
    }
    score += Math.log(candidate.score);
    confidence = Math.min(confidence, candidate.score);
  }
  return { score, confidence };
}

export function resolveCapmaScreenTimestamp({
  dateGlyphs,
  timeGlyphs,
  fetchedAt,
}) {
  if (
    !Array.isArray(dateGlyphs) ||
    dateGlyphs.length !== 8 ||
    !Array.isArray(timeGlyphs) ||
    timeGlyphs.length !== 6 ||
    !Number.isFinite(fetchedAt)
  ) {
    throw new Error("CAPMA OCR timestamp evidence is incomplete.");
  }

  const firstSecond = Math.ceil((fetchedAt - MAX_SCREEN_AGE_MS) / 1000);
  const lastSecond = Math.floor((fetchedAt + MAX_SCREEN_FUTURE_MS) / 1000);
  let best = null;
  for (
    let epochSecond = firstSecond;
    epochSecond <= lastSecond;
    epochSecond += 1
  ) {
    const screenTimeUtc = epochSecond * 1000;
    const { dateText, timeText } = timestampDigitStrings(screenTimeUtc);
    const dateScore = scoreTimestampDigits(dateGlyphs, dateText);
    if (!dateScore) {
      continue;
    }
    const timeScore = scoreTimestampDigits(timeGlyphs, timeText);
    if (!timeScore) {
      continue;
    }
    const score = dateScore.score + timeScore.score;
    const distanceFromFetch = Math.abs(fetchedAt - screenTimeUtc);
    if (
      !best ||
      score > best.score + Number.EPSILON ||
      (Math.abs(score - best.score) <= Number.EPSILON &&
        distanceFromFetch < best.distanceFromFetch)
    ) {
      best = {
        screenTimeUtc,
        dateText,
        timeText,
        score,
        confidence: Math.min(dateScore.confidence, timeScore.confidence),
        distanceFromFetch,
      };
    }
  }
  if (!best) {
    throw new Error(
      "CAPMA OCR could not resolve a plausible embedded UTC timestamp.",
    );
  }
  return best;
}

export function extractCapmaDisplayFromPixels(image, options = {}) {
  if (image.width !== 1366 || image.height !== 768) {
    throw new Error(
      `CAPMA image dimensions changed (${image.width}x${image.height}); refusing fixed-layout OCR.`,
    );
  }
  if (!(image.data instanceof Uint8Array) && !ArrayBuffer.isView(image.data)) {
    throw new Error("CAPMA OCR requires RGBA pixel data.");
  }

  const fetchedAt = options.fetchedAt ?? Date.now();
  const date = readFixedDigits(
    image,
    { x0: 1070, y0: 12, x1: 1245, y1: 47 },
    lightNeutralText,
    (component) => component.height >= 15 && component.area >= 45,
    8,
  );
  const time = readFixedDigits(
    image,
    { x0: 1065, y0: 48, x1: 1255, y1: 90 },
    lightNeutralText,
    (component) => component.height >= 20 && component.area >= 100,
    6,
  );
  const timestamp = resolveCapmaScreenTimestamp({
    dateGlyphs: date.glyphs,
    timeGlyphs: time.glyphs,
    fetchedAt,
  });
  const screenTimeUtc = timestamp.screenTimeUtc;

  const currentTemperature = readTemperature(
    image,
    { x0: 330, y0: 215, x1: 550, y1: 275 },
    {
      degreeMinHeight: 18,
      degreeMaxHeight: 30,
      degreeMinWidth: 10,
      degreeMaxY: 232,
      digitMinHeight: 35,
      digitMinWidth: 7,
      digitMinArea: 250,
      minusMinWidth: 10,
      minusMaxHeight: 12,
      minusMinY: 238,
    },
  );
  const twoMinuteTemperature = readTemperature(
    image,
    { x0: 145, y0: 546, x1: 245, y1: 580 },
    {
      degreeMinHeight: 8,
      degreeMaxHeight: 16,
      degreeMinWidth: 5,
      degreeMaxY: 558,
      digitMinHeight: 16,
      digitMinWidth: 4,
      // The small Arial "1" glyph is only about 84 foreground pixels in the
      // live JPEGs, while compression can shave off a few more edge pixels.
      digitMinArea: 60,
      minusMinWidth: 6,
      minusMaxHeight: 8,
      minusMinY: 558,
    },
  );

  const tdzMatches = recognizeComponents(
    findComponents(
      image,
      { x0: 375, y0: 655, x1: 420, y1: 690 },
      yellowText,
    ).filter(
      (component) =>
        component.height >= 15 && component.area >= 25 && component.width >= 8,
    ),
    0.58,
  );
  if (tdzMatches.length !== 2) {
    throw new Error(
      `CAPMA OCR could not validate the TDZ identifier (${tdzMatches.length} digits).`,
    );
  }
  const tdz = tdzMatches.map((match) => match.digit).join("");
  if (options.expectedTdz && tdz !== options.expectedTdz) {
    throw new Error(
      `CAPMA TDZ mismatch: expected ${options.expectedTdz}, image says ${tdz}.`,
    );
  }

  if (
    screenTimeUtc > fetchedAt + MAX_SCREEN_FUTURE_MS ||
    screenTimeUtc < fetchedAt - MAX_SCREEN_AGE_MS
  ) {
    throw new Error(
      "CAPMA embedded timestamp is implausibly far from fetch time.",
    );
  }

  // Extended fields are additive evidence: they never veto a frame that the
  // core temperature/timestamp/TDZ gates accepted, and they are excluded from
  // the storage-threshold ocrConfidence so existing acceptance is unchanged.
  const extended = extractCapmaExtendedFields(image, {
    currentTempC: currentTemperature.value,
  });

  return {
    tdz,
    screenTimeUtc,
    screenTimestampRaw: `${timestamp.dateText.slice(0, 2)}/${timestamp.dateText.slice(2, 4)}/${timestamp.dateText.slice(4)} ${timestamp.timeText.slice(0, 2)}:${timestamp.timeText.slice(2, 4)}:${timestamp.timeText.slice(4)}`,
    currentTempC: currentTemperature.value,
    twoMinuteTempC: twoMinuteTemperature.value,
    extended,
    ocrConfidence: Math.min(
      timestamp.confidence,
      currentTemperature.confidence,
      twoMinuteTemperature.confidence,
      ...tdzMatches.map((match) => match.score),
    ),
    ocrEngine: "fixed_layout_arial_template_v3_extended_dual_palette",
  };
}

export const capmaOcrTestSupport = {
  templateWidth: TEMPLATE_WIDTH,
  templateHeight: TEMPLATE_HEIGHT,
  getDigitTemplates,
  findComponents,
  yellowText,
};
