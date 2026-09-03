import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  groupPartByType,
} from "@assistant-ui/react";
import type { ReactNode } from "react";

import { ArrowUpIcon, CheckIcon, ChevronDownIcon, GalleryIcon, ToolIcon } from "./Icons.js";

function toolLabel(toolName: string): string {
  const labels: Record<string, string> = {
    read_call_draft: "Read the call draft",
    update_call_draft: "Updated the call draft",
    prepare_confirmation: "Prepared confirmation",
    get_inquiry_result: "Checked the call result",
  };
  return labels[toolName] ?? toolName.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="thread-message user-message">
      <div className="message-surface user-message-surface">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="thread-message assistant-message">
      <div className="message-surface assistant-message-surface">
        <MessagePrimitive.GroupedParts
          indicator="always"
          groupBy={groupPartByType({
            reasoning: ["group-reasoning"],
            "tool-call": ["group-tool"],
          })}
        >
          {({ part, children }) => {
            switch (part.type) {
              case "group-reasoning":
                return (
                  <details className={`reasoning-disclosure ${part.status.type === "running" ? "is-running" : ""}`} open={part.status.type === "running"}>
                    <summary aria-live="polite">
                      <span className="reasoning-wave" aria-hidden="true"><i /><i /><i /><i /></span>
                      <span>{part.status.type === "running" ? "Thinking…" : "Thought through the task"}</span>
                      <ChevronDownIcon />
                    </summary>
                    <div className="reasoning-content">{children}</div>
                  </details>
                );
              case "group-tool":
                return <div className="message-tool-group" aria-label={`${part.indices.length} tool ${part.indices.length === 1 ? "action" : "actions"}`}>{children}</div>;
              case "text":
                return <p className="assistant-text">{part.text}</p>;
              case "indicator":
                return <span className="stream-indicator" aria-label="Response is streaming"><i /><i /><i /></span>;
              case "reasoning":
                return <p>{part.text}</p>;
              case "tool-call":
                return (
                  <div className={`message-tool-row ${part.result === undefined ? "is-running" : ""}`}>
                    <span className="tool-favicon"><ToolIcon /></span>
                    <strong>{toolLabel(part.toolName)}</strong>
                    <span className="message-tool-status">{part.result === undefined ? <span className="stream-pulse" /> : <CheckIcon />}{part.result === undefined ? "Running" : "Done"}</span>
                  </div>
                );
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
      </div>
    </MessagePrimitive.Root>
  );
}

export function ConversationComposer({ onOpenGallery }: { onOpenGallery?: () => void }) {
  return (
    <div className="composer-dock">
      <ComposerPrimitive.Root className="conversation-composer">
        <ComposerPrimitive.Input
          id="callbridge-composer"
          aria-label="Message CallBridge"
          className="composer-input"
          placeholder="Message CallBridge"
          rows={1}
        />
        <div className="composer-controls">
          <div className="composer-control-group">
            {onOpenGallery ? <button className="composer-icon-button" type="button" onClick={onOpenGallery} aria-label="Open task images" title="Open task images"><GalleryIcon /></button> : null}
          </div>
          <ComposerPrimitive.Send className="composer-send" aria-label="Send message">
            <ArrowUpIcon />
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
      <p className="composer-assurance">CallBridge can make mistakes. Check important information.</p>
    </div>
  );
}

export function AssistantThread({ children, onOpenGallery }: { children: ReactNode; onOpenGallery?: () => void }) {
  return (
    <ThreadPrimitive.Root className="assistant-thread">
      <ThreadPrimitive.Viewport
        className="thread-viewport"
        turnAnchor="top"
        scrollToBottomOnInitialize={false}
        scrollToBottomOnThreadSwitch={false}
      >
        <div className="thread-content">
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          {children}
        </div>
        <ThreadPrimitive.ViewportFooter className="thread-footer">
          <ThreadPrimitive.ScrollToBottom className="scroll-to-bottom" aria-label="Scroll to the latest message"><ChevronDownIcon /></ThreadPrimitive.ScrollToBottom>
          <ConversationComposer {...(onOpenGallery ? { onOpenGallery } : {})} />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
