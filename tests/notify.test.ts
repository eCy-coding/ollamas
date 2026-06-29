import { describe, it, expect } from "vitest";
import { slackPayload, discordPayload, notify } from "../server/notify";

describe("notify (Slack/Discord alerts)", () => {
  it("slackPayload wraps text as {text}", () => {
    expect(slackPayload("hello")).toEqual({ text: "hello" });
  });

  it("discordPayload wraps text as {content}", () => {
    expect(discordPayload("hello")).toEqual({ content: "hello" });
  });

  it("notify is a no-op (returns []) when no config", async () => {
    expect(await notify("x", undefined)).toEqual([]);
  });

  it("notify is a no-op (returns []) when config has no URLs", async () => {
    expect(await notify("x", {})).toEqual([]);
  });

  it("notify never throws on an unreachable URL (returns [])", async () => {
    // RFC 5737 TEST-NET address — guaranteed unroutable → fetch fails fast, must not throw.
    const sent = await notify("x", { slackWebhookUrl: "http://192.0.2.1:1/hook" });
    expect(sent).toEqual([]);
  });
});
