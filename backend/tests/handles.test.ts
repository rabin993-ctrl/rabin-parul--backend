import { describe, expect, it } from "vitest";
import { normalizeHandle, validateHandle } from "../src/shared/handles.js";

describe("handle validation", () => {
  it("normalizes an ordinary handle", () => {
    expect(normalizeHandle(" @Aisha.Rahman ")).toBe("aisha.rahman");
    expect(validateHandle("@Aisha.Rahman")).toEqual({
      valid: true,
      normalized: "aisha.rahman",
    });
  });

  it("rejects reserved, email-like, and phone-like values", () => {
    expect(validateHandle("admin").reason).toBe("reserved");
    expect(validateHandle("aisha@example.com").reason).toBe("email_like");
    expect(validateHandle("+880 1712 345678").reason).toBe("phone_like");
  });

  it("requires a letter first and a bounded length", () => {
    expect(validateHandle("12cats").reason).toBe("format");
    expect(validateHandle("ab").reason).toBe("format");
    expect(validateHandle(`a${"b".repeat(30)}`).reason).toBe("format");
  });
});
