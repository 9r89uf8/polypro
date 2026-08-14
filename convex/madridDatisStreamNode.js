"use node";

import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import { io } from "socket.io-client";
import { internal } from "./_generated/api.js";
import {
  buildAirframesDatisStreamConnectionPlan,
  evaluateAirframesDatisStreamRuntime,
} from "./madridDatisStreamAccess.js";
import {
  MADRID_DATIS_STREAM_HEARTBEAT_CHECK_MS,
  MADRID_DATIS_STREAM_HEARTBEAT_STORE_MS,
  MADRID_DATIS_STREAM_SESSION_MS,
} from "./madridDatisStreamLifecycle.js";
import {
  buildAirframesDatisStreamStoreArgs,
  parseAirframesDatisStreamEvent,
} from "./madridDatisStreamParser.js";

const SUPPORTED_STATION_ICAO = "LEMD";
const SUBSCRIPTION_ACK_TIMEOUT_MS = 15 * 1000;
const LEASE_SAFETY_MARGIN_MS = 15 * 1000;
const MAX_PROVIDER_EVENTS_PER_SESSION = 50_000;
const MAX_CANDIDATES_PER_SESSION = 250;
const LEMD_DATIS_PATTERN = /\bLEMD\s+ATIS\b/i;

function normalizeStationIcao(value) {
  const stationIcao = String(value ?? SUPPORTED_STATION_ICAO)
    .trim()
    .toUpperCase();
  if (stationIcao !== SUPPORTED_STATION_ICAO) {
    throw new Error("The Airframes D-ATIS stream supports LEMD only.");
  }
  return stationIcao;
}

function localStreamRuntime(
  getApprovalValue,
  getConnectionEnabledValue,
) {
  return evaluateAirframesDatisStreamRuntime(
    getApprovalValue(),
    getConnectionEnabledValue(),
  );
}

function safeErrorMessage(value, fallback) {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : value && typeof value.message === "string"
          ? value.message
          : fallback;
  return String(message)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

async function getFreshStreamRuntime(
  ctx,
  stationIcao,
  getApprovalValue,
  getConnectionEnabledValue,
) {
  const local = localStreamRuntime(
    getApprovalValue,
    getConnectionEnabledValue,
  );
  if (!local.ready) {
    return local;
  }
  const state = await ctx.runQuery(
    internal.madridDatisStream.getStreamApprovalState,
    { stationIcao },
  );
  const approved = state.approved === true;
  const connectionEnabled = state.connectionEnabled === true;
  return {
    approved,
    connectionEnabled,
    ready: approved && connectionEnabled,
    status: !approved
      ? "approval_required"
      : connectionEnabled
        ? "connection_enabled"
        : "connection_disabled",
  };
}

export async function runAirframesDatisStreamSession(
  ctx,
  args,
  {
    socketFactory = io,
    getApprovalValue = () =>
      process.env.AIRFRAMES_LEMD_STREAM_APPROVED,
    getConnectionEnabledValue = () =>
      process.env.AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED,
    subscriptionAckTimeoutMs = SUBSCRIPTION_ACK_TIMEOUT_MS,
    heartbeatCheckMs = MADRID_DATIS_STREAM_HEARTBEAT_CHECK_MS,
    heartbeatStoreMs = MADRID_DATIS_STREAM_HEARTBEAT_STORE_MS,
    maximumSessionMs = MADRID_DATIS_STREAM_SESSION_MS,
  } = {},
) {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const startedAt = Date.now();
    const begin = await ctx.runMutation(
      internal.madridDatisStream.beginStreamListener,
      {
        stationIcao,
        generation: args.generation,
        startedAt,
      },
    );
    if (begin.status !== "connecting") {
      if (
        begin.status === "approval_required" ||
        begin.status === "connection_disabled"
      ) {
        await ctx.runMutation(
          internal.madridDatisStream.clearStoppedStreamListener,
          {
            stationIcao,
            generation: args.generation,
            endedAt: Date.now(),
          },
        );
      }
      return {
        status: begin.status,
        stationIcao,
        generation: args.generation,
      };
    }
    const freshRuntime = await getFreshStreamRuntime(
      ctx,
      stationIcao,
      getApprovalValue,
      getConnectionEnabledValue,
    );
    if (!freshRuntime.ready) {
      await ctx.runMutation(
        internal.madridDatisStream.clearStoppedStreamListener,
        {
          stationIcao,
          generation: args.generation,
          endedAt: Date.now(),
        },
      );
      return {
        status: freshRuntime.status,
        stationIcao,
        generation: args.generation,
      };
    }

    const localRuntime = localStreamRuntime(
      getApprovalValue,
      getConnectionEnabledValue,
    );
    const plan = buildAirframesDatisStreamConnectionPlan(
      getApprovalValue(),
      getConnectionEnabledValue(),
    );
    if (!localRuntime.ready || plan.connection === null) {
      await ctx.runMutation(
        internal.madridDatisStream.clearStoppedStreamListener,
        {
          stationIcao,
          generation: args.generation,
          endedAt: Date.now(),
        },
      );
      return {
        status: localRuntime.ready
          ? plan.status
          : localRuntime.status,
        stationIcao,
        generation: args.generation,
      };
    }

    // autoConnect=false means constructing the Socket.IO client does not
    // contact Airframes. Both gates are checked once more immediately before
    // the explicit connect below.
    const socket = socketFactory(
      plan.connection.url,
      plan.connection.options,
    );
    let stopping = false;
    let listening = false;
    let heartbeatBusy = false;
    let providerEventCount = 0;
    let candidateCount = 0;
    let parsedCount = 0;
    let storedCount = 0;
    let lastProviderEventAt;
    let lastHeartbeatStoredAt = startedAt;
    let processing = Promise.resolve();
    const controlTasks = new Set();
    let subscriptionAckTimeoutId;
    let heartbeatIntervalId;
    let sessionTimeoutId;
    let resolveSession;
    const sessionDone = new Promise((resolve) => {
      resolveSession = resolve;
    });

    function snapshot(outcome, message) {
      return {
        outcome,
        message,
        providerEventCount,
        candidateCount,
        parsedCount,
        storedCount,
        lastProviderEventAt,
      };
    }

    function clearSessionTimers() {
      clearTimeout(subscriptionAckTimeoutId);
      clearTimeout(sessionTimeoutId);
      clearInterval(heartbeatIntervalId);
    }

    function trackControlTask(task) {
      let tracked;
      tracked = Promise.resolve(task)
        .catch((error) => {
          stopImmediately(
            "error",
            safeErrorMessage(error, "Airframes control task failed."),
          );
        })
        .finally(() => {
          controlTasks.delete(tracked);
        });
      controlTasks.add(tracked);
      return tracked;
    }

    function stopImmediately(outcome, message) {
      if (stopping) {
        return;
      }
      stopping = true;
      listening = false;
      clearSessionTimers();
      socket.disconnect();
      socket.removeAllListeners();
      resolveSession({ outcome, message });
    }

    async function stopAfterDrain(outcome, message) {
      if (stopping) {
        return;
      }
      stopping = true;
      listening = false;
      clearSessionTimers();
      socket.disconnect();
      socket.removeAllListeners();
      try {
        await processing;
      } catch {
        // The processing chain converts each failure into a session stop.
      }
      resolveSession({ outcome, message });
    }

    async function storeCandidate(payload) {
      if (stopping || !listening) {
        return;
      }
      const runtime = await getFreshStreamRuntime(
        ctx,
        stationIcao,
        getApprovalValue,
        getConnectionEnabledValue,
      );
      if (stopping) {
        return;
      }
      if (!runtime.ready) {
        stopImmediately("gated", runtime.status);
        return;
      }
      const parsed = parseAirframesDatisStreamEvent("message", payload, {
        approvalValue: "true",
        nowMs: Date.now(),
      });
      if (parsed.status !== "ok" || parsed.rows.length === 0) {
        return;
      }
      parsedCount += parsed.rows.length;

      // The fresh query above gates derivation. The pure handoff and the
      // storage mutation independently fail closed before persistence.
      const storePlan = buildAirframesDatisStreamStoreArgs(parsed, {
        approvalValue: getApprovalValue(),
        connectionEnabledValue: getConnectionEnabledValue(),
        attemptedAt: Date.now(),
      });
      if (storePlan.status !== "ready") {
        stopImmediately("gated", storePlan.status);
        return;
      }
      const stored = await ctx.runMutation(
        internal.madridDatisStream.storeStreamDatisRows,
        {
          stationIcao,
          generation: args.generation,
          matchedAt: Date.now(),
          rows: storePlan.storeArgs.rows,
        },
      );
      if (stopping) {
        return;
      }
      if (
        stored.status === "approval_required" ||
        stored.status === "connection_disabled" ||
        stored.status === "generation_stale"
      ) {
        stopImmediately("gated", stored.status);
        return;
      }
      storedCount += stored.insertedCount + stored.updatedCount;
    }

    socket.on("connect", () => {
      trackControlTask((async () => {
        try {
          const runtime = await getFreshStreamRuntime(
            ctx,
            stationIcao,
            getApprovalValue,
            getConnectionEnabledValue,
          );
          if (stopping) {
            return;
          }
          if (!runtime.ready) {
            stopImmediately("gated", runtime.status);
            return;
          }
          const connectedAt = Date.now();
          const recorded = await ctx.runMutation(
            internal.madridDatisStream.recordStreamConnected,
            {
              stationIcao,
              generation: args.generation,
              connectedAt,
            },
          );
          if (stopping) {
            return;
          }
          if (recorded.status !== "connecting") {
            stopImmediately("gated", recorded.status);
            return;
          }
          const stillReady = await getFreshStreamRuntime(
            ctx,
            stationIcao,
            getApprovalValue,
            getConnectionEnabledValue,
          );
          if (stopping) {
            return;
          }
          if (!stillReady.ready) {
            stopImmediately("gated", stillReady.status);
            return;
          }
          if (stopping) {
            return;
          }
          socket.emit(plan.subscription.event, ...plan.subscription.args);
          subscriptionAckTimeoutId = setTimeout(() => {
            void stopAfterDrain(
              "error",
              "Airframes did not acknowledge the stream subscription.",
            );
          }, subscriptionAckTimeoutMs);
        } catch (error) {
          void stopAfterDrain(
            "error",
            safeErrorMessage(error, "Airframes connection setup failed."),
          );
        }
      })());
    });

    socket.on("messages:sniff:started", () => {
      trackControlTask((async () => {
        try {
          const runtime = await getFreshStreamRuntime(
            ctx,
            stationIcao,
            getApprovalValue,
            getConnectionEnabledValue,
          );
          if (stopping) {
            return;
          }
          if (!runtime.ready) {
            stopImmediately("gated", runtime.status);
            return;
          }
          const subscribedAt = Date.now();
          const recorded = await ctx.runMutation(
            internal.madridDatisStream.recordStreamListening,
            {
              stationIcao,
              generation: args.generation,
              subscribedAt,
            },
          );
          if (stopping) {
            return;
          }
          if (recorded.status !== "listening") {
            stopImmediately("gated", recorded.status);
            return;
          }
          clearTimeout(subscriptionAckTimeoutId);
          listening = true;
        } catch (error) {
          void stopAfterDrain(
            "error",
            safeErrorMessage(error, "Airframes subscription setup failed."),
          );
        }
      })());
    });

    socket.on("message", (payload) => {
      if (stopping || !listening) {
        return;
      }
      const runtime = localStreamRuntime(
        getApprovalValue,
        getConnectionEnabledValue,
      );
      if (!runtime.ready) {
        stopImmediately("gated", runtime.status);
        return;
      }
      providerEventCount += 1;
      lastProviderEventAt = Date.now();
      if (providerEventCount > MAX_PROVIDER_EVENTS_PER_SESSION) {
        void stopAfterDrain(
          "limit",
          "Airframes session event safety limit reached.",
        );
        return;
      }
      const text =
        payload && typeof payload === "object" ? payload.text : null;
      if (
        typeof text !== "string" ||
        text.length > 16 * 1024 ||
        !LEMD_DATIS_PATTERN.test(text)
      ) {
        return;
      }
      candidateCount += 1;
      if (candidateCount > MAX_CANDIDATES_PER_SESSION) {
        void stopAfterDrain(
          "limit",
          "Airframes LEMD candidate safety limit reached.",
        );
        return;
      }
      processing = processing
        .then(async () => await storeCandidate(payload))
        .catch((error) => {
          stopImmediately(
            "error",
            safeErrorMessage(error, "Airframes message processing failed."),
          );
        });
    });

    socket.on("connect_error", (error) => {
      void stopAfterDrain(
        "error",
        safeErrorMessage(error, "Airframes connection failed."),
      );
    });
    socket.on("error", (error) => {
      void stopAfterDrain(
        "error",
        safeErrorMessage(error, "Airframes stream error."),
      );
    });
    socket.on("feed:error", (error) => {
      void stopAfterDrain(
        "error",
        safeErrorMessage(error, "Airframes authentication error."),
      );
    });
    socket.on("disconnect", (reason) => {
      if (!stopping) {
        void stopAfterDrain(
          "disconnected",
          `Airframes disconnected: ${safeErrorMessage(reason, "unknown reason")}`,
        );
      }
    });

    heartbeatIntervalId = setInterval(() => {
      if (heartbeatBusy || stopping) {
        return;
      }
      heartbeatBusy = true;
      trackControlTask((async () => {
        try {
          const heartbeatAt = Date.now();
          const runtime = await getFreshStreamRuntime(
            ctx,
            stationIcao,
            getApprovalValue,
            getConnectionEnabledValue,
          );
          if (stopping) {
            return;
          }
          if (!runtime.ready) {
            stopImmediately("gated", runtime.status);
            return;
          }
          if (
            heartbeatAt - lastHeartbeatStoredAt >=
            heartbeatStoreMs
          ) {
            const recorded = await ctx.runMutation(
              internal.madridDatisStream.recordStreamHeartbeat,
              {
                stationIcao,
                generation: args.generation,
                heartbeatAt,
                providerEventCount,
                candidateCount,
                parsedCount,
                storedCount,
                ...(Number.isFinite(lastProviderEventAt)
                  ? { lastProviderEventAt }
                  : {}),
              },
            );
            if (stopping) {
              return;
            }
            if (
              recorded.status === "approval_required" ||
              recorded.status === "connection_disabled" ||
              recorded.status === "generation_stale"
            ) {
              stopImmediately("gated", recorded.status);
              return;
            }
            lastHeartbeatStoredAt = heartbeatAt;
          }
        } catch (error) {
          void stopAfterDrain(
            "error",
            safeErrorMessage(error, "Airframes approval heartbeat failed."),
          );
        } finally {
          heartbeatBusy = false;
        }
      })());
    }, heartbeatCheckMs);

    const remainingLeaseMs =
      args.leaseUntil - Date.now() - LEASE_SAFETY_MARGIN_MS;
    const sessionDurationMs = Math.max(
      1_000,
      Math.min(maximumSessionMs, remainingLeaseMs),
    );
    sessionTimeoutId = setTimeout(() => {
      void stopAfterDrain("rotate", "Scheduled listener rotation.");
    }, sessionDurationMs);

    const connectRuntime = await getFreshStreamRuntime(
      ctx,
      stationIcao,
      getApprovalValue,
      getConnectionEnabledValue,
    );
    if (!connectRuntime.ready) {
      stopImmediately("gated", connectRuntime.status);
    } else {
      socket.connect();
    }

    const stopResult = await sessionDone;
    await Promise.allSettled([processing, ...controlTasks]);
    const result = snapshot(stopResult.outcome, stopResult.message);
    if (result.outcome === "gated") {
      await ctx.runMutation(
        internal.madridDatisStream.clearStoppedStreamListener,
        {
          stationIcao,
          generation: args.generation,
          endedAt: Date.now(),
        },
      );
      return {
        status:
          result.message === "connection_disabled"
            ? "connection_disabled"
            : result.message === "generation_stale"
              ? "generation_stale"
              : "approval_required",
        stationIcao,
        generation: args.generation,
      };
    }
    const finished = await ctx.runMutation(
      internal.madridDatisStream.finishStreamListener,
      {
        stationIcao,
        generation: args.generation,
        endedAt: Date.now(),
        outcome: result.outcome,
        message: result.message,
        providerEventCount: result.providerEventCount,
        candidateCount: result.candidateCount,
        parsedCount: result.parsedCount,
        storedCount: result.storedCount,
        ...(Number.isFinite(result.lastProviderEventAt)
          ? { lastProviderEventAt: result.lastProviderEventAt }
          : {}),
      },
    );
    return {
      ...finished,
      stationIcao,
      generation: args.generation,
      outcome: result.outcome,
    };
}

export const listenAirframesDatisStream = internalActionGeneric({
  args: {
    stationIcao: v.string(),
    generation: v.string(),
    leaseUntil: v.number(),
  },
  handler: async (ctx, args) =>
    await runAirframesDatisStreamSession(ctx, args),
});
