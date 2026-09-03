import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  groupPartByType,
} from "@assistant-ui/react";
import type { ReactNode } from "react";

import { ArrowUpIcon, CheckIcon, ChevronDownIcon, MicrophoneIcon, PaperclipIcon, ToolIcon } from "./Icons.js";

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
                return (
                  <div className={`message-tool-row ${part.status.type === "running" ? "is-running" : ""}`}>
                    <ToolIcon />
                    <span><strong>{part.status.type === "running" ? "Using CallBridge tools" : "Checked the call draft"}</strong><small>{part.indices.length} {part.indices.length === 1 ? "tool" : "tools"}</small></span>
                    <span className="message-tool-status">{part.status.type === "running" ? <span className="stream-pulse" /> : <CheckIcon />}{part.status.type === "running" ? "Running" : "Complete"}</span>
                  </div>
                );
              case "text":
                return <p className="assistant-text">{part.text}</p>;
              case "indicator":
                return <span className="stream-indicator" aria-label="Response is streaming"><i /><i /><i /></span>;
              case "reasoning":
                return <p>{part.text}</p>;
              case "tool-call":
                return null;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
      </div>
    </MessagePrimitive.Root>
  );
}

export function ConversationComposer() {
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
            <ComposerPrimitive.AddAttachment className="composer-icon-button" aria-label="Add an attachment" title="Add an attachment" disabled>
              <PaperclipIcon />
            </ComposerPrimitive.AddAttachment>
            <ComposerPrimitive.Dictate className="composer-icon-button" aria-label="Dictate a message" title="Dictate a message">
              <MicrophoneIcon />
            </ComposerPrimitive.Dictate>
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

export function AssistantThread({ children }: { children: ReactNode }) {
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
          <ConversationComposer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
