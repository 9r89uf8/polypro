import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KMA_ORIGIN = "https://www.weather.go.kr";
const IMAGE_LIST_PATH = "/w/wnuri-img/rest/sat/images/gk2a.do";
const PRODUCT = "rgb-cs";
const AREA = "ko020lc";
const FRAME_PATTERN = /^\d{12}$/;
const LOOP_MINUTES = 90;
const REQUEST_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
};

function parseKstFrameTime(frameTime) {
  if (!FRAME_PATTERN.test(frameTime)) {
    return null;
  }

  const year = Number(frameTime.slice(0, 4));
  const month = Number(frameTime.slice(4, 6));
  const day = Number(frameTime.slice(6, 8));
  const hour = Number(frameTime.slice(8, 10));
  const minute = Number(frameTime.slice(10, 12));
  const timestamp = Date.UTC(year, month - 1, day, hour, minute);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatListAnchor(timestamp) {
  const date = new Date(timestamp);
  const part = (value) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    part(date.getUTCMonth() + 1),
    part(date.getUTCDate()),
    `${part(date.getUTCHours())}:${part(date.getUTCMinutes())}`,
  ].join(".");
}

function formatFrameLabel(frameTime) {
  return `${frameTime.slice(8, 10)}:${frameTime.slice(10, 12)} KST`;
}

function upstreamFramePath(frameTime) {
  const kstWallClock = parseKstFrameTime(frameTime);
  if (!Number.isFinite(kstWallClock)) {
    return null;
  }
  const utcTimestamp = kstWallClock - 9 * 60 * 60_000;
  const date = new Date(utcTimestamp);
  const part = (value) => String(value).padStart(2, "0");
  const compactUtc = [
    date.getUTCFullYear(),
    part(date.getUTCMonth() + 1),
    part(date.getUTCDate()),
    part(date.getUTCHours()),
    part(date.getUTCMinutes()),
  ].join("");
  return `/w/repositary/image/sat/gk2a/KO/gk2a_ami_le1b_rgb-cs_ko005lc_${compactUtc}.thn.jpg`;
}

function listUrl(anchor) {
  const params = new URLSearchParams({
    mapType: "img",
    area: AREA,
    data: PRODUCT,
    tm: anchor ?? "",
    itv: "0.5",
    autoStart: "",
    zoomLevel: "0",
    zoomX: "0000000",
    zoomY: "0000000",
    showOption: "",
    leaflet: "0",
    kmap: "0",
    unit: "km/h",
  });
  return `${KMA_ORIGIN}${IMAGE_LIST_PATH}?${params}`;
}

async function fetchFrameList(anchor) {
  const response = await fetch(listUrl(anchor), {
    headers: REQUEST_HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`KMA imagery list returned ${response.status}`);
  }

  const rawFrames = await response.json();
  const frames = Array.isArray(rawFrames)
    ? rawFrames
        .filter(
          (frame) =>
            FRAME_PATTERN.test(String(frame?.tm ?? "")) &&
            typeof frame?.url === "string" &&
            frame.url.startsWith("/w/repositary/image/sat/gk2a/KO/"),
        )
        .map((frame) => ({
          tm: String(frame.tm),
          upstreamPath: frame.url,
        }))
    : [];

  return { frames };
}

function publicFrame(frame) {
  return {
    tm: frame.tm,
    label: formatFrameLabel(frame.tm),
    src: `/api/seoul/gk2a-loop?frame=${frame.tm}`,
  };
}

async function latestLoop() {
  const latestBatch = await fetchFrameList("");
  const latest = latestBatch.frames.at(-1);
  const latestTimestamp = latest ? parseKstFrameTime(latest.tm) : null;
  if (!Number.isFinite(latestTimestamp)) {
    throw new Error("KMA returned no recent GK2A imagery");
  }

  const olderAnchor = formatListAnchor(latestTimestamp - 48 * 60_000);
  const olderBatch = await fetchFrameList(olderAnchor);
  const byTime = new Map();
  for (const frame of [...olderBatch.frames, ...latestBatch.frames]) {
    byTime.set(frame.tm, frame);
  }

  const earliestTimestamp = latestTimestamp - LOOP_MINUTES * 60_000;
  const allFrames = [...byTime.values()]
    .filter((frame) => parseKstFrameTime(frame.tm) >= earliestTimestamp)
    .sort((a, b) => a.tm.localeCompare(b.tm));

  // KMA publishes this image every two minutes. Every other frame keeps the
  // expandable loop light while retaining a four-minute view over 90 minutes.
  const sampled = allFrames.filter(
    (_frame, index) => index % 2 === 0 || index === allFrames.length - 1,
  );

  return {
    frames: sampled.map(publicFrame),
    latestFrameTime: latest.tm,
    durationMinutes:
      sampled.length > 1
        ? Math.round(
            (parseKstFrameTime(sampled.at(-1).tm) -
              parseKstFrameTime(sampled[0].tm)) /
              60_000,
          )
        : 0,
    cadenceMinutes: 4,
    source: "KMA/NMSC GK2A",
    product: "RGB cloud-enhanced",
  };
}

async function proxyFrame(frameTime) {
  const kstWallClock = parseKstFrameTime(frameTime);
  const upstreamPath = upstreamFramePath(frameTime);
  if (!Number.isFinite(kstWallClock) || !upstreamPath) {
    return NextResponse.json({ error: "Invalid frame time" }, { status: 400 });
  }
  const frameUtc = kstWallClock - 9 * 60 * 60_000;
  if (
    frameUtc < Date.now() - 3 * 60 * 60_000 ||
    frameUtc > Date.now() + 30 * 60_000
  ) {
    return NextResponse.json(
      { error: "GK2A frame not found" },
      { status: 404 },
    );
  }

  const response = await fetch(`${KMA_ORIGIN}${upstreamPath}`, {
    headers: {
      ...REQUEST_HEADERS,
      Accept: "image/avif, image/webp, image/apng, image/*, */*;q=0.8",
      Referer: `${KMA_ORIGIN}/w/image/sat.do`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`KMA imagery frame returned ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error("KMA imagery frame returned a non-image response");
  }

  return new NextResponse(await response.arrayBuffer(), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request) {
  try {
    const frameTime = new URL(request.url).searchParams.get("frame");
    if (frameTime) {
      return await proxyFrame(frameTime);
    }

    return NextResponse.json(await latestLoop(), {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180",
      },
    });
  } catch (error) {
    console.error("[seoul/gk2a-loop]", error);
    return NextResponse.json(
      { error: "GK2A imagery is temporarily unavailable" },
      { status: 502 },
    );
  }
}
