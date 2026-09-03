import { useEffect, useState } from "react";
import { DropdownMenu, Popover } from "radix-ui";

import { ActivityIcon, ChevronDownIcon, GalleryIcon, MenuIcon, MoreIcon, ThemeIcon } from "./Icons.js";

function initialDarkMode(): boolean {
  if (typeof window === "undefined") return false;
  const saved = window.localStorage.getItem("callbridge-theme");
  if (saved) return saved === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

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
  const [darkMode, setDarkMode] = useState(initialDarkMode);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    window.localStorage.setItem("callbridge-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  return (
    <header className="topbar">
      <div className="topbar-leading">
        {onOpenNavigation ? <button className="icon-button mobile-only" type="button" onClick={onOpenNavigation} aria-label="Open conversations"><MenuIcon /></button> : null}
        <Popover.Root open={assistantMenuOpen} onOpenChange={(open) => { setAssistantMenuOpen(open); if (open) setMoreMenuOpen(false); }}>
          <Popover.Trigger asChild>
            <button className="model-switcher" type="button" aria-label="Current assistant: CallBridge">CallBridge <ChevronDownIcon /></button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="topbar-popover assistant-popover" align="start" sideOffset={6}>
              <strong>CallBridge</strong>
              <p>Prepares one bounded phone task and waits for your explicit approval.</p>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      <div className="topbar-actions">
        {onOpenActivity ? <button className="icon-button" type="button" onClick={onOpenActivity} aria-label="Open activity" title="Activity"><ActivityIcon /></button> : null}
        <DropdownMenu.Root open={moreMenuOpen} onOpenChange={(open) => { setMoreMenuOpen(open); if (open) setAssistantMenuOpen(false); }}>
          <DropdownMenu.Trigger asChild>
            <button className="icon-button" type="button" aria-label="More options" title="More options"><MoreIcon /></button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="topbar-popover action-menu" align="end" sideOffset={6}>
              {onOpenGallery ? <DropdownMenu.Item className="action-menu-item" onSelect={onOpenGallery}><GalleryIcon />Files & images</DropdownMenu.Item> : null}
              <DropdownMenu.Item className="action-menu-item" onSelect={() => setDarkMode((value) => !value)}><ThemeIcon />{darkMode ? "Use light mode" : "Use dark mode"}</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
