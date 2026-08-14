const HOSTED_CONVEX_CLOUD_SUFFIX = ".convex.cloud";

function httpsOrigin(value) {
  if (typeof value !== "string" || !value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function resolveConvexSiteOrigin(convexCloudUrl, configuredSiteUrl) {
  const cloudOrigin = httpsOrigin(convexCloudUrl);
  if (cloudOrigin) {
    const cloudUrl = new URL(cloudOrigin);
    if (cloudUrl.hostname.endsWith(HOSTED_CONVEX_CLOUD_SUFFIX)) {
      const deploymentName = cloudUrl.hostname.slice(
        0,
        -HOSTED_CONVEX_CLOUD_SUFFIX.length,
      );
      if (/^[a-z0-9-]+$/.test(deploymentName)) {
        return `https://${deploymentName}.convex.site`;
      }
    }
  }

  return httpsOrigin(configuredSiteUrl);
}
