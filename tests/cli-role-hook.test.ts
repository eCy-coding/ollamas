import { describe, it, expect } from "vitest";
import { isRoleQuestion } from "../cli/bin/role-hook";

describe("isRoleQuestion (UserPromptSubmit matcher)", () => {
  it("matches the canonical identity questions", () => {
    for (const q of [
      "Bu terminal sekmesinde görevin nedir? Ne yaparsın?",
      "görevin ne",
      "ne yaparsın",
      "ne yaparsin", // dotless ı variant
      "rolün nedir",
      "bu sekmede görevin nedir",
    ]) {
      expect(isRoleQuestion(q)).toBe(true);
    }
  });

  it("rejects unrelated prompts (silent exit 0 path)", () => {
    for (const q of [
      "merhaba",
      "sıradaki versiyonu planla",
      "fix the keychain bug",
      "",
      "config keystore keychain",
    ]) {
      expect(isRoleQuestion(q)).toBe(false);
    }
  });
});
