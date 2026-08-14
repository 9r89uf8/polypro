export const AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG =
  "AIRFRAMES_LEMD_STREAM_APPROVED";
export const AIRFRAMES_DATIS_STREAM_CONNECTION_FLAG =
  "AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED";
export const AIRFRAMES_DATIS_STREAM_URL = "wss://ws.airframes.io";
export const AIRFRAMES_DATIS_STREAM_SUBSCRIBE_EVENT = "messages:sniff";

const SOCKET_TIMEOUT_MS = 12 * 1000;

/**
 * Evaluate the stream approval for the anonymous sampled global feed.
 *
 * The existing REST API key is deliberately not reused: authenticating the
 * Socket.IO connection would also deliver the account's own-station feed,
 * which is outside this minimized integration. Callers must re-run this check
 * before connect, subscribe, reconnect, processing a message, and storing
 * derived data.
 */
export function evaluateAirframesDatisStreamAccess(approvalValue) {
  if (approvalValue !== "true") {
    return {
      approved: false,
      configured: false,
      status: "approval_required",
    };
  }

  return {
    approved: true,
    configured: true,
    status: "approved",
    authentication: "anonymous",
  };
}

/**
 * Evaluate the independent operational kill switch.
 *
 * Written approval and permission to operate the currently unavailable
 * Airframes transport are intentionally separate decisions. The listener may
 * run only when both flags are the exact string "true".
 */
export function evaluateAirframesDatisStreamConnection(
  connectionEnabledValue,
) {
  if (connectionEnabledValue !== "true") {
    return {
      enabled: false,
      configured: false,
      status: "connection_disabled",
    };
  }

  return {
    enabled: true,
    configured: true,
    status: "connection_enabled",
  };
}

export function evaluateAirframesDatisStreamRuntime(
  approvalValue,
  connectionEnabledValue,
) {
  const approval = evaluateAirframesDatisStreamAccess(approvalValue);
  const connection = evaluateAirframesDatisStreamConnection(
    connectionEnabledValue,
  );
  return {
    approved: approval.approved,
    connectionEnabled: connection.enabled,
    ready: approval.approved && connection.enabled,
    status: !approval.approved ? approval.status : connection.status,
    authentication: approval.approved
      ? approval.authentication
      : "disabled",
  };
}

/**
 * Return a transport-neutral Socket.IO connection plan.
 *
 * autoConnect and reconnection are intentionally disabled. The orchestrator
 * must re-evaluate both Convex flags immediately before each explicit
 * connect/reconnect and before emitting the subscription event.
 */
export function buildAirframesDatisStreamConnectionPlan(
  approvalValue,
  connectionEnabledValue,
) {
  const runtime = evaluateAirframesDatisStreamRuntime(
    approvalValue,
    connectionEnabledValue,
  );
  if (!runtime.ready) {
    return {
      status: runtime.status,
      approved: runtime.approved,
      connectionEnabled: runtime.connectionEnabled,
      flagName: AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG,
      approvalFlagName: AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG,
      connectionFlagName: AIRFRAMES_DATIS_STREAM_CONNECTION_FLAG,
      connection: null,
      subscription: null,
    };
  }

  return {
    status: "connection_enabled",
    approved: true,
    connectionEnabled: true,
    flagName: AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG,
    approvalFlagName: AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG,
    connectionFlagName: AIRFRAMES_DATIS_STREAM_CONNECTION_FLAG,
    authentication: runtime.authentication,
    connection: {
      url: AIRFRAMES_DATIS_STREAM_URL,
      options: {
        transports: ["websocket"],
        autoConnect: false,
        reconnection: false,
        timeout: SOCKET_TIMEOUT_MS,
      },
    },
    subscription: {
      event: AIRFRAMES_DATIS_STREAM_SUBSCRIBE_EVENT,
      args: [],
      sampled: true,
    },
  };
}

export function assertAirframesDatisStreamApproved(approvalValue) {
  if (
    evaluateAirframesDatisStreamAccess(approvalValue).status !==
    "approved"
  ) {
    throw new Error(
      `Approval required: ${AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG} must be the exact string true.`,
    );
  }
}
