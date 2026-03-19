#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const PREFLIGHT_DEFAULT_BASE_URL = "https://gopreflight.co.nz";
const PREFLIGHT_AUTH_ENV_NAME = "PREFLIGHT_AUTH_BEARER_TOKEN";
const DEFAULT_TIMEOUT_MS = 90000;
const DEFAULT_SCREENSHOT_PATH = "/tmp/preflight-login-error.png";
const LOGIN_FORM_EMAIL_SELECTORS = [
  'input[type="email"]',
  'input[name="username"]',
  'input[name="email"]',
  "input#username",
  "input#email",
];
const LOGIN_FORM_PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
  "input#password",
];
const LOGIN_FORM_SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'button[name="action"]',
  'input[type="submit"]',
  'button:has-text("Continue")',
  'button:has-text("Log in")',
  'button:has-text("Login")',
  'button:has-text("Sign in")',
];

async function loadEnvFileIntoProcess(filePath) {
  const absolutePath = path.resolve(filePath);
  let body;
  try {
    body = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  for (const rawLine of body.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(rawLine);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = rawValue;
  }

  return true;
}

async function loadDefaultEnvFiles() {
  await loadEnvFileIntoProcess(".env.local");
  await loadEnvFileIntoProcess(".env");
}

function printHelp() {
  console.log(`Usage: node scripts/refresh-preflight-token.mjs [options]

Fetch a fresh PreFlight Auth0 bearer token by automating the normal browser
login flow, then optionally write it into .env.local and/or Convex env.

Required environment variables:
  PREFLIGHT_USERNAME
  PREFLIGHT_PASSWORD

The script auto-loads .env.local and .env before checking those variables.

Optional environment variables:
  PREFLIGHT_BASE_URL              defaults to https://gopreflight.co.nz
  PREFLIGHT_APP_URL               defaults to $PREFLIGHT_BASE_URL/app
  PREFLIGHT_LOGIN_TIMEOUT_MS      defaults to 90000

Options:
  --headed                        Run Chromium with a visible UI.
  --print-token                   Print the full access token to stdout.
  --write-env-file [path]         Update PREFLIGHT_AUTH_BEARER_TOKEN in an env file.
                                  Defaults to .env.local when no path is given.
  --set-convex                    Pipe the token into \`npx convex env set\`.
  --convex-prod                   Use Convex production deployment.
  --convex-preview-name NAME      Use a named Convex preview deployment.
  --convex-deployment-name NAME   Use a specific Convex deployment name.
  --convex-env-file PATH          Use a custom env file for Convex deployment selection.
  --timeout-ms NUMBER             Override login timeout in milliseconds.
  --help                          Show this help.

Examples:
  node scripts/refresh-preflight-token.mjs --write-env-file
  node scripts/refresh-preflight-token.mjs --set-convex
  node scripts/refresh-preflight-token.mjs --set-convex --convex-prod
  node scripts/refresh-preflight-token.mjs --write-env-file .env.local --set-convex
`);
}

function parseArgs(argv) {
  const args = {
    headed: false,
    printToken: false,
    writeEnvFile: null,
    setConvex: false,
    convexProd: false,
    convexPreviewName: null,
    convexDeploymentName: null,
    convexEnvFile: null,
    timeoutMs: parsePositiveInt(
      process.env.PREFLIGHT_LOGIN_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
    ),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      args.help = true;
      continue;
    }
    if (arg === "--headed") {
      args.headed = true;
      continue;
    }
    if (arg === "--print-token") {
      args.printToken = true;
      continue;
    }
    if (arg === "--set-convex") {
      args.setConvex = true;
      continue;
    }
    if (arg === "--convex-prod") {
      args.convexProd = true;
      continue;
    }
    if (arg === "--convex-preview-name") {
      index += 1;
      args.convexPreviewName = requireArgValue(argv[index], arg);
      continue;
    }
    if (arg === "--convex-deployment-name") {
      index += 1;
      args.convexDeploymentName = requireArgValue(argv[index], arg);
      continue;
    }
    if (arg === "--convex-env-file") {
      index += 1;
      args.convexEnvFile = requireArgValue(argv[index], arg);
      continue;
    }
    if (arg === "--timeout-ms") {
      index += 1;
      args.timeoutMs = parsePositiveInt(requireArgValue(argv[index], arg), null);
      if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
        throw new Error(`Invalid value for ${arg}: ${argv[index]}`);
      }
      continue;
    }
    if (arg === "--write-env-file") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        args.writeEnvFile = next;
        index += 1;
      } else {
        args.writeEnvFile = ".env.local";
      }
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  const convexTargetFlags = [
    args.convexProd ? "prod" : null,
    args.convexPreviewName ? "preview" : null,
    args.convexDeploymentName ? "deployment" : null,
  ].filter(Boolean);
  if (convexTargetFlags.length > 1) {
    throw new Error(
      "Use at most one of --convex-prod, --convex-preview-name, or --convex-deployment-name.",
    );
  }

  return args;
}

function requireArgValue(value, optionName) {
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${optionName}.`);
  }
  return value;
}

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getRequiredEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

function maskToken(token) {
  if (!token) {
    return "—";
  }
  if (token.length <= 16) {
    return token;
  }
  return `${token.slice(0, 8)}...${token.slice(-8)}`;
}

function decodeJwtPayload(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function formatIsoFromSeconds(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) {
    return "—";
  }
  return new Date(epochSeconds * 1000).toISOString();
}

async function fillFirstVisible(page, selectors, value, timeoutMs) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      await locator.fill(value);
      return true;
    } catch {
      // try the next selector
    }
  }
  return false;
}

async function clickFirstVisible(page, selectors, timeoutMs) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      await locator.click();
      return true;
    } catch {
      // try the next selector
    }
  }
  return false;
}

async function completeAuth0Login(page, { username, password, timeoutMs }) {
  const shortTimeoutMs = Math.min(timeoutMs, 10000);
  const filledEmail = await fillFirstVisible(
    page,
    LOGIN_FORM_EMAIL_SELECTORS,
    username,
    shortTimeoutMs,
  );
  const filledPassword = await fillFirstVisible(
    page,
    LOGIN_FORM_PASSWORD_SELECTORS,
    password,
    shortTimeoutMs,
  );

  if (!filledEmail && !filledPassword) {
    throw new Error("Could not find the Auth0 login form.");
  }

  if (filledEmail || filledPassword) {
    const clicked = await clickFirstVisible(
      page,
      LOGIN_FORM_SUBMIT_SELECTORS,
      shortTimeoutMs,
    );
    if (!clicked) {
      throw new Error("Could not find the Auth0 submit button.");
    }
  }

  if (!filledPassword) {
    const passwordAppeared = await fillFirstVisible(
      page,
      LOGIN_FORM_PASSWORD_SELECTORS,
      password,
      shortTimeoutMs,
    );
    if (!passwordAppeared) {
      throw new Error("Email step completed but password field never appeared.");
    }
    const clicked = await clickFirstVisible(
      page,
      LOGIN_FORM_SUBMIT_SELECTORS,
      shortTimeoutMs,
    );
    if (!clicked) {
      throw new Error("Could not submit the Auth0 password step.");
    }
  }
}

function createTokenCapture(context, baseUrl) {
  let resolved = false;
  let resolveToken;
  let rejectToken;
  const tokenPromise = new Promise((resolve, reject) => {
    resolveToken = resolve;
    rejectToken = reject;
  });

  const requestHandler = (request) => {
    const url = request.url();
    if (!url.startsWith(baseUrl)) {
      return;
    }
    if (!url.includes("/data/") && !url.includes("/source/")) {
      return;
    }

    const headers = request.headers();
    const authorization = headers.authorization ?? headers.Authorization;
    if (!authorization || !authorization.startsWith("Bearer ")) {
      return;
    }

    const token = authorization.slice("Bearer ".length).trim();
    if (!token || resolved) {
      return;
    }
    resolved = true;
    resolveToken(token);
  };

  context.on("request", requestHandler);

  return {
    tokenPromise,
    fail(error) {
      if (resolved) {
        return;
      }
      resolved = true;
      rejectToken(error);
    },
    dispose() {
      context.off("request", requestHandler);
    },
  };
}

async function capturePreflightAccessToken({
  baseUrl,
  appUrl,
  username,
  password,
  headed,
  timeoutMs,
}) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: !headed,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const tokenCapture = createTokenCapture(context, baseUrl);

  try {
    await page.goto(appUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    try {
      const token = await Promise.race([
        tokenCapture.tokenPromise,
        page.waitForTimeout(5000).then(() => null),
      ]);
      if (token) {
        return token;
      }
    } catch {
      // Fall through into the login flow.
    }

    await completeAuth0Login(page, { username, password, timeoutMs });

    await page.waitForURL((url) => url.toString().startsWith(baseUrl), {
      timeout: timeoutMs,
    });
    await page.goto(appUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    return await Promise.race([
      tokenCapture.tokenPromise,
      page.waitForTimeout(timeoutMs).then(() => {
        throw new Error(
          "Timed out waiting for an authenticated PreFlight API request with a bearer token.",
        );
      }),
    ]);
  } catch (error) {
    try {
      await page.screenshot({
        path: DEFAULT_SCREENSHOT_PATH,
        fullPage: true,
      });
      console.error(`Saved login failure screenshot to ${DEFAULT_SCREENSHOT_PATH}`);
    } catch {
      // Ignore screenshot failures.
    }
    throw error;
  } finally {
    tokenCapture.dispose();
    await context.close();
    await browser.close();
  }
}

async function writeEnvFileValue(filePath, name, value) {
  const absolutePath = path.resolve(filePath);
  let body = "";
  try {
    body = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = `${name}=${value}`;
  const matcher = new RegExp(`^${escapedName}=.*$`, "m");
  const nextBody = matcher.test(body)
    ? body.replace(matcher, line)
    : `${body}${body && !body.endsWith("\n") ? "\n" : ""}${line}\n`;
  await fs.writeFile(absolutePath, nextBody, "utf8");
  return absolutePath;
}

async function setConvexEnvValue(token, args) {
  const commandArgs = ["convex", "env", "set"];
  if (args.convexEnvFile) {
    commandArgs.push("--env-file", args.convexEnvFile);
  }
  if (args.convexProd) {
    commandArgs.push("--prod");
  }
  if (args.convexPreviewName) {
    commandArgs.push("--preview-name", args.convexPreviewName);
  }
  if (args.convexDeploymentName) {
    commandArgs.push("--deployment-name", args.convexDeploymentName);
  }
  commandArgs.push(PREFLIGHT_AUTH_ENV_NAME);

  await new Promise((resolve, reject) => {
    const child = spawn("npx", commandArgs, {
      stdio: ["pipe", "inherit", "inherit"],
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npx ${commandArgs.join(" ")} exited with code ${code}.`));
    });

    child.stdin.write(`${token}\n`);
    child.stdin.end();
  });
}

async function main() {
  await loadDefaultEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const username = getRequiredEnv("PREFLIGHT_USERNAME");
  const password = getRequiredEnv("PREFLIGHT_PASSWORD");
  const baseUrl =
    String(process.env.PREFLIGHT_BASE_URL ?? "").trim().replace(/\/+$/, "") ||
    PREFLIGHT_DEFAULT_BASE_URL;
  const appUrl =
    String(process.env.PREFLIGHT_APP_URL ?? "").trim() || `${baseUrl}/app`;

  const token = await capturePreflightAccessToken({
    baseUrl,
    appUrl,
    username,
    password,
    headed: args.headed,
    timeoutMs: args.timeoutMs,
  });
  const payload = decodeJwtPayload(token);

  const wroteFiles = [];
  if (args.writeEnvFile) {
    const filePath = await writeEnvFileValue(
      args.writeEnvFile,
      PREFLIGHT_AUTH_ENV_NAME,
      token,
    );
    wroteFiles.push(filePath);
  }
  if (args.setConvex) {
    await setConvexEnvValue(token, args);
  }

  console.log(`Captured new PreFlight access token ${maskToken(token)}.`);
  if (payload) {
    console.log(`Issued at: ${formatIsoFromSeconds(payload.iat)}`);
    console.log(`Expires at: ${formatIsoFromSeconds(payload.exp)}`);
  }
  if (wroteFiles.length) {
    for (const filePath of wroteFiles) {
      console.log(`Updated ${filePath}`);
    }
  }
  if (args.setConvex) {
    console.log(`Updated Convex env ${PREFLIGHT_AUTH_ENV_NAME}.`);
  }
  if (args.printToken) {
    console.log(token);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
