/**
 * Single source of truth for which files the app accepts and how each one is
 * labelled and highlighted. Used by the upload screen, the API validator,
 * the code preview and the PDF renderer so they can never disagree.
 */

export type LanguageId =
  | "html"
  | "css"
  | "javascript"
  | "typescript"
  | "python"
  | "java"
  | "c"
  | "cpp"
  | "csharp"
  | "go"
  | "kotlin"
  | "swift"
  | "rust"
  | "ruby"
  | "sql"
  | "json"
  | "xml"
  | "markdown"
  | "text";

export interface LanguageInfo {
  id: LanguageId;
  label: string;
}

const LANGUAGE_BY_EXTENSION: Record<string, LanguageInfo> = {
  html: { id: "html", label: "HTML" },
  htm: { id: "html", label: "HTML" },
  css: { id: "css", label: "CSS" },
  js: { id: "javascript", label: "JavaScript" },
  mjs: { id: "javascript", label: "JavaScript" },
  cjs: { id: "javascript", label: "JavaScript" },
  jsx: { id: "javascript", label: "JavaScript (JSX)" },
  ts: { id: "typescript", label: "TypeScript" },
  tsx: { id: "typescript", label: "TypeScript (TSX)" },
  py: { id: "python", label: "Python" },
  java: { id: "java", label: "Java" },
  c: { id: "c", label: "C" },
  h: { id: "c", label: "C header" },
  cpp: { id: "cpp", label: "C++" },
  cc: { id: "cpp", label: "C++" },
  cxx: { id: "cpp", label: "C++" },
  hpp: { id: "cpp", label: "C++ header" },
  cs: { id: "csharp", label: "C#" },
  go: { id: "go", label: "Go" },
  kt: { id: "kotlin", label: "Kotlin" },
  swift: { id: "swift", label: "Swift" },
  rs: { id: "rust", label: "Rust" },
  rb: { id: "ruby", label: "Ruby" },
  sql: { id: "sql", label: "SQL" },
  json: { id: "json", label: "JSON" },
  xml: { id: "xml", label: "XML" },
  md: { id: "markdown", label: "Markdown" },
  txt: { id: "text", label: "Plain text" },
};

/** Lower-case extensions without the dot, e.g. ["html", "css", ...]. */
export const SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(LANGUAGE_BY_EXTENSION);

/** Human-readable list for error messages. */
export const SUPPORTED_SUMMARY =
  "HTML, CSS, JavaScript, TypeScript, Python, Java, C, C++, C#, Go, Kotlin, Swift, Rust, Ruby, SQL, JSON, XML, Markdown and TXT";

/** Returns the lower-case extension without the dot, or "" when there is none. */
export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function isSupportedFilename(filename: string): boolean {
  return extensionOf(filename) in LANGUAGE_BY_EXTENSION;
}

/** Language for a filename; unknown extensions fall back to plain text. */
export function languageForFilename(filename: string): LanguageInfo {
  return LANGUAGE_BY_EXTENSION[extensionOf(filename)] ?? { id: "text", label: "Plain text" };
}
