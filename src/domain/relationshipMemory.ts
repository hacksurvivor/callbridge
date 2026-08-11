import { z } from "zod";

import { DomainError } from "./errors.js";
import { TASK_CATEGORIES } from "./model.js";

export const relationshipMemorySchema = z.object({
  category: z.enum(TASK_CATEGORIES),
  placeName: z.string().trim().min(1).max(300),
  placeAddress: z.string().trim().min(1).max(500).optional(),
  summary: z.string().trim().min(1).max(2_000),
  facts: z.array(z.string().trim().min(1).max(300)).max(30),
  lastRelevantDate: z.string().date().optional(),
  mayUseInCalls: z.boolean(),
  visibility: z.literal("owner_only"),
});

export type RelationshipMemoryInput = z.infer<typeof relationshipMemorySchema>;

export function validateRelationshipMemory(value: unknown): RelationshipMemoryInput {
  const result = relationshipMemorySchema.safeParse(value);
  if (!result.success) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Relationship memory is invalid",
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return result.data;
}
