import { CallBridgeIcon } from "./Icons.js";

export function Header() {
  return (
    <header className="topbar">
      <div className="brand" aria-label="CallBridge">
        <span className="brand-mark"><CallBridgeIcon /></span>
        <span>CallBridge</span>
      </div>
      <div className="topbar-actions">
        <span className="chatgpt-status"><span className="status-dot" />Working with ChatGPT</span>
        <span className="avatar" aria-label="CallBridge account">CB</span>
      </div>
    </header>
  );
}
