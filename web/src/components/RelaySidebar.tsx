import { useState } from "react";

import type { TaskArtifact } from "../../../shared/taskArtifacts.js";
import { evidenceAssets } from "./ArtifactRegistry.js";
import { CallBridgeIcon, CloseIcon, GalleryIcon, PlusIcon, SearchIcon } from "./Icons.js";
import { ThreadList } from "@/components/assistant-ui/elements/thread-list";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useMediaQuery } from "@/hooks/use-media-query";

export type TaskMedia = {
  artifactId: string;
  alt: string;
  caption: string;
  src: string;
};

export type RecentTask = {
  taskId: string;
  title: string;
  time: string;
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

function SidebarContent({
  currentTaskId,
  media,
  recentTasks,
  onClose,
  onNewTask,
  onOpenGallery,
  onSelectTask,
}: {
  currentTaskId: string;
  media: readonly TaskMedia[];
  recentTasks: readonly RecentTask[];
  onClose?: () => void;
  onNewTask: () => void;
  onOpenGallery: () => void;
  onSelectTask: (taskId: string) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const filteredTasks = recentTasks.filter(({ title }) => title.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase()));
  const activeIndex = filteredTasks.findIndex(({ taskId }) => taskId === currentTaskId);
  return (
    <aside className="relay-sidebar" aria-label="Conversations and task media">
      <div className="sidebar-brand-row">
        <div className="sidebar-brand"><span><CallBridgeIcon /></span><strong>CallBridge</strong></div>
        <button className="icon-button mobile-only" type="button" onClick={onClose} aria-label="Close conversations"><CloseIcon /></button>
      </div>
      <nav className="sidebar-primary-nav" aria-label="CallBridge navigation">
        <button className="sidebar-nav-button" type="button" onClick={() => { onNewTask(); onClose?.(); }}><PlusIcon /><span>New task</span></button>
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
        <h2 className="sr-only" id="recent-title">Conversations</h2>
        {filteredTasks.length ? (
          <ThreadList
            threads={filteredTasks}
            activeIndex={activeIndex}
            onActiveIndexChange={(index) => {
              const task = filteredTasks[index];
              if (task) onSelectTask(task.taskId);
              onClose?.();
            }}
            showActions={false}
            className="max-w-none"
          />
        ) : <p className="sidebar-empty">No chats found</p>}
      </section>
      <div className="sidebar-profile">
        <span className="avatar" aria-hidden="true">A</span>
        <span><strong>Aiko</strong><small>Personal</small></span>
      </div>
    </aside>
  );
}

export function RelaySidebar({
  currentTaskId,
  media,
  mobileOpen = false,
  recentTasks,
  onClose,
  onNewTask,
  onOpenGallery,
  onSelectTask,
}: {
  currentTaskId: string;
  media: readonly TaskMedia[];
  mobileOpen?: boolean;
  recentTasks: readonly RecentTask[];
  onClose?: () => void;
  onNewTask: () => void;
  onOpenGallery: () => void;
  onSelectTask: (taskId: string) => void;
}) {
  const mobile = useMediaQuery("(max-width: 820px)");
  const content = (
    <SidebarContent
      currentTaskId={currentTaskId}
      media={media}
      recentTasks={recentTasks}
      {...(onClose ? { onClose } : {})}
      onNewTask={onNewTask}
      onOpenGallery={onOpenGallery}
      onSelectTask={onSelectTask}
    />
  );

  if (!mobile) return content;
  return (
    <Dialog open={mobileOpen} onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <DialogContent
        aria-describedby={undefined}
        className="mobile-sidebar-dialog"
        overlayClassName="sheet-overlay"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Conversations</DialogTitle>
        {content}
      </DialogContent>
    </Dialog>
  );
}
