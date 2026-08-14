export const AIRFRAMES_DATIS_APPROVAL_FLAG =
  "AIRFRAMES_LEMD_DATIS_ACCESS_APPROVED";
export const AIRFRAMES_DATIS_API_KEY_ENV = "AIRFRAMES_API_KEY";

export function evaluateAirframesDatisAccess(
  approvalValue,
  apiKeyValue,
) {
  if (approvalValue !== "true") {
    return {
      approved: false,
      configured: false,
      status: "approval_required",
    };
  }

  const apiKey = String(apiKeyValue ?? "").trim();
  return {
    approved: true,
    configured: true,
    status: "approved",
    authentication: apiKey ? "bearer" : "anonymous",
    apiKey: apiKey || null,
  };
}
