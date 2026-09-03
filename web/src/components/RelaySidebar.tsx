import { useState } from "react";

import type { TaskArtifact } from "../../../shared/taskArtifacts.js";
import { evidenceAssets } from "./ArtifactRegistry.js";
import { CallBridgeIcon, CloseIcon, GalleryIcon, SearchIcon } from "./Icons.js";

export type TaskMedia = {
  artifactId: string;
  alt: string;
  caption: string;
  src: string;
};

export function taskMediaFromArtifacts(artifacts: readonly TaskArtifact[]): TaskMedia[] {
  return artifacts.flatMap((artifact) => {
    const payload = artifact.payload;
    if (payload.type !== "evidence" || payload.redactionState === "blocked") return [];
    const asset = evidenceAssets[payload.assetRef];
    if (!asset) return [];
    return [{
      artifactId: artifact.artifactId,
      alt: asset.alt,
      caption: payload.caption,
      src: asset.src,
    }];
  });
}

export function RelaySidebar({
  currentTitle,
  media,
  mobileOpen = false,
  onClose,
  onOpenGallery,
}: {
  currentTitle: string;
  media: readonly TaskMedia[];
  mobileOpen?: boolean;
  onClose?: () => void;
  onOpenGallery: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const matchesCurrent = currentTitle.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase());
  return (
    <aside className={`relay-sidebar ${mobileOpen ? "is-open" : ""}`} aria-label="Conversations and task media">
      <div className="sidebar-brand-row">
        <div className="sidebar-brand"><span><CallBridgeIcon /></span><strong>CallBridge</strong></div>
        <button className="icon-button mobile-only" type="button" onClick={onClose} aria-label="Close conversations"><CloseIcon /></button>
      </div>
      <nav className="sidebar-primary-nav" aria-label="CallBridge navigation">
        <button className="sidebar-nav-button" type="button" aria-expanded={searchOpen} onClick={() => { setSearchOpen((value) => !value); setSearchQuery(""); }}><SearchIcon /><span>Search chats</span></button>
        <button className="sidebar-nav-button" type="button" onClick={onOpenGallery} disabled={!media.length}><GalleryIcon /><span>Images</span><small>{media.length || ""}</small></button>
      </nav>
      {searchOpen ? (
        <label className="sidebar-search">
          <span className="sr-only">Filter conversations</span>
          <SearchIcon />
          <input autoFocus onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search chats" type="search" value={searchQuery} />
        </label>
      ) : null}
      <section className="conversation-section" aria-labelledby="recent-title">
        <h2 id="recent-title">Today</h2>
        <div className="thread-list">
          {matchesCurrent ? (
            <button className="thread-list-trigger is-active" type="button" onClick={onClose} aria-current="page">
              <span>{currentTitle}</span>
            </button>
          ) : <p className="sidebar-empty">No chats found</p>}
        </div>
      </section>
      <div className="sidebar-profile">
        <span className="avatar" aria-hidden="true">A</span>
        <span><strong>Aiko</strong><small>Personal</small></span>
      </div>
    </aside>
  );
}
