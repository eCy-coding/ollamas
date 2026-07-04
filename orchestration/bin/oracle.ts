#!/usr/bin/env tsx
/**
 * orchestration/bin/oracle.ts — Doğruluk Oracle'ı CLI.
 *
 * Bir önermeyi/kodu deterministik olarak TRUE / FALSE / UNDECIDABLE'a bağlar; KANIT yazdırır.
 * LLM kullanmaz — yer-gerçeğini hesaplar/çalıştırır. Bkz. orchestration/oracle/index.ts.
 *
 * Kullanım:
 *   tsx orchestration/bin/oracle.ts "2+2=4"
 *   tsx orchestration/bin/oracle.ts "2'den sonra 3 gelir"
 *   tsx orchestration/bin/oracle.ts "A and not A is always false"
 *   tsx orchestration/bin/oracle.ts --json "2+2=5"
 *   echo '{"kind":"code-functional","lang":"python","entry":"factorial","code":"def factorial(n):\n result=1\n for i in range(1,n):\n  result*=i\n return result","cases":[{"args":[5],"expect":120}]}' | tsx orchestration/bin/oracle.ts --request
 */
import { readFileSync } from "node:fs";
import { verify, type OracleInput } from "../oracle/index";
import { render, verdictExitCode } from "./lib/oracle-lib";

const argv = process.argv.slice(2);
const jsonOut = argv.includes("--json");
const isRequest = argv.includes("--request");
const positional = argv.filter((a) => !a.startsWith("--"));

function readStdin(): string {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

let input: OracleInput;
if (isRequest) {
  const raw = positional.length ? positional.join(" ") : readStdin();
  input = JSON.parse(raw) as OracleInput;
} else if (positional.length) {
  input = positional.join(" ");
} else {
  const raw = readStdin().trim();
  if (!raw) {
    console.error('Kullanım: tsx orchestration/bin/oracle.ts "<önerme>"   |   --request < req.json');
    process.exit(2);
  }
  input = raw.startsWith("{") ? (JSON.parse(raw) as OracleInput) : raw;
}

const result = verify(input);
if (jsonOut) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(render(result));
}
// exit-code: DOĞRU=0, YANLIŞ=1, KARARSIZ=3 (conduct-gate uyumlu)
process.exit(verdictExitCode(result.verdict));
