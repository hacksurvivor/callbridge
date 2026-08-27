import { describe, expect, it } from "vitest";

import * as convexContract from "../convex/hotelDemoContracts.js";
import {
  HOTEL_DEMO_QUESTION_IDS,
  HOTEL_DEMO_SCHEMA_VERSION,
  HOTEL_DEMO_TOOL_NAMES,
  WEBMCP_ERROR_CODES,
  hotelDemoToolInputSchemas,
  toWebMcpError,
  validateHotelDemoQuestionIds,
} from "../shared/hotelDemoContracts.js";
import * as workerContract from "../telephony-worker/src/hotelDemoContracts.js";

describe("hotel demo shared contract", () => {
  it("exports the same schema and literals at the Convex and worker boundaries", () => {
    expect(convexContract.HOTEL_DEMO_SCHEMA_VERSION).toBe(HOTEL_DEMO_SCHEMA_VERSION);
    expect(workerContract.HOTEL_DEMO_SCHEMA_VERSION).toBe(HOTEL_DEMO_SCHEMA_VERSION);
    expect(convexContract.HOTEL_DEMO_QUESTION_IDS).toEqual(HOTEL_DEMO_QUESTION_IDS);
    expect(workerContract.HOTEL_DEMO_TOOL_NAMES).toEqual(HOTEL_DEMO_TOOL_NAMES);
  });

  it("defines exactly the five approved tool input schemas", () => {
    expect(Object.keys(hotelDemoToolInputSchemas)).toEqual(HOTEL_DEMO_TOOL_NAMES);
    for (const schema of Object.values(hotelDemoToolInputSchemas)) {
      expect(schema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    }
  });

  it("accepts one to four ordered, distinct allowlisted questions", () => {
    expect(validateHotelDemoQuestionIds([HOTEL_DEMO_QUESTION_IDS[0]])).toEqual({
      ok: true,
      value: [HOTEL_DEMO_QUESTION_IDS[0]],
    });
    expect(validateHotelDemoQuestionIds([...HOTEL_DEMO_QUESTION_IDS])).toEqual({
      ok: true,
      value: [...HOTEL_DEMO_QUESTION_IDS],
    });
  });

  it.each([
    [],
    [...HOTEL_DEMO_QUESTION_IDS, HOTEL_DEMO_QUESTION_IDS[0]],
    [HOTEL_DEMO_QUESTION_IDS[0], HOTEL_DEMO_QUESTION_IDS[0]],
    ["book-a-room"],
    "after-midnight-allowed",
  ])("rejects invalid question selections: %j", (value) => {
    expect(validateHotelDemoQuestionIds(value)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it.each([
    ["UNAUTHENTICATED", "AUTH_REQUIRED"],
    ["FORBIDDEN", "FORBIDDEN"],
    ["NOT_FOUND", "NOT_FOUND"],
    ["VALIDATION_FAILED", "INVALID_INPUT"],
    ["STALE_REVISION", "REVISION_CONFLICT"],
    ["INVALID_TRANSITION", "INVALID_STATE"],
    ["CALL_WINDOW_CLOSED", "DEMO_POLICY_DENIED"],
    ["ENTITLEMENT_REQUIRED", "DEMO_POLICY_DENIED"],
    ["UNSUPPORTED_ENVIRONMENT", "UNSUPPORTED_ENVIRONMENT"],
  ])("maps internal %s to stable %s", (internal, expected) => {
    expect(toWebMcpError({ code: internal })).toMatchObject({ code: expected });
  });

  it("reads Convex-style nested error codes", () => {
    expect(toWebMcpError({ data: { code: "STALE_REVISION", secret: "do not leak" } })).toEqual({
      code: "REVISION_CONFLICT",
      message: "The call draft changed. Reload it before trying again.",
      retryable: true,
    });
  });

  it("turns unknown failures into a non-leaking internal error", () => {
    const result = toWebMcpError(new Error("Twilio credential abc123 failed"));
    expect(result).toEqual({
      code: "INTERNAL_ERROR",
      message: "CallBridge could not complete the request.",
      retryable: true,
    });
    expect(result.message).not.toContain("Twilio");
    expect(WEBMCP_ERROR_CODES).toContain(result.code);
  });
});
