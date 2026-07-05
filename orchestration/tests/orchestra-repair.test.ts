import { describe, it, expect } from "vitest";
import { orderStreams, proposalHeader, applyToken, ORCHESTRA_SLOT } from "../bin/lib/orchestra-repair";

describe("orderStreams — task-named streams first", () => {
  const streams = ["typescript-core", "shell-harden", "test-coverage"];
  it("puts a stream the task names at the front", () => {
    expect(orderStreams("please harden the shell-harden path", streams)[0]).toBe("shell-harden");
  });
  it("stable order when the task names nothing", () => {
    expect(orderStreams("random unrelated task", streams)).toEqual(streams);
  });
  it("tolerates null/empty task", () => {
    expect(orderStreams(null, streams)).toEqual(streams);
    expect(orderStreams("", streams)).toEqual(streams);
  });
});

describe("proposal formatting — fleet-apply contract", () => {
  it("header matches `# <stream> · <slot> · <model>` (fleet-apply modelOf parses it)", () => {
    expect(proposalHeader("shell-harden", "qwen3-coder:30b")).toBe("# shell-harden · orchestra · qwen3-coder:30b");
  });
  it("applyToken is `<stream>.orchestra` (fleet-apply --apply arg)", () => {
    expect(applyToken("shell-harden")).toBe("shell-harden.orchestra");
    expect(ORCHESTRA_SLOT).toBe("orchestra");
  });
});
