import { ActivityIcon, ChevronDownIcon, GalleryIcon, MenuIcon, MoreIcon } from "./Icons.js";

export function Header({
  onOpenActivity,
  onOpenNavigation,
  onOpenGallery,
  status,
  title,
}: {
  onOpenActivity?: () => void;
  onOpenNavigation?: () => void;
  onOpenGallery?: () => void;
  status?: string;
  title?: string;
} = {}) {
  return (
    <header className="topbar">
      <div className="topbar-leading">
        {onOpenNavigation ? <button className="icon-button mobile-only" type="button" onClick={onOpenNavigation} aria-label="Open conversations"><MenuIcon /></button> : null}
        <button className="model-switcher" type="button" aria-label="Current assistant: CallBridge">CallBridge <ChevronDownIcon /></button>
      </div>
      {title ? <div className="topbar-task-title" title={title}>{title}</div> : null}
      <div className="topbar-actions">
        {status ? <span className="task-status-label"><span className="status-dot" />{status}</span> : null}
        {onOpenGallery ? <button className="icon-button" type="button" onClick={onOpenGallery} aria-label="Open task pictures" title="Files and images"><GalleryIcon /></button> : null}
        {onOpenActivity ? <button className="icon-button" type="button" onClick={onOpenActivity} aria-label="Open activity" title="Activity"><ActivityIcon /></button> : null}
        <button className="icon-button" type="button" aria-label="More options" title="More options"><MoreIcon /></button>
      </div>
    </header>
  );
}
