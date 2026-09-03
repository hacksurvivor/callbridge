import { useState } from "react";

import { ActivityIcon, ChevronDownIcon, GalleryIcon, MenuIcon, MoreIcon } from "./Icons.js";

export function Header({
  onOpenActivity,
  onOpenNavigation,
  onOpenGallery,
}: {
  onOpenActivity?: () => void;
  onOpenNavigation?: () => void;
  onOpenGallery?: () => void;
} = {}) {
  const [assistantMenuOpen, setAssistantMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  return (
    <header className="topbar">
      <div className="topbar-leading">
        {onOpenNavigation ? <button className="icon-button mobile-only" type="button" onClick={onOpenNavigation} aria-label="Open conversations"><MenuIcon /></button> : null}
        <div className="popover-wrap">
          <button className="model-switcher" type="button" aria-expanded={assistantMenuOpen} aria-label="Current assistant: CallBridge" onClick={() => { setAssistantMenuOpen((value) => !value); setMoreMenuOpen(false); }}>CallBridge <ChevronDownIcon /></button>
          {assistantMenuOpen ? (
            <div className="topbar-popover assistant-popover" role="dialog" aria-label="About CallBridge">
              <strong>CallBridge</strong>
              <p>Prepares one bounded phone task and waits for your explicit approval.</p>
            </div>
          ) : null}
        </div>
      </div>
      <div className="topbar-actions">
        {onOpenActivity ? <button className="icon-button" type="button" onClick={onOpenActivity} aria-label="Open activity" title="Activity"><ActivityIcon /></button> : null}
        <div className="popover-wrap">
          <button className="icon-button" type="button" aria-expanded={moreMenuOpen} aria-label="More options" title="More options" onClick={() => { setMoreMenuOpen((value) => !value); setAssistantMenuOpen(false); }}><MoreIcon /></button>
          {moreMenuOpen ? (
            <div className="topbar-popover action-menu" role="menu">
              {onOpenGallery ? <button type="button" role="menuitem" onClick={() => { onOpenGallery(); setMoreMenuOpen(false); }}><GalleryIcon />Files & images</button> : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
