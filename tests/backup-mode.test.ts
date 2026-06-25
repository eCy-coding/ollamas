import { describe, it, expect } from "vitest";
import { resolveBackupMode } from "../server/backup";

// H9: uploadBackup fell through to a mock "success" when a remote target (s3/webdav)
// was selected but misconfigured — the user was told the backup uploaded when nothing
// did. resolveBackupMode throws on a misconfigured remote target instead.
describe("resolveBackupMode (H9 — no fake success on misconfig)", () => {
  it("throws when s3 is selected without endpoint/bucket", () => {
    expect(() => resolveBackupMode({ type: "s3" })).toThrow(/S3 backup misconfigured/);
    expect(() => resolveBackupMode({ type: "s3", endpoint: "https://x" })).toThrow(/bucket/);
    expect(() => resolveBackupMode({ type: "s3", bucket: "b" })).toThrow(/endpoint/);
  });
  it("throws when webdav is selected without endpoint", () => {
    expect(() => resolveBackupMode({ type: "webdav" })).toThrow(/WebDAV backup misconfigured/);
  });
  it("returns the remote mode when fully configured", () => {
    expect(resolveBackupMode({ type: "s3", endpoint: "https://x", bucket: "b" })).toBe("s3");
    expect(resolveBackupMode({ type: "webdav", endpoint: "https://dav" })).toBe("webdav");
  });
  it("maps a non-remote / unset config to the dry-run simulator", () => {
    expect(resolveBackupMode({ type: "local" })).toBe("dryrun");
    expect(resolveBackupMode({})).toBe("dryrun");
  });
});
