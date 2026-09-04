import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import type { ReactNode } from "react";

export function AssistantThread({ children }: { children: ReactNode }) {
  return (
    <Thread
      autoFocus={false}
      autoScroll={false}
      afterMessages={<div className="callbridge-thread-extras">{children}</div>}
    />
  );
}
