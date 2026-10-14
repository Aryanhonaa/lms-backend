import { describe, expect, it } from "vitest";
import { assertUploadFile, maxBytesForPurpose } from "../src/storage/file-types";

describe("call recording upload validation", () => {
  it.each([
    ["team-call.mp3", "audio/mpeg"],
    ["team-call.wav", "audio/wav"],
    ["team-call.m4a", "audio/mp4"],
    ["team-call.ogg", "audio/ogg"],
  ])("accepts %s", (fileName, mimeType) => {
    expect(
      assertUploadFile({
        fileName,
        mimeType,
        size: 1024,
        purpose: "CALL_RECORDING",
      }),
    ).toBeNull();
  });

  it("rejects non-audio formats and uses the media upload size limit", () => {
    expect(
      assertUploadFile({
        fileName: "not-a-recording.mp4",
        mimeType: "video/mp4",
        size: 1024,
        purpose: "CALL_RECORDING",
      }),
    ).toContain("mp3, wav, m4a, ogg");
    expect(maxBytesForPurpose("CALL_RECORDING")).toBe(maxBytesForPurpose("VIDEO"));
  });
});
