// Top-20 app kartını GERÇEK usage (kılavuz + "ne yaparım") ve op examples ile
// zenginleştirir. İdempotent: app adına göre eşler, usage/examples ekler, validateCards
// ile doğrular, yazar. İçerik uydurma DEĞİL — her app'in gerçekten yaptığı işten.
// Kalan 80 kart loop self-author (app-usage-author) ile zenginleşir.
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { validateCards, type AppCard } from "../server/app-literacy";

const DATA = join(process.cwd(), "data", "app-literacy.json");

// app → { usage, opExamples: { opId: examples[] } }
const ENRICH: Record<string, { guide: string; canDo: string[]; ops?: Record<string, string[]> }> = {
  "iTerm": {
    guide: "Komut çalıştırma ve otomasyonun ana terminali; aç, yeni sekmede komut dizisi sür, panelleri böl.",
    canDo: ["yeni sekmede komut çalıştır", "bölünmüş panel ile paralel iş", "ssh/uzak oturum", "script ile tekrar eden işi otomatikleştir"],
    ops: { "iterm.open": ["terminali aç", "iTerm başlat"], "iterm.new-tab": ["yeni sekmede test çalıştır", "iTerm'de yeni sekme aç"] },
  },
  "Visual Studio Code": {
    guide: "`code` CLI ile dosya/klasör aç; entegre terminal, diff ve uzantılarla geliştir.",
    canDo: ["klasör/proje aç", "belirli dosyaya git", "iki dosyayı diff karşılaştır", "entegre terminalde komut çalıştır"],
    ops: { "vscode.open": ["projeyi VS Code'da aç", "geçerli klasörü editörde aç"], "vscode.open-path": ["server.ts dosyasını aç", "belirli bir dosyayı editörde aç"] },
  },
  "Google Chrome": {
    guide: "Varsayılan tarayıcı; URL aç, açık sekmeleri AppleScript ile listele/oku, otomasyon sür.",
    canDo: ["URL aç", "açık sekmeleri listele", "aktif sekme başlığı/URL'sini al", "otomasyon için sekme sür"],
    ops: { "chrome.open": ["chrome ile localhost:3000 aç", "tarayıcıda bir sayfa aç"], "chrome.list-tabs": ["açık chrome sekmelerini say", "tüm sekme URL'lerini al"] },
  },
  "Finder": {
    guide: "Dosya yöneticisi; bir yolu Finder'da göster, mevcut seçimi oku.",
    canDo: ["bir dosya/klasörü Finder'da göster", "geçerli seçimi oku", "yol açıklaması al"],
    ops: { "finder.reveal": ["bu dosyayı Finder'da göster", "indirilenler klasörünü aç"], "finder.selection": ["Finder'da seçili öğeleri al"] },
  },
  "Ollama": {
    guide: "Yerel AI çalışma zamanı; kurulu modelleri ve çalışan model süreçlerini listele.",
    canDo: ["kurulu modelleri listele", "çalışan model süreçlerini gör", "GPU/bellek kullanımını tahmin et"],
    ops: { "ollama.list": ["ollama modellerini listele", "hangi modeller kurulu"], "ollama.ps": ["çalışan ollama modellerini gör", "aktif inference süreçleri"] },
  },
  "DaVinci Resolve": {
    guide: "Profesyonel video düzenleme/renk; uygulamayı aç (proje otomasyonu scriptable API ister, kurulum operatörün).",
    canDo: ["montaj/renk için Resolve'u aç", "proje ortamını hazırla"],
    ops: { "resolve.open": ["video montaj programını aç", "DaVinci Resolve başlat"] },
  },
  "System Settings": {
    guide: "Sistem ayarları; belirli bölmeyi (ör. Gizlilik & Güvenlik) aç — ayar DEĞİŞTİRME operatörün.",
    canDo: ["belirli ayar bölmesini aç", "Gizlilik & Güvenlik'i göster"],
    ops: { "settings.privacy": ["Gizlilik ayarlarını aç", "TCC izin panelini göster"] },
  },
  "Docker": {
    guide: "Konteyner çalışma zamanı; çalışan konteynerleri listele (durdurma/başlatma riskli, gated).",
    canDo: ["çalışan konteynerleri listele", "konteyner durumunu gör"],
    ops: { "docker.ps": ["çalışan docker konteynerlerini listele", "hangi servisler ayakta"] },
  },
  "Safari": {
    guide: "Apple tarayıcısı; açık sekmeleri AppleScript ile oku.",
    canDo: ["açık safari sekmelerini listele", "sekme URL/başlıklarını al"],
    ops: { "safari.list-tabs": ["safari sekmelerini listele", "açık safari sayfalarını say"] },
  },
  "Claude": {
    guide: "AI masaüstü uygulaması; uygulamayı aç (sohbet otomasyonu yoktur).",
    canDo: ["Claude uygulamasını aç"],
    ops: { "claude.open": ["Claude'u aç", "Claude masaüstünü başlat"] },
  },
  "Preview": {
    guide: "Belge/görsel görüntüleyici; bir PDF/görseli Preview'da aç.",
    canDo: ["PDF/görsel aç", "belgeyi görüntüle"],
    ops: { "preview.open": ["bu PDF'i Preview'da aç", "görseli önizle"] },
  },
  "Mail": {
    guide: "E-posta; taslak OLUŞTUR (gönderme gated — operatör onayı). Kart taslağı hazırlar, göndermez.",
    canDo: ["taslak e-posta hazırla (göndermez)", "gelen kutusunu aç"],
    ops: { "mail.draft": ["yeni e-posta taslağı oluştur", "taslak hazırla (gönderme yok)"] },
  },
  "Calendar": {
    guide: "Takvim; bugünkü etkinlikleri göster (etkinlik oluşturma riskli).",
    canDo: ["bugünkü etkinlikleri göster", "takvimi aç"],
    ops: { "calendar.today": ["bugün ne var göster", "bugünkü takvimi aç"] },
  },
  "Reminders": {
    guide: "Hatırlatıcılar; uygulamayı aç (liste okuma/yazma otomasyonu ileri seviye).",
    canDo: ["hatırlatıcıları aç", "görev listesini göster"],
    ops: { "reminders.open": ["hatırlatıcıları aç", "yapılacaklar listesini göster"] },
  },
  "Notes": {
    guide: "Notlar; uygulamayı aç (not oluşturma/okuma otomasyonu ileri seviye).",
    canDo: ["notları aç", "not defterini göster"],
    ops: { "notes.open": ["notları aç", "Notes uygulamasını başlat"] },
  },
  "Shortcuts": {
    guide: "Apple Kısayolları; mevcut kısayolları listele, otomasyon köprüsü (kullanıcı kısayolu yoksa boş).",
    canDo: ["kurulu kısayolları listele", "otomasyon köprüsü keşfet"],
    ops: { "shortcuts.list": ["kısayolları listele", "hangi kısayollar var"] },
  },
  "QuickTime Player": {
    guide: "Medya oynatıcı/kayıt; bir medya dosyasını aç (ekran/ses kaydı ileri seviye).",
    canDo: ["video/ses dosyası aç", "medya oynat"],
    ops: { "quicktime.open": ["bu videoyu QuickTime'da aç", "medya dosyasını oynat"] },
  },
  "Activity Monitor": {
    guide: "Sistem izleyici; en çok CPU kullanan süreçleri göster (teşhis).",
    canDo: ["CPU'yu en çok yiyen süreçleri gör", "sistem yükünü teşhis et"],
    ops: { "activity.top-cpu": ["en çok CPU kullanan süreçleri göster", "sistemi ne yavaşlatıyor"] },
  },
  "Cursor": {
    guide: "AI kod editörü; klasör/dosya aç (`cursor` CLI), VS Code benzeri sür.",
    canDo: ["projeyi Cursor'da aç", "AI destekli düzenleme"],
    ops: { "cursor.open": ["projeyi Cursor'da aç", "Cursor editörünü başlat"] },
  },
  "CapCut": {
    guide: "Video düzenleme; uygulamayı aç (proje otomasyonu yoktur).",
    canDo: ["kısa video düzenlemek için CapCut'ı aç"],
    ops: { "capcut.open": ["CapCut'ı aç", "video editörünü başlat"] },
  },
};

const doc = JSON.parse(readFileSync(DATA, "utf8"));
const cards: AppCard[] = doc.cards;
let enriched = 0, opEx = 0;
for (const c of cards) {
  const e = ENRICH[c.app];
  if (!e) continue;
  c.usage = { guide: e.guide, canDo: e.canDo };
  enriched++;
  for (const op of c.ops) {
    const ex = e.ops?.[op.opId];
    if (ex?.length) { op.examples = ex; opEx++; }
  }
}

const v = validateCards(cards);
if (!v.ok) { console.error("VALIDATE FAIL:", JSON.stringify(v.errors.slice(0, 5))); process.exit(1); }

copyFileSync(DATA, `${DATA}.bak-enrich`);
writeFileSync(DATA, JSON.stringify(doc, null, 2) + "\n");
console.log(JSON.stringify({ enrichedCards: enriched, opsWithExamples: opEx, validate: "ok" }));
