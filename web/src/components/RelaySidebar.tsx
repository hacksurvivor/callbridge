import { ThreadListItemPrimitive, ThreadListPrimitive } from "@assistant-ui/react";
import { useState } from "react";

import type { TaskArtifact } from "../../../shared/taskArtifacts.js";
import { evidenceAssets } from "./ArtifactRegistry.js";
import { CallBridgeIcon, CloseIcon, GalleryIcon, MoreIcon, PlusIcon, SearchIcon } from "./Icons.js";

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

function ThreadListItem() {
  return (
    <ThreadListItemPrimitive.Root className="thread-list-item">
      <ThreadListItemPrimitive.Trigger className="thread-list-trigger">
        <ThreadListItemPrimitive.Title fallback="Current call task" />
        <MoreIcon />
      </ThreadListItemPrimitive.Trigger>
    </ThreadListItemPrimitive.Root>
  );
}

export function RelaySidebar({
  media,
  mobileOpen = false,
  onClose,
  onOpenGallery,
}: {
  media: readonly TaskMedia[];
  mobileOpen?: boolean;
  onClose?: () => void;
  onOpenGallery: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <aside className={`relay-sidebar ${mobileOpen ? "is-open" : ""}`} aria-label="Conversations and task media">
      <div className="sidebar-brand-row">
        <div className="sidebar-brand"><span><CallBridgeIcon /></span><strong>CallBridge</strong></div>
        <button className="icon-button mobile-only" type="button" onClick={onClose} aria-label="Close conversations"><CloseIcon /></button>
      </div>
      <ThreadListPrimitive.New className="sidebar-nav-button"><PlusIcon /><span>New task</span></ThreadListPrimitive.New>
      <button className="sidebar-nav-button" type="button" aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)}><SearchIcon /><span>Search</span></button>
      <button className="sidebar-nav-button" type="button" onClick={onOpenGallery} disabled={!media.length}><GalleryIcon /><span>Files & images</span><small>{media.length || ""}</small></button>
      {searchOpen ? (
        <label className="sidebar-search">
          <span className="sr-only">Filter conversations</span>
          <SearchIcon />
          <input autoFocus placeholder="Filter conversations" type="search" />
        </label>
      ) : null}
      <section className="conversation-section" aria-labelledby="recent-title">
        <h2 id="recent-title">Today</h2>
        <ThreadListPrimitive.Root className="thread-list">
          <ThreadListPrimitive.Items components={{ ThreadListItem }} />
        </ThreadListPrimitive.Root>
      </section>
      <div className="sidebar-profile">
        <span className="avatar" aria-hidden="true">A</span>
        <span>Aiko</span>
        <MoreIcon />
      </div>
    </aside>
  );
}
