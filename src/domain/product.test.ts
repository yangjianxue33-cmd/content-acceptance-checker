import { describe, expect, it } from "vitest";

import { PRODUCT_NAME } from "./product";

describe("PRODUCT_NAME", () => {
  it("is the stable user-facing product name", () => {
    expect(PRODUCT_NAME).toBe("Content Acceptance Checker");
  });
});
