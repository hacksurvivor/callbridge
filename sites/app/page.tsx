import { chatGPTSignInPath, getChatGPTUser } from './chatgpt-auth';
import { CallBridgeClient } from './CallBridgeClient';

export const dynamic = 'force-dynamic';

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

function Header() {
  return (
    <header className="topbar">
      <div className="brand"><BrandMark />Concierge</div>
      <div className="chatgpt-status"><span className="status-dot" />Built for ChatGPT</div>
    </header>
  );
}

export default async function Home() {
  const user = await getChatGPTUser();
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();

  if (user && convexUrl) return <CallBridgeClient convexUrl={convexUrl} />;

  return (
    <div className="access-shell">
      <Header />
      <main className="access-main">
        <section className="access-card">
          <p className="access-kicker">Private call tasks</p>
          <h1>{user ? 'Concierge is not configured' : 'Sign in to continue'}</h1>
          <p className="access-copy">
            ChatGPT can prepare and revise a controlled information-gathering call here.
            Only you can confirm it on this webpage.
          </p>
          {user ? (
            <p className="access-detail">The production data service is missing from this deployment.</p>
          ) : (
            <div className="auth-actions">
              <a className="button primary auth-primary" href={chatGPTSignInPath('/')} target="_top">
                Continue with ChatGPT
              </a>
              <span className="auth-divider">or</span>
              <a className="button auth-secondary" href="https://callbridge-web.pages.dev/callback" target="_top">
                Continue with email
              </a>
            </div>
          )}
          <p className="access-detail">
            Your identity protects private drafts. A call still requires a separate, visible confirmation.
          </p>
        </section>
      </main>
    </div>
  );
}
