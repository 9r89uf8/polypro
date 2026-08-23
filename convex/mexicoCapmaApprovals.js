export const CAPMA_APPROVAL_FLAGS = Object.freeze({
  aftnAccess: Object.freeze({
    canonical: "SENEAM_MMMX_AFTN_ACCESS_APPROVED",
    legacy: "SENEAM_CAPMA_MMMX_AFTN_REPORTS_ACCESS_APPROVED",
  }),
  tdzAccess: Object.freeze({
    canonical: "SENEAM_MMMX_TDZ_ACCESS_APPROVED",
    legacy: "SENEAM_CAPMA_MMMX_TDZ_IMAGES_ACCESS_APPROVED",
  }),
  tdzRetention: Object.freeze({
    canonical: "SENEAM_MMMX_TDZ_RETENTION_APPROVED",
    legacy: "SENEAM_CAPMA_MMMX_TDZ_IMAGES_RETENTION_APPROVED",
  }),
  tdzRepublication: Object.freeze({
    canonical: "SENEAM_MMMX_TDZ_REPUBLICATION_APPROVED",
    legacy: "SENEAM_CAPMA_MMMX_TDZ_DATA_REPUBLICATION_APPROVED",
  }),
});

export function exactTrue(value) {
  return value === "true";
}

function canonicalOrLegacyApproved(env, names) {
  if (Object.prototype.hasOwnProperty.call(env ?? {}, names.canonical)) {
    return exactTrue(env[names.canonical]);
  }
  return exactTrue(env?.[names.legacy]);
}

export function capmaAftnAccessApproved(env = process.env) {
  return canonicalOrLegacyApproved(env, CAPMA_APPROVAL_FLAGS.aftnAccess);
}

// Lives here (isolate-safe) rather than in the "use node" watcher module so
// that isolate queries can read the gate state without pulling the watcher's
// Node-only transport imports into the isolate bundle.
export function mexicoEdgeFastWatchGateState(env = process.env) {
  const baseAccessApproved = capmaAftnAccessApproved(env);
  const highFrequencyAccessApproved = exactTrue(
    env.SENEAM_MMMX_AFTN_HF_ACCESS_APPROVED,
  );
  const collectionEnabled = exactTrue(env.MEXICO_EDGE_ROUTINE_WATCH_ENABLED);
  return {
    baseAccessApproved,
    highFrequencyAccessApproved,
    collectionEnabled,
    allowed:
      baseAccessApproved && highFrequencyAccessApproved && collectionEnabled,
  };
}

export function capmaTdzApprovalState(env = process.env) {
  const accessApproved = canonicalOrLegacyApproved(
    env,
    CAPMA_APPROVAL_FLAGS.tdzAccess,
  );
  const retentionApproved = canonicalOrLegacyApproved(
    env,
    CAPMA_APPROVAL_FLAGS.tdzRetention,
  );
  const republicationApproved = canonicalOrLegacyApproved(
    env,
    CAPMA_APPROVAL_FLAGS.tdzRepublication,
  );
  return {
    accessApproved,
    retentionApproved,
    republicationApproved,
    collectionApproved: accessApproved && retentionApproved,
    publicationApproved:
      accessApproved && retentionApproved && republicationApproved,
  };
}
