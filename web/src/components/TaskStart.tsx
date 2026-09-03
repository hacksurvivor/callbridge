import { useState, type FormEvent } from "react";

import { ArrowUpIcon, CallBridgeIcon } from "./Icons.js";

export function TaskStart({
  destination,
  onCancel,
  onCreate,
}: {
  destination: string;
  onCancel: () => void;
  onCreate: (objective: string) => Promise<void>;
}) {
  const [objective, setObjective] = useState("");
  const [state, setState] = useState<"idle" | "creating" | "error">("idle");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = objective.trim();
    if (!normalized || state === "creating") return;
    setState("creating");
    try {
      await onCreate(normalized);
    } catch {
      setState("error");
    }
  };

  return (
    <main className="task-start-main">
      <section className="task-start" aria-labelledby="task-start-title">
        <span className="task-start-mark" aria-hidden="true"><CallBridgeIcon /></span>
        <h1 id="task-start-title">What should I ask?</h1>
        <p>Start a separate task for {destination}. The destination and safety limits carry over; you will review the full plan before any call.</p>
        <form className="task-start-composer" onSubmit={submit}>
          <label className="sr-only" htmlFor="new-task-objective">New task request</label>
          <textarea
            autoFocus
            id="new-task-objective"
            onChange={(event) => { setObjective(event.target.value); if (state === "error") setState("idle"); }}
            placeholder={`Ask ${destination} about…`}
            rows={2}
            value={objective}
          />
          <div>
            <span>{state === "creating" ? "Creating a reviewable draft…" : "No call starts from this message."}</span>
            <button aria-label="Create task draft" disabled={!objective.trim() || state === "creating"} type="submit"><ArrowUpIcon /></button>
          </div>
        </form>
        {state === "error" ? <p className="task-start-error" role="alert">The draft could not be created. Your current task is unchanged.</p> : null}
        <button className="task-start-cancel" type="button" onClick={onCancel}>Back to current task</button>
      </section>
    </main>
  );
}
