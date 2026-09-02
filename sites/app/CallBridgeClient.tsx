'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { ConvexProvider, ConvexReactClient, useConvexAuth } from 'convex/react';

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

function BrandMark() {
  return (
    <span aria-hidden="true" className="brand-mark">
      <svg fill="none" viewBox="0 0 24 24">
        <path d="M8 4.5h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" />
        <path d="M10 8h4M10 12h4M10 16h2" />
      </svg>
    </span>
  );
}

function AccessState({ kicker, title, detail }: { kicker: string; title: string; detail?: string }) {
  return (
    <div className="access-shell">
      <header className="topbar">
        <div className="brand"><BrandMark />CallBridge</div>
        <div className="chatgpt-status"><span className="status-dot" />Built for ChatGPT</div>
      </header>
      <main className="access-main">
        <section className="access-card">
          <p className="access-kicker">{kicker}</p>
          <h1>{title}</h1>
          <p className="access-copy">
            ChatGPT can prepare and revise a controlled information-gathering call here.
            Only you can confirm it on this webpage.
          </p>
          {detail ? <p className="access-detail">{detail}</p> : null}
        </section>
      </main>
    </div>
  );
}

function AuthenticatedWorkspace({ Workspace }: { Workspace: ComponentType }) {
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
  return <Workspace />;
}

export function CallBridgeClient({ convexUrl }: { convexUrl: string }) {
  const [convex, setConvex] = useState<ConvexReactClient | null>(null);
  const [Workspace, setWorkspace] = useState<ComponentType | null>(null);

  useEffect(() => {
    const client = new ConvexReactClient(convexUrl);
    client.setAuth(fetchChatGPTAccessToken);
    setConvex(client);
    return () => {
      client.clearAuth();
      void client.close();
    };
  }, [convexUrl]);

  useEffect(() => {
    let active = true;
    void import('../../web/src/ProductionApp').then((module) => {
      if (active) setWorkspace(() => module.LiveWorkspace);
    });
    return () => { active = false; };
  }, []);

  if (!convex || !Workspace) {
    return <AccessState kicker="Secure session" title="Connecting your CallBridge workspace" />;
  }

  return (
    <ConvexProvider client={convex}>
      <AuthenticatedWorkspace Workspace={Workspace} />
    </ConvexProvider>
  );
}
