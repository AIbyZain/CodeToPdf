/**
 * Upload validation shared by the browser and the API.
 */

// Declared locally so this file type-checks without the DOM lib; at runtime the
// global TextDecoder (browser or Node) is used.
declare const TextDecoder: new (
  label?: string,
  options?: { fatal?: boolean },
) => { decode(input: Uint8Array): string };

/** Largest single source file accepted (about 1 MB, roughly 20,000+ lines). */
export const MAX_FILE_BYTES = 1024 * 1024;
/** Largest combined upload. Keeps requests well under the API body limit. */
export const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
/** Most files accepted in one assignment. */
export const MAX_FILES = 200;

export type DecodeResult =
  | { ok: true; text: string; encoding: "utf-8" | "utf-16le" | "utf-16be" | "windows-1252" }
  | { ok: false; reason: "binary" };

/**
 * Turns raw file bytes into text without corrupting it.
 * - UTF-8 (with or without BOM) and UTF-16 (with BOM) are decoded exactly.
 * - Legacy Windows-encoded files (e.g. an old .c file containing "é") fall back
 *   to Windows-1252 instead of showing replacement characters.
 * - Files that look binary (images, archives, executables, .docx) are rejected.
 */
export function decodeSourceBytes(bytes: Uint8Array): DecodeResult {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { ok: true, text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { ok: true, text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be" };
  }

  const sample = bytes.subarray(0, 16_384);
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return { ok: false, reason: "binary" };
    // Control characters other than tab, LF, VT, FF, CR, ESC.
    if (byte < 0x08 || (byte > 0x0d && byte < 0x20 && byte !== 0x1b)) suspicious += 1;
  }
  if (sample.length > 0 && suspicious / sample.length > 0.02) return { ok: false, reason: "binary" };

  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { ok: true, text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

/** True when a file has no visible content at all. */
export function isBlankContent(content: string): boolean {
  return content.replace(/^\uFEFF/, "").trim().length === 0;
}

/**
 * Characters the built-in PDF fonts can draw (WinAnsi: Latin-1 plus curly
 * quotes, dashes, €, ™ and a few more). Anything else is printed as a
 * highlighted "?" in the PDF, so the UI warns about it beforehand.
 */
const PDF_EXTRA_CHARACTERS = new Set(
  Array.from("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ").map((ch) => ch.codePointAt(0)!),
);

export function isPdfPrintable(codePoint: number): boolean {
  return (
    codePoint === 0x09 ||
    (codePoint >= 0x20 && codePoint <= 0x7e) ||
    (codePoint >= 0xa0 && codePoint <= 0xff) ||
    PDF_EXTRA_CHARACTERS.has(codePoint)
  );
}

/** Distinct characters in `text` that the PDF cannot draw (max `limit`). */
export function findUnprintableCharacters(text: string, limit = 8): { characters: string[]; count: number } {
  const seen = new Set<string>();
  let count = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x0a || cp === 0x0d || cp === 0xfeff || isPdfPrintable(cp)) continue;
    if (cp < 0x20 || cp === 0x7f) continue; // invisible control characters are rendered as spaces
    count += 1;
    if (seen.size < limit) seen.add(ch);
  }
  return { characters: [...seen], count };
}
