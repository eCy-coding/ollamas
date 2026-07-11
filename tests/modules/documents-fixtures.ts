// Minimal, dependency-free binary fixtures for tests/modules/documents.test.ts
// (FAZ1 K4: "small real PDF/DOCX fixtures", not mocked bytes). No external
// generator libs — a plain ZIP writer (STORE method, node:zlib.crc32) builds a
// valid-enough DOCX/XLSX, and a hand-rolled recovery-parseable PDF (pdf.js
// tolerates a missing/broken xref table via its object-scan fallback — verified
// live against `unpdf.extractText`).
import zlib from "node:zlib";

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

/** A minimal ZIP container (STORE/no-compression) — enough for mammoth/xlsx to
 *  open as a valid OOXML package. */
function buildZipStore(entries: { name: string; data: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf-8");
    const crc = zlib.crc32(data) >>> 0;
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(0), // flags
      u16(0), // method = store
      u16(0), // mod time
      u16(0), // mod date
      u32(crc),
      u32(data.length), // compressed size == data length (store)
      u32(data.length), // uncompressed size
      u16(nameBuf.length),
      u16(0), // extra field length
      nameBuf,
      data,
    ]);
    localParts.push(local);

    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20), // version made by
      u16(20), // version needed
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuf,
    ]);
    centralParts.push(central);
    offset += local.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const centralStart = offset;
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(centralStart),
    u16(0),
  ]);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

/** Minimal valid OOXML .docx containing one paragraph of text. */
export function buildMinimalDocx(text = "Hello DOCX fixture"): Buffer {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`;

  return buildZipStore([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf-8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf-8") },
    { name: "word/document.xml", data: Buffer.from(document, "utf-8") },
  ]);
}

/** A recovery-parseable minimal PDF (no accurate xref offsets — pdf.js's
 *  object-scan fallback still resolves it; verified against unpdf.extractText).
 *  MediaBox is deliberately wide (2000pt) — pdf.js's text-layer extraction
 *  clips glyphs that fall outside the page box, so a narrow box silently
 *  truncated longer fixture strings (found live while writing this fixture). */
export function buildMinimalPdf(text = "Hello PDF fixture"): Buffer {
  const stream = `BT /F1 24 Tf 10 100 Td (${text}) Tj ET`;
  const pdf = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 2000 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${stream.length}>>stream
${stream}
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Size 6/Root 1 0 R>>
%%EOF`;
  return Buffer.from(pdf, "latin1");
}

/** A corrupt PDF (magic header only) — must be caught as a ProcessingError. */
export function buildCorruptPdf(): Buffer {
  return Buffer.from("%PDF-1.1\nnot a real pdf body at all, just garbage bytes", "latin1");
}
