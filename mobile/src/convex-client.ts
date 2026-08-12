import { ConvexReactClient } from "convex/react";

const deploymentUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

/**
 * Deployment is intentionally opt-in. A missing URL means local task state;
 * no request is made to an unknown endpoint and no credential is embedded.
 */
export const convexClient = deploymentUrl ? new ConvexReactClient(deploymentUrl) : null;
export const isConvexConfigured = convexClient !== null;
