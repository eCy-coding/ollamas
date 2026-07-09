#!/usr/bin/env node
// @ts-check
// measure-extract — gerçek bir makalede ESKİ vs YENİ extractReadable: boilerplate azalması + çekirdek korunumu.
import { JSDOM, VirtualConsole } from "jsdom";
import { extractReadable as extractNew } from "../bin/host-bridge/tools/lib/web-extract.mjs";

const SILENT = new VirtualConsole();
const dom = (html) => new JSDOM(html || "", { virtualConsole: SILENT }).window.document;

// ESKİ extractReadable (iyileştirmeden önceki sürüm) — kıyas için inline.
function extractOld(html, url = "", maxText = 6000) {
  const doc = dom(html);
  doc.querySelectorAll("script, style, noscript, nav, footer, header, svg, iframe, form").forEach((e) => e.remove());
  const title = (doc.querySelector("title")?.textContent || doc.querySelector("h1")?.textContent || "").trim();
  const main = doc.querySelector("main") || doc.querySelector("article") || doc.body || doc.documentElement;
  const text = (main?.textContent || "").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxText);
  return { title, text };
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const URL = process.argv[2] || "https://en.wikipedia.org/wiki/Web_scraping";
const CORE = process.argv[3] || "data scraping used for extracting data from websites";

const res = await fetch(URL, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
const html = await res.text();
const rawBodyText = (dom(html).body?.textContent || "").replace(/\s+/g, " ").trim().length;

const CAP = 5_000_000; // slice'ı devre dışı bırak → gerçek boilerplate farkı görünür
const old = extractOld(html, URL, CAP);
const neu = extractNew(html, URL, CAP);
const norm = (s) => s.replace(/\s+/g, " ");
const oldLen = old.text.length, newLen = neu.text.length;
const boil = (n) => rawBodyText > 0 ? (((rawBodyText - n) / rawBodyText) * 100).toFixed(1) : "0";
const oldCore = norm(old.text).includes(CORE), newCore = norm(neu.text).includes(CORE);

console.log("# extractReadable ESKİ vs YENİ — gerçek sayfa ölçümü");
console.log("# URL: " + URL);
console.log("# ham <body> metni: " + rawBodyText.toLocaleString("en-US") + " char");
console.log("");
console.log("ESKİ:  içerik=" + oldLen.toLocaleString("en-US") + " char   boilerplate-atılan=%" + boil(oldLen) + "   çekirdek-cümle=" + (oldCore ? "VAR" : "YOK"));
console.log("YENİ:  içerik=" + newLen.toLocaleString("en-US") + " char   boilerplate-atılan=%" + boil(newLen) + "   çekirdek-cümle=" + (newCore ? "VAR" : "YOK"));
console.log("");
const lessNoise = newLen <= oldLen;
const keepsCore = newCore;
const ok = keepsCore && (newLen < oldLen || (oldCore === false && newCore === true));
console.log("→ YENİ daha az gürültü (içerik ≤ eski): " + (lessNoise ? "EVET" : "HAYIR") + "   |   çekirdek korunur: " + (keepsCore ? "EVET" : "HAYIR"));
console.log("→ SONUÇ: " + (ok ? "İYİLEŞME DOĞRULANDI (daha az boilerplate, çekirdek içerik korundu)" : "nötr/incele"));
console.log("");
console.log(JSON.stringify({ url: URL, rawBodyChars: rawBodyText, old: { chars: oldLen, core: oldCore }, new: { chars: newLen, core: newCore }, boilerplateRemovedDeltaPct: Number(boil(newLen)) - Number(boil(oldLen)) }));
