// Node SEA (Single Executable Application) build helpers — PURE (v12).
//
// The blob generation + injection runs in cli/build-sea.sh; these are the testable
// config/argv builders (mirrors lib/keychain.ts buildSecurityArgs — structure
// assertable without executing the build). Adopted from the official Node.js SEA
// flow + nodejs/postject (MIT). Node SEA produces a canonical single binary from the
// SAME Node runtime the CLI targets — no third-party compiler (Bun stays as an
// alternate). postject is a BUILD-TIME devDep only; the runtime stays zero-dep.

// The official Node sentinel fuse postject flips to mark the blob as present.
export const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

export interface SeaConfig {
  main: string;
  output: string;
  disableExperimentalSEAWarning: boolean;
}

// `node --experimental-sea-config <this>` reads { main, output } and writes the blob.
export function seaConfigObject(main: string, output: string): SeaConfig {
  return { main, output, disableExperimentalSEAWarning: true };
}

// postject <binary> NODE_SEA_BLOB <blob> --sentinel-fuse <fuse> [--macho-segment-name <seg>]
// machoSegment is required on macOS (the blob lives in a Mach-O segment) and omitted
// elsewhere. Pure → unit-testable; the .sh passes process.platform-derived segment.
export function postjectArgs(binPath: string, blobPath: string, machoSegment?: string): string[] {
  const args = [binPath, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", SEA_FUSE];
  if (machoSegment) args.push("--macho-segment-name", machoSegment);
  return args;
}

// Output binary name — identical scheme to cli/build-binary.sh (Bun) so both paths
// and the release matrix produce matching artifact names.
export function seaOutName(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  const os = platform === "darwin" ? "darwin" : platform === "win32" ? "win" : "linux";
  const a = arch === "arm64" || arch === "aarch64" ? "arm64" : arch === "x64" ? "x64" : arch;
  return `ollamas-${os}-${a}`;
}
