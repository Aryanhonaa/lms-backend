import { describe, expect, it } from "vitest";
import { isAllowedCorsOrigin } from "../src/utils/cors-origin";

describe("LAN CORS origins", () => {
  const configured = "http://localhost:3000";

  it("allows localhost and private LAN frontend origins", () => {
    expect(isAllowedCorsOrigin(undefined, configured)).toBe(true);
    expect(isAllowedCorsOrigin("http://localhost:3000", configured)).toBe(true);
    expect(isAllowedCorsOrigin("http://192.168.1.24:3000", configured)).toBe(true);
    expect(isAllowedCorsOrigin("http://10.0.0.8:3000", configured)).toBe(true);
  });

  it("rejects unrelated public origins", () => {
    expect(isAllowedCorsOrigin("https://evil.example", configured)).toBe(false);
    expect(isAllowedCorsOrigin("http://192.168.1.24:5000", configured)).toBe(false);
  });
});
