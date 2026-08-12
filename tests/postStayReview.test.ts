import { describe, expect, it } from "vitest";
import { validatePostStayReview } from "../src/domain/postStayReview.js";
describe("post-stay review", () => {
  it("accepts a lightweight rating", () => expect(validatePostStayReview({ rating: 4 })).toEqual({ rating: 4 }));
  it("rejects empty and out-of-range reviews", () => {
    expect(() => validatePostStayReview({})).toThrow("rating or a note");
    expect(() => validatePostStayReview({ rating: 6 })).toThrow("1 to 5");
  });
});
