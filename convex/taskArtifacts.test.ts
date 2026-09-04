// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import { HOTEL_INQUIRY_GOLDEN_FIXTURE } from "../shared/inquiryFixtures.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.{ts,js}");
const createDraft = makeFunctionReference<"mutation">("inquiries:createDraft");
const createArtifact = makeFunctionReference<"mutation">("taskArtifacts:createTaskArtifact");
const updateArtifact = makeFunctionReference<"mutation">("taskArtifacts:updateTaskArtifact");
const readArtifacts = makeFunctionReference<"query">("taskArtifacts:readTaskArtifacts");
const submitResponse = makeFunctionReference<"mutation">("taskArtifacts:submitUserQuestionResponse");
const beginFixture = makeFunctionReference<"mutation">("taskArtifacts:beginControlledFixture");
const completeFixtureAuth = makeFunctionReference<"mutation">("taskArtifacts:completeControlledFixtureAuthorization");
const attachFixtureEvidence = makeFunctionReference<"mutation">("taskArtifacts:attachControlledFixtureEvidence");

async function draftFor(subject = "artifact_owner") {
  const base = convexTest(schema, modules);
  const owner = base.withIdentity({ subject });
  const draft = await owner.mutation(createDraft, {
    idempotencyKey: `artifact-draft-${subject}`,
    contract: HOTEL_INQUIRY_GOLDEN_FIXTURE,
  });
  return { base, owner, draft };
}

describe("task artifact durable state", () => {
  it("requires auth, enforces ownership, and restores deterministic ordering", async () => {
    const { base, owner, draft } = await draftFor();
    const unauthenticated = convexTest(schema, modules);
    await expect(unauthenticated.mutation(createArtifact, {
      taskId: draft.taskId,
      expectedTaskRevision: draft.revision,
      idempotencyKey: "artifact-create-unauthenticated",
      artifact: { type: "user_question", prompt: "Question?", responseMode: "text" },
    })).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });

    await owner.mutation(createArtifact, {
      taskId: draft.taskId,
      expectedTaskRevision: draft.revision,
      idempotencyKey: "artifact-create-question",
      artifact: { type: "user_question", prompt: "Which arrival window?", responseMode: "text" },
    });
    await owner.mutation(createArtifact, {
      taskId: draft.taskId,
      expectedTaskRevision: draft.revision,
      idempotencyKey: "artifact-create-auth",
      artifact: { type: "auth_required", providerId: "callbridge_demo", providerName: "Demo", reason: "Authorize safely.", continuation: "open_secure_browser" },
    });
    const restored = await owner.query(readArtifacts, { taskId: draft.taskId });
    expect(restored.artifacts.map((artifact: { createdSequence: number }) => artifact.createdSequence)).toEqual([1, 2]);

    const other = base.withIdentity({ subject: "artifact_other" });
    await expect(other.query(readArtifacts, { taskId: draft.taskId })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  it("is create-idempotent and rejects stale task and artifact revisions", async () => {
    const { owner, draft } = await draftFor("artifact_revisions");
    const args = {
      taskId: draft.taskId,
      expectedTaskRevision: draft.revision,
      idempotencyKey: "artifact-idempotent-create",
      artifact: { type: "conversation", channel: "sms", title: "Provider thread", participants: [{ id: "agent", displayName: "Concierge", role: "agent" }] },
    };
    const first = await owner.mutation(createArtifact, args);
    const repeated = await owner.mutation(createArtifact, args);
    expect(repeated.artifactId).toBe(first.artifactId);
    await expect(owner.mutation(createArtifact, { ...args, expectedTaskRevision: 999, idempotencyKey: "artifact-stale-task" })).rejects.toMatchObject({ data: { code: "STALE_REVISION" } });
    await expect(owner.mutation(updateArtifact, {
      taskId: draft.taskId,
      artifactId: first.artifactId,
      expectedArtifactRevision: 999,
      idempotencyKey: "artifact-stale-update",
      patch: { type: "conversation", title: "Changed" },
    })).rejects.toMatchObject({ data: { code: "STALE_REVISION" } });

    const updated = await owner.mutation(updateArtifact, {
      taskId: draft.taskId,
      artifactId: first.artifactId,
      expectedArtifactRevision: first.revision,
      idempotencyKey: "artifact-update-idempotent",
      patch: { type: "conversation", title: "Updated provider thread" },
    });
    await expect(owner.mutation(updateArtifact, {
      taskId: draft.taskId,
      artifactId: first.artifactId,
      expectedArtifactRevision: first.revision,
      idempotencyKey: "artifact-update-idempotent",
      patch: { type: "conversation", title: "Updated provider thread" },
    })).resolves.toMatchObject({ artifactId: first.artifactId, revision: updated.revision });
    const second = await owner.mutation(createArtifact, {
      ...args,
      idempotencyKey: "artifact-second-conversation",
      artifact: { ...args.artifact, title: "Second provider thread" },
    });
    await expect(owner.mutation(updateArtifact, {
      taskId: draft.taskId,
      artifactId: second.artifactId,
      expectedArtifactRevision: second.revision,
      idempotencyKey: "artifact-update-idempotent",
      patch: { type: "conversation", title: "Cross-artifact reuse" },
    })).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("keeps provider authorship, user response, auth resolution, and evidence outside WebMCP writes", async () => {
    const { owner, draft } = await draftFor("artifact_boundaries");
    const forbiddenCreates = [
      { type: "evidence", kind: "screenshot", assetRef: "https://evil.example", caption: "fake", capturedAt: new Date().toISOString(), provenance: "provider_receipt", redactionState: "not_required" },
      { type: "user_question", prompt: "Question", responseMode: "text", response: { value: "Impersonated", submittedAt: new Date().toISOString() } },
    ];
    for (const [index, artifact] of forbiddenCreates.entries()) {
      await expect(owner.mutation(createArtifact, {
        taskId: draft.taskId,
        expectedTaskRevision: draft.revision,
        idempotencyKey: `artifact-forbidden-${index}`,
        artifact,
      })).rejects.toMatchObject({ data: { code: "VALIDATION_FAILED" } });
    }
    const auth = await owner.mutation(createArtifact, {
      taskId: draft.taskId,
      expectedTaskRevision: draft.revision,
      idempotencyKey: "artifact-auth-boundary",
      artifact: { type: "auth_required", providerId: "callbridge_demo", providerName: "Demo", reason: "Authorize safely.", continuation: "open_secure_browser" },
    });
    await expect(owner.mutation(updateArtifact, {
      taskId: draft.taskId,
      artifactId: auth.artifactId,
      expectedArtifactRevision: auth.revision,
      idempotencyKey: "artifact-auth-impersonation",
      patch: { type: "auth_required", state: "authorized" },
    })).rejects.toMatchObject({ data: { code: "VALIDATION_FAILED" } });
  });

  it("lets only the page submit an answer at the exact revision", async () => {
    const { owner, draft } = await draftFor("artifact_page_response");
    const question = await owner.mutation(createArtifact, {
      taskId: draft.taskId,
      expectedTaskRevision: draft.revision,
      idempotencyKey: "artifact-choice-question",
      artifact: {
        type: "user_question",
        prompt: "Which arrival window?",
        responseMode: "single_choice",
        options: [{ id: "late", label: "After midnight" }],
      },
    });
    const answered = await owner.mutation(submitResponse, {
      taskId: draft.taskId,
      artifactId: question.artifactId,
      expectedArtifactRevision: question.revision,
      idempotencyKey: "artifact-page-answer",
      value: ["late"],
    });
    expect(answered).toMatchObject({ status: "resolved", revision: 2, payload: { response: { value: ["late"] } } });
    await expect(owner.mutation(submitResponse, {
      taskId: draft.taskId,
      artifactId: question.artifactId,
      expectedArtifactRevision: question.revision,
      idempotencyKey: "artifact-page-answer-stale",
      value: ["late"],
    })).rejects.toMatchObject({ data: { code: "STALE_REVISION" } });
  });

  it("proves the labeled auth, trusted provider message, question, and evidence fixture", async () => {
    const { owner, draft } = await draftFor("artifact_fixture");
    const auth = await owner.mutation(beginFixture, {
      taskId: draft.taskId,
      expectedTaskRevision: draft.revision,
      idempotencyKey: "artifact-fixture-begin",
    });
    expect(auth).toMatchObject({ type: "auth_required", source: "callbridge_server", payload: { simulated: true, state: "required" } });
    await owner.mutation(completeFixtureAuth, {
      taskId: draft.taskId,
      artifactId: auth.artifactId,
      expectedArtifactRevision: auth.revision,
      idempotencyKey: "artifact-fixture-authorize",
    });
    await owner.mutation(attachFixtureEvidence, {
      taskId: draft.taskId,
      idempotencyKey: "artifact-fixture-evidence",
    });
    const restored = await owner.query(readArtifacts, { taskId: draft.taskId });
    expect(restored.artifacts.map((artifact: { type: string }) => artifact.type)).toEqual([
      "auth_required",
      "conversation",
      "user_question",
      "evidence",
    ]);
    const conversation = restored.artifacts.find((artifact: { type: string }) => artifact.type === "conversation");
    expect(conversation).toMatchObject({
      source: "callbridge_server",
      payload: {
        simulated: true,
        latestMessages: [{ authorRole: "provider", state: "observed" }],
      },
    });
  });
});
