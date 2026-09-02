'use client';

import { useEffect, useMemo } from 'react';
import { ConvexProvider, ConvexReactClient, useConvexAuth } from 'convex/react';

import { AccessState, LiveWorkspace } from '../../web/src/ProductionApp';

type SessionResponse = { token?: string; error?: string };

async function fetchChatGPTAccessToken(): Promise<string | null> {
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  const body = await response.json() as SessionResponse;
  return response.ok && body.token ? body.token : null;
}

function AuthenticatedWorkspace() {
  const auth = useConvexAuth();
  if (auth.isLoading) {
    return <AccessState kicker="Secure session" title="Connecting your CallBridge workspace" />;
  }
  if (!auth.isAuthenticated) {
    return (
      <AccessState
        kicker="Secure session"
        title="ChatGPT sign-in could not reach CallBridge"
        detail="Reload this page to create a new short-lived session. No WebMCP tools were registered."
      />
    );
  }
  return <LiveWorkspace />;
}

export function CallBridgeClient({ convexUrl }: { convexUrl: string }) {
  const convex = useMemo(() => new ConvexReactClient(convexUrl), [convexUrl]);

  useEffect(() => {
    convex.setAuth(fetchChatGPTAccessToken);
    return () => convex.clearAuth();
  }, [convex]);

  return (
    <ConvexProvider client={convex}>
      <AuthenticatedWorkspace />
    </ConvexProvider>
  );
}
