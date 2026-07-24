// references — the PERMANENT, canonical list of the sources this help site is built against.
//
// WHY THIS EXISTS
// The operator asked to "list the reference sources permanently". A help site that claims to
// be built "like the reference pages" must name those pages and say WHAT was taken from each —
// the information architecture (IA), not the prose. This module is that list, as data, so it
// renders identically into the committed `REFERENCES.md`, the site's Kaynaklar page, and the
// canonical prompt. Structure is borrowed; text is never copied (copyright + staleness).
//
// The list is closed and small (the five sources the operator named) and each entry records
// the concrete IA patterns observed on that site. `TARGET_SPEC` is the union of those patterns
// distilled into the feature contract the coded website must meet — every feature points back
// at the reference that justifies it, so nothing here is invented.

export type Archetype = "docs" | "marketing" | "kb";

export interface Reference {
  url: string;
  title: string;
  /** docs = sidebar/TOC/search reference; marketing = hero/landing shell; kb = search-first cards. */
  archetype: Archetype;
  /** Why it is a reference — what role it plays for our build. */
  role: string;
  /** Concrete IA patterns observed on this site (≥1). Structure taken; text never. */
  iaPatterns: string[];
  /** Top-level nav sections actually observed on the site. */
  observedSections: string[];
}

/** The five sources the operator named, in the order given. Closed list. */
export const REFERENCES: Reference[] = [
  {
    url: "https://obsidian.md/help/",
    title: "Obsidian Help",
    archetype: "docs",
    role: "Görsel + yapısal ana referans — bir Obsidian Publish vault'u; hedeflenen bilgi mimarisi (hub → bölüm → sayfa → graph) birebir budur.",
    iaPatterns: [
      "sol kenar-çubuğu: klasör/dosya navigasyon ağacı",
      "sağ pane: sayfanın başlık taslağı (on-this-page TOC)",
      "kenar-çubuğu üstünde arama kutusu",
      "graph görünümü + dark/light tema anahtarı",
      "başlangıç→ileri sıralama (kur → çekirdek → eklenti → geliştirici)",
    ],
    observedSections: ["Get started", "Extend Obsidian", "Add-on services", "Contribute"],
  },
  {
    url: "https://code.claude.com/docs/en/quickstart",
    title: "Claude Code Docs — Quickstart",
    archetype: "docs",
    role: "En güçlü docs-site şablonu — kenar-çubuğu+TOC+arama+numaralı quickstart; sayfa tipleri (tablo, callout, sekmeli kod) buradan alınır.",
    iaPatterns: [
      "kalıcı sol kenar-çubuğu: bölüm grupları",
      "sağ 'On this page' TOC",
      "arama + /docs/llms.txt makine indeksi",
      "numaralı Step 1…N quickstart akışı",
      "kopya-butonlu, dile-göre-renkli kod blokları",
      "callout bileşenleri: Note / Tip / Info",
      "Komut / Ne yapar / Örnek tablosu",
      "sayfa altı 'What's next' kart-ızgarası (prev/next)",
    ],
    observedSections: ["Getting Started", "Guides", "Reference", "Troubleshooting"],
  },
  {
    url: "https://support.claude.com/en/",
    title: "Claude Support Center",
    archetype: "kb",
    role: "Arama-öncelikli bilgi tabanı — açılış kart-ızgarası deseni (koleksiyon → makale) buradan alınır.",
    iaPatterns: [
      "üst çubukta ortalanmış büyük arama",
      "ikon + makale-sayılı koleksiyon kart-ızgarası",
      "koleksiyon → makale navigasyon modeli",
      "sıralı okuma değil, arama-öncelikli erişim",
    ],
    observedSections: ["Claude Code", "Claude API", "Pro and Max plans", "Privacy and legal"],
  },
  {
    url: "https://claude.com/product/claude-code",
    title: "Claude Code — Ürün Sayfası",
    archetype: "marketing",
    role: "Pazarlama/açılış kabuğu — hero + dikey anlatı + FAQ + footer; docs'un üstünde duran karşılama katmanı.",
    iaPatterns: [
      "hero başlık + CTA",
      "dikey anlatı bölümleri (özellik → kanıt → fiyat)",
      "tek gösterim amaçlı renkli kod parçacığı",
      "sayfa sonunda FAQ",
      "çok-sütunlu footer",
    ],
    observedSections: ["Hero", "Integrations", "Pricing", "FAQ", "Resources"],
  },
  {
    url: "https://www.anthropic.com/",
    title: "Anthropic",
    archetype: "marketing",
    role: "Üst-huni pazarlama kabuğu — sticky üst-nav + hero + büyük gruplu footer; docs/support bunun altına asılır.",
    iaPatterns: [
      "sticky üst navigasyon + 'skip to content' çapası",
      "hero + sürüm/girişim kartları",
      "8-gruplu büyük footer (~80 link)",
      "responsive (mobil/masaüstü nav ikizi)",
    ],
    observedSections: ["Research", "Products", "Company", "Help & Security"],
  },
];

export interface SpecFeature {
  /** Feature the coded site must implement. */
  feature: string;
  /** Reference URLs that justify this feature (traceability — no invented requirements). */
  from: string[];
}

/**
 * The consolidated feature contract distilled from the references above. Every feature cites
 * the reference(s) that justify it. This is the checklist the coded website is measured
 * against and the spec the canonical prompt binds to.
 */
export const TARGET_SPEC: SpecFeature[] = [
  { feature: "Kalıcı sol kenar-çubuğu navigasyonu (aktif sayfa vurgulu)", from: ["https://obsidian.md/help/", "https://code.claude.com/docs/en/quickstart"] },
  { feature: "Sağ 'bu sayfada' TOC (H2/H3'ten, scroll-spy)", from: ["https://obsidian.md/help/", "https://code.claude.com/docs/en/quickstart"] },
  { feature: "İstemci-taraflı arama ('/' ile odak, sunucusuz)", from: ["https://code.claude.com/docs/en/quickstart", "https://support.claude.com/en/"] },
  { feature: "Başlangıç→ileri IA (Başlangıç→Rehber→Referans→Sorun-Giderme)", from: ["https://obsidian.md/help/", "https://code.claude.com/docs/en/quickstart"] },
  { feature: "Dark/light tema anahtarı (localStorage + prefers-color-scheme)", from: ["https://obsidian.md/help/", "https://www.anthropic.com/"] },
  { feature: "Kopya-butonlu / sekmeli kod blokları", from: ["https://code.claude.com/docs/en/quickstart"] },
  { feature: "Callout kutuları (Not / İpucu / Uyarı)", from: ["https://code.claude.com/docs/en/quickstart"] },
  { feature: "Başlık çapa-linkleri + açılış hero'su", from: ["https://code.claude.com/docs/en/quickstart", "https://claude.com/product/claude-code"] },
  { feature: "Prev/next (veya 'What's next' kart-ızgarası)", from: ["https://code.claude.com/docs/en/quickstart"] },
  { feature: "Responsive düzen (kenar-çubuğu mobilde çekmece)", from: ["https://www.anthropic.com/", "https://claude.com/product/claude-code"] },
  { feature: "Açılış kart-ızgarası + çok-sütunlu footer", from: ["https://support.claude.com/en/", "https://www.anthropic.com/"] },
  { feature: "llms.txt tarzı makine indeksi (tüm sayfaları listeler)", from: ["https://code.claude.com/docs/en/quickstart"] },
];

const ARCHETYPE_TR: Record<Archetype, string> = { docs: "docs", marketing: "pazarlama", kb: "bilgi-tabanı" };

function escapeHtml(s: string): string {
  // Sequential replaces (no callback) so the function is fully exercised even when the input
  // carries none of the special characters — keeps coverage honest without contrived fixtures.
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The permanent, committed `REFERENCES.md`. Human-readable: the five sources as a table, the
 * IA each teaches, and the distilled feature contract. Deterministic (no clock/random).
 */
export function renderReferencesMd(): string {
  const L: string[] = [
    "# Kaynaklar — Help sitesinin referans aldığı sayfalar",
    "",
    "> Bu liste **kalıcıdır**. Site bu sayfaların *bilgi mimarisi* (IA) üzerine kurulur; **metni asla kopyalanmaz** (telif + bayatlama). Her özellik, onu gerektiren kaynağa geri işaret eder.",
    "",
    "## Referanslar",
    "",
    "| # | Kaynak | Arketip | Rol |",
    "|---|--------|---------|-----|",
  ];
  REFERENCES.forEach((r, i) => {
    L.push(`| ${i + 1} | [${r.title}](${r.url}) | ${ARCHETYPE_TR[r.archetype]} | ${r.role} |`);
  });
  L.push("", "## Her kaynaktan öğrenilen bilgi mimarisi", "");
  for (const r of REFERENCES) {
    L.push(`### ${r.title}`, `<${r.url}> · **arketip:** ${ARCHETYPE_TR[r.archetype]}`, "");
    L.push(`- **Gözlenen bölümler:** ${r.observedSections.join(" · ")}`);
    for (const p of r.iaPatterns) L.push(`- ${p}`);
    L.push("");
  }
  L.push("## Hedef özellik sözleşmesi (kodlanmış site bunu karşılamalı)", "");
  L.push("| # | Özellik | Kaynak |", "|---|---------|--------|");
  TARGET_SPEC.forEach((f, i) => {
    L.push(`| ${i + 1} | ${f.feature} | ${f.from.map((u) => `<${u}>`).join(" ")} |`);
  });
  L.push("");
  return L.join("\n");
}

/** The same content as an HTML fragment for the site's Kaynaklar page (chrome added by htmlsite). */
export function renderReferencesHtml(): string {
  const rows = REFERENCES.map(
    (r, i) =>
      `<tr><td>${i + 1}</td><td><a href="${escapeHtml(r.url)}" rel="noopener" target="_blank">${escapeHtml(r.title)}</a></td>` +
      `<td>${ARCHETYPE_TR[r.archetype]}</td><td>${escapeHtml(r.role)}</td></tr>`,
  ).join("");
  const cards = REFERENCES.map(
    (r) =>
      `<section class="ref-card"><h3>${escapeHtml(r.title)}</h3>` +
      `<p class="ref-meta"><a href="${escapeHtml(r.url)}" rel="noopener" target="_blank">${escapeHtml(r.url)}</a> · <em>${ARCHETYPE_TR[r.archetype]}</em></p>` +
      `<p><strong>Bölümler:</strong> ${escapeHtml(r.observedSections.join(" · "))}</p>` +
      `<ul>${r.iaPatterns.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul></section>`,
  ).join("");
  const spec = TARGET_SPEC.map(
    (f, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(f.feature)}</td><td>${f.from.map((u) => `<a href="${escapeHtml(u)}" rel="noopener" target="_blank">kaynak</a>`).join(" ")}</td></tr>`,
  ).join("");
  return (
    `<p class="lead">Bu site aşağıdaki sayfaların <strong>bilgi mimarisi</strong> üzerine kuruludur; metinleri kopyalanmaz.</p>` +
    `<table class="ref-table"><thead><tr><th>#</th><th>Kaynak</th><th>Arketip</th><th>Rol</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<h2 id="ia">Her kaynaktan öğrenilen mimari</h2>${cards}` +
    `<h2 id="spec">Hedef özellik sözleşmesi</h2>` +
    `<table class="ref-table"><thead><tr><th>#</th><th>Özellik</th><th>Kaynak</th></tr></thead><tbody>${spec}</tbody></table>`
  );
}
