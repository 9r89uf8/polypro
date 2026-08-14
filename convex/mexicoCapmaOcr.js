const TEMPLATE_WIDTH = 32;
const TEMPLATE_HEIGHT = 48;

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

export function classifyCapmaDigit(component) {
  const normalized = normalizeComponent(component);
  const templates = getDigitTemplates();
  let bestDigit = null;
  let bestScore = -1;
  let secondScore = -1;

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
    const score = union ? intersection / union : 0;
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestDigit = digit;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  return {
    digit: bestDigit,
    score: bestScore,
    margin: bestScore - Math.max(0, secondScore),
  };
}

const darkText = (red, green, blue) => Math.max(red, green, blue) < 120;
const lightNeutralText = (red, green, blue) =>
  red > 45 &&
  green > 45 &&
  blue > 45 &&
  Math.max(red, green, blue) - Math.min(red, green, blue) < 80;
const yellowText = (red, green, blue) => red > 120 && green > 90 && blue < 110;

function recognizeComponents(components, minimumScore = 0.68) {
  return components.map((component) => {
    const match = classifyCapmaDigit(component);
    if (match.score < minimumScore) {
      throw new Error(
        `CAPMA OCR rejected an ambiguous digit (${match.score.toFixed(3)} confidence).`,
      );
    }
    return { ...match, component };
  });
}

function readTemperature(image, rectangle, size) {
  const components = findComponents(image, rectangle, darkText);
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
  const matches = recognizeComponents(digitComponents);
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
  };
}

function readFixedDigits(image, rectangle, predicate, componentFilter, count) {
  const components = findComponents(image, rectangle, predicate).filter(
    componentFilter,
  );
  const matches = [];
  for (const component of components) {
    const match = classifyCapmaDigit(component);
    if (match.score >= 0.68) {
      matches.push({ ...match, component });
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
  };
}

function parseScreenTimestamp(dateDigits, timeDigits) {
  const day = Number(dateDigits.slice(0, 2));
  const month = Number(dateDigits.slice(2, 4));
  const year = Number(dateDigits.slice(4, 8));
  const hour = Number(timeDigits.slice(0, 2));
  const minute = Number(timeDigits.slice(2, 4));
  const second = Number(timeDigits.slice(4, 6));
  const epoch = Date.UTC(year, month - 1, day, hour, minute, second);
  const parsed = new Date(epoch);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) {
    throw new Error("CAPMA OCR produced an invalid embedded UTC timestamp.");
  }
  return epoch;
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
  const screenTimeUtc = parseScreenTimestamp(date.text, time.text);

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

  const fetchedAt = options.fetchedAt ?? Date.now();
  if (
    screenTimeUtc > fetchedAt + 15 * 60 * 1000 ||
    screenTimeUtc < fetchedAt - 24 * 60 * 60 * 1000
  ) {
    throw new Error("CAPMA embedded timestamp is implausibly far from fetch time.");
  }

  return {
    tdz,
    screenTimeUtc,
    screenTimestampRaw: `${date.text.slice(0, 2)}/${date.text.slice(2, 4)}/${date.text.slice(4)} ${time.text.slice(0, 2)}:${time.text.slice(2, 4)}:${time.text.slice(4)}`,
    currentTempC: currentTemperature.value,
    twoMinuteTempC: twoMinuteTemperature.value,
    ocrConfidence: Math.min(
      date.confidence,
      time.confidence,
      currentTemperature.confidence,
      twoMinuteTemperature.confidence,
      ...tdzMatches.map((match) => match.score),
    ),
    ocrEngine: "fixed_layout_arial_template_v1",
  };
}

export const capmaOcrTestSupport = {
  templateWidth: TEMPLATE_WIDTH,
  templateHeight: TEMPLATE_HEIGHT,
  getDigitTemplates,
  findComponents,
  yellowText,
};
