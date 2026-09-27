/**
 * Small deterministic syntax highlighter.
 *
 * It never changes the source text: concatenating every token of a line gives
 * back exactly that (normalised) line. Highlighting is purely cosmetic, so when
 * a construct is not recognised it simply falls back to "plain".
 *
 * State is carried from line to line so multi-line comments, Python
 * docstrings, JS template strings and HTML <style>/<script> blocks are
 * coloured correctly across line breaks.
 */
import type { LanguageId } from "./languages";

export type TokenKind =
  | "plain"
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "tag"
  | "attr"
  | "property"
  | "selector"
  | "function"
  | "punct"
  | "meta";

export interface Token {
  text: string;
  kind: TokenKind;
}

/** Colours shared by the in-app preview and the PDF so they always match. */
export const CODE_THEME = {
  background: "#0f1726",
  headerBackground: "#172133",
  headerText: "#b3c2d6",
  border: "#29364d",
  gutter: "#6b7f9e",
  tokens: {
    plain: "#d6e3f5",
    keyword: "#93a6ff",
    string: "#7dd6ab",
    comment: "#8196a8",
    number: "#f7a76c",
    tag: "#ff8a8a",
    attr: "#f2d479",
    property: "#7fc8f8",
    selector: "#f2d479",
    function: "#6fd3e8",
    punct: "#9aa8bd",
    meta: "#d09cf5",
  } satisfies Record<TokenKind, string>,
} as const;

// ---------------------------------------------------------------------------
// Source normalisation
// ---------------------------------------------------------------------------

/**
 * Splits source into display lines: normalises line endings, removes a UTF-8
 * BOM, expands tabs to real tab stops (so indentation is preserved exactly)
 * and turns other invisible control characters into spaces. A single trailing
 * newline does not produce a phantom empty last line.
 */
export function normalizeSource(content: string, tabSize = 4): string[] {
  const text = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => expandTabs(line, tabSize).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, " "));
}

function expandTabs(line: string, tabSize: number): string {
  if (!line.includes("\t")) return line;
  let out = "";
  for (const ch of line) {
    if (ch === "\t") out += " ".repeat(tabSize - (out.length % tabSize));
    else out += ch;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

class LineBuilder {
  tokens: Token[] = [];
  push(text: string, kind: TokenKind) {
    if (!text) return;
    const last = this.tokens[this.tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else this.tokens.push({ text, kind });
  }
}

const words = (list: string) => new Set(list.split(/\s+/).filter(Boolean));

// ---------------------------------------------------------------------------
// C-like languages (JS, TS, Java, C, C++, C#, Go, Kotlin, Swift, Rust, Python,
// Ruby, SQL). One configurable scanner covers them all.
// ---------------------------------------------------------------------------

interface CLikeConfig {
  keywords: Set<string>;
  constants: Set<string>;
  lineComments: string[];
  blockComment?: [string, string];
  quotes: string[];
  multilineQuotes?: string[];
  tripleQuotes?: boolean;
  stringPrefixes?: boolean;
  preprocessor?: boolean;
  annotations?: boolean;
  caseInsensitive?: boolean;
}

interface CLikeState {
  mode: "code" | "block" | "string";
  quote: string;
}

const JS_KEYWORDS = words(`break case catch class const continue debugger default delete do else export extends
  finally for from function if import in instanceof let new of return static super switch this throw try typeof
  var void while with yield async await as get set`);
const TS_EXTRA = words(`interface type enum implements private public protected readonly abstract declare namespace keyof
  any unknown never string number boolean satisfies`);
const C_KEYWORDS = words(`auto break case char const continue default do double else enum extern float for goto if inline
  int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool`);
const CPP_EXTRA = words(`alignas alignof and asm catch class constexpr const_cast decltype delete dynamic_cast explicit export
  friend mutable namespace new noexcept not operator or override final private protected public reinterpret_cast
  static_assert static_cast template this throw try typeid typename using virtual wchar_t std cout cin endl string vector`);

const CONFIGS: Partial<Record<LanguageId, CLikeConfig>> = {
  javascript: {
    keywords: JS_KEYWORDS,
    constants: words("true false null undefined NaN Infinity"),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'", "`"],
    multilineQuotes: ["`"],
    annotations: true,
  },
  typescript: {
    keywords: new Set([...JS_KEYWORDS, ...TS_EXTRA]),
    constants: words("true false null undefined NaN Infinity"),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'", "`"],
    multilineQuotes: ["`"],
    annotations: true,
  },
  java: {
    keywords: words(`abstract assert boolean break byte case catch char class const continue default do double else enum
      extends final finally float for goto if implements import instanceof int interface long native new package private
      protected public return short static strictfp super switch synchronized this throw throws transient try void
      volatile while var record String`),
    constants: words("true false null"),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    annotations: true,
  },
  c: {
    keywords: C_KEYWORDS,
    constants: words("NULL true false"),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    preprocessor: true,
  },
  cpp: {
    keywords: new Set([...C_KEYWORDS, ...CPP_EXTRA]),
    constants: words("NULL nullptr true false"),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    preprocessor: true,
  },
  csharp: {
    keywords: words(`abstract as base bool break byte case catch char checked class const continue decimal default delegate
      do double else enum event explicit extern finally fixed float for foreach goto if implicit in int interface internal
      is lock long namespace new object operator out override params private protected public readonly ref return sbyte
      sealed short sizeof static string struct switch this throw try typeof uint ulong unchecked unsafe ushort using
      virtual void volatile while var async await get set`),
    constants: words("true false null"),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    preprocessor: true,
    annotations: false,
  },
  go: {
    keywords: words(`break case chan const continue default defer else fallthrough for func go goto if import interface map
      package range return select struct switch type var string int int64 float64 bool error byte rune`),
    constants: words("true false nil iota"),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'", "`"],
    multilineQuotes: ["`"],
  },
  kotlin: {
    keywords: words(`as break class continue do else for fun if in interface is object package return super this throw try
      typealias val var when while by catch constructor finally import init override private protected public data open
      abstract companion`),
    constants: words("true false null"),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    annotations: true,
  },
  swift: {
    keywords: words(`class deinit enum extension func import init let protocol struct subscript typealias var break case
      continue default do else fallthrough for guard if in repeat return switch where while as catch is rethrows throw
      throws try self Self super public private internal static override`),
    constants: words("true false nil"),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"'],
    annotations: true,
  },
  rust: {
    keywords: words(`as break const continue crate else enum extern fn for if impl in let loop match mod move mut pub ref
      return self Self static struct super trait type unsafe use where while async await dyn`),
    constants: words("true false None Some Ok Err"),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"'],
  },
  python: {
    keywords: words(`and as assert async await break class continue def del elif else except finally for from global if
      import in is lambda nonlocal not or pass raise return try while with yield match case self`),
    constants: words("True False None"),
    lineComments: ["#"],
    quotes: ['"', "'"],
    tripleQuotes: true,
    stringPrefixes: true,
    annotations: true,
  },
  ruby: {
    keywords: words(`alias and begin break case class def defined? do else elsif end ensure for if in module next not or redo
      rescue retry return self super then undef unless until when while yield puts require attr_accessor`),
    constants: words("true false nil"),
    lineComments: ["#"],
    quotes: ['"', "'"],
  },
  sql: {
    keywords: words(`select from where insert into values update set delete create table drop alter add primary key foreign
      references not unique default index join inner left right outer full on as and or in is like between order by
      group having limit offset distinct count sum avg min max union all exists case when then else end int integer
      varchar char text date datetime decimal float boolean auto_increment constraint check view database use desc asc
      begin commit rollback procedure function return returns declare`),
    constants: words("null true false"),
    lineComments: ["--"],
    blockComment: ["/*", "*/"],
    quotes: ["'", '"'],
    caseInsensitive: true,
  },
};

function tokenizeCLike(line: string, cfg: CLikeConfig, state: CLikeState, out: LineBuilder) {
  let i = 0;
  const n = line.length;

  const readString = () => {
    const q = state.quote;
    let j = i;
    while (j < n) {
      if (line[j] === "\\" && q.length === 1) {
        j += 2;
        continue;
      }
      if (line.startsWith(q, j)) {
        out.push(line.slice(i, j + q.length), "string");
        i = j + q.length;
        state.mode = "code";
        return;
      }
      j += 1;
    }
    out.push(line.slice(i), "string");
    i = n;
    const multiline = q.length === 3 || (cfg.multilineQuotes ?? []).includes(q);
    if (!multiline) state.mode = "code";
  };

  const firstNonSpace = line.search(/\S/);

  while (i < n) {
    if (state.mode === "block" && cfg.blockComment) {
      const end = line.indexOf(cfg.blockComment[1], i);
      if (end === -1) {
        out.push(line.slice(i), "comment");
        return;
      }
      out.push(line.slice(i, end + cfg.blockComment[1].length), "comment");
      i = end + cfg.blockComment[1].length;
      state.mode = "code";
      continue;
    }
    if (state.mode === "string") {
      readString();
      continue;
    }

    const ch = line[i];
    const rest = line.slice(i);

    if (cfg.preprocessor && ch === "#" && i === firstNonSpace) {
      out.push(rest, "meta");
      return;
    }
    if (cfg.lineComments.some((c) => rest.startsWith(c))) {
      out.push(rest, "comment");
      return;
    }
    if (cfg.blockComment && rest.startsWith(cfg.blockComment[0])) {
      out.push(cfg.blockComment[0], "comment");
      i += cfg.blockComment[0].length;
      state.mode = "block";
      continue;
    }
    if (cfg.tripleQuotes && (rest.startsWith('"""') || rest.startsWith("'''"))) {
      state.mode = "string";
      state.quote = rest.slice(0, 3);
      out.push(state.quote, "string");
      i += 3;
      continue;
    }
    if (cfg.quotes.includes(ch)) {
      state.mode = "string";
      state.quote = ch;
      out.push(ch, "string");
      i += 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(line[i + 1] ?? ""))) {
      const m = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|[0-9][0-9_]*(\.[0-9_]+)?([eE][+-]?[0-9]+)?|\.[0-9]+([eE][+-]?[0-9]+)?)[a-zA-Z]*/.exec(rest);
      const text = m ? m[0] : ch;
      out.push(text, "number");
      i += text.length;
      continue;
    }
    if (cfg.annotations && ch === "@" && /[A-Za-z_]/.test(line[i + 1] ?? "")) {
      const m = /^@[\w.]+/.exec(rest)!;
      out.push(m[0], "meta");
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][\w$]*[?!]?/.exec(rest)!;
      let word = m[0];
      // Ruby's "defined?" and Rust macros "println!" keep their suffix; otherwise drop it.
      if (/[?!]$/.test(word) && !cfg.keywords.has(word) && !/^\s*\(/.test(line.slice(i + word.length))) {
        word = word.slice(0, -1);
      }
      const next = line[i + word.length];
      if (cfg.stringPrefixes && /^[rRbBuUfF]{1,2}$/.test(word) && (next === '"' || next === "'")) {
        out.push(word, "string");
        i += word.length;
        continue;
      }
      const lookup = cfg.caseInsensitive ? word.toLowerCase() : word;
      let kind: TokenKind = "plain";
      if (cfg.keywords.has(lookup)) kind = "keyword";
      else if (cfg.constants.has(lookup)) kind = "number";
      else if (/^\s*\(/.test(line.slice(i + word.length)) || word.endsWith("!")) kind = "function";
      out.push(word, kind);
      i += word.length;
      continue;
    }
    if (/\s/.test(ch)) {
      const m = /^\s+/.exec(rest)!;
      out.push(m[0], "plain");
      i += m[0].length;
      continue;
    }
    out.push(ch, "punct");
    i += 1;
  }
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

interface CssState {
  depth: number;
  paren: number;
  inValue: boolean;
  inComment: boolean;
}

function tokenizeCss(line: string, state: CssState, out: LineBuilder) {
  let i = 0;
  const n = line.length;
  while (i < n) {
    const rest = line.slice(i);
    if (state.inComment) {
      const end = line.indexOf("*/", i);
      if (end === -1) {
        out.push(rest, "comment");
        return;
      }
      out.push(line.slice(i, end + 2), "comment");
      i = end + 2;
      state.inComment = false;
      continue;
    }
    const ch = line[i];
    if (rest.startsWith("/*")) {
      state.inComment = true;
      out.push("/*", "comment");
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && line[j] !== ch) j += line[j] === "\\" ? 2 : 1;
      const text = line.slice(i, Math.min(j + 1, n));
      out.push(text, "string");
      i += text.length;
      continue;
    }
    if (/\s/.test(ch)) {
      const m = /^\s+/.exec(rest)!;
      out.push(m[0], "plain");
      i += m[0].length;
      continue;
    }
    if (ch === "{") {
      state.depth += 1;
      state.inValue = false;
      out.push(ch, "punct");
      i += 1;
      continue;
    }
    if (ch === "}") {
      state.depth = Math.max(0, state.depth - 1);
      state.inValue = false;
      out.push(ch, "punct");
      i += 1;
      continue;
    }
    if (ch === ";") {
      state.inValue = false;
      out.push(ch, "punct");
      i += 1;
      continue;
    }
    if (ch === "(") state.paren += 1;
    if (ch === ")") {
      state.paren = Math.max(0, state.paren - 1);
      if (state.paren === 0 && state.depth === 0) state.inValue = false;
    }
    if (ch === "@") {
      const m = /^@[\w-]+/.exec(rest);
      if (m) {
        out.push(m[0], "keyword");
        i += m[0].length;
        continue;
      }
    }

    const declarationContext = state.depth > 0 || state.paren > 0;

    if (declarationContext && !state.inValue && ch === ":") {
      // "a:hover {" nested inside @media is a pseudo-class, not a declaration.
      const pseudo = state.paren === 0 ? /^::?[\w-]+(\([^)]*\))?[^;{}]*\{/.exec(rest) : null;
      if (pseudo) {
        const m = /^::?[\w-]+/.exec(rest)!;
        out.push(m[0], "keyword");
        i += m[0].length;
        continue;
      }
      state.inValue = true;
      out.push(ch, "punct");
      i += 1;
      continue;
    }

    if (state.inValue) {
      if (ch === "#") {
        const m = /^#[0-9a-fA-F]{3,8}\b/.exec(rest);
        if (m) {
          out.push(m[0], "number");
          i += m[0].length;
          continue;
        }
      }
      const num = /^-?(\d+\.?\d*|\.\d+)([a-zA-Z%]+)?/.exec(rest);
      if (num && (i === 0 || !/[\w-]/.test(line[i - 1]))) {
        out.push(num[0], "number");
        i += num[0].length;
        continue;
      }
      if (rest.startsWith("!important")) {
        out.push("!important", "keyword");
        i += 10;
        continue;
      }
      const ident = /^-?[A-Za-z_][\w-]*/.exec(rest);
      if (ident) {
        const isFn = line[i + ident[0].length] === "(";
        out.push(ident[0], isFn ? "function" : "plain");
        i += ident[0].length;
        continue;
      }
      out.push(ch, "punct");
      i += 1;
      continue;
    }

    // Selector context (or a declaration name).
    const ident = /^-?-?[A-Za-z_][\w-]*/.exec(rest);
    if (declarationContext && ident) {
      const after = line.slice(i + ident[0].length);
      const isNestedSelector =
        state.paren === 0 && (/^\s*:[^;{}]*\{/.test(after) || /^\s*[{,>+~.#[]/.test(after));
      const isProperty = /^\s*:/.test(after) && !isNestedSelector;
      out.push(ident[0], isProperty ? "property" : "selector");
      i += ident[0].length;
      continue;
    }
    if ((ch === "." || ch === "#") && /[A-Za-z_-]/.test(line[i + 1] ?? "")) {
      const m = /^[.#][\w-]+/.exec(rest)!;
      out.push(m[0], "selector");
      i += m[0].length;
      continue;
    }
    if (ch === ":") {
      const m = /^::?[\w-]+/.exec(rest);
      if (m) {
        out.push(m[0], "keyword");
        i += m[0].length;
        continue;
      }
    }
    if (ch === "[") {
      const end = line.indexOf("]", i);
      const text = end === -1 ? rest : line.slice(i, end + 1);
      out.push(text, "attr");
      i += text.length;
      continue;
    }
    if (ident) {
      out.push(ident[0], "tag");
      i += ident[0].length;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const m = /^\d+(\.\d+)?%?/.exec(rest)!;
      out.push(m[0], "number");
      i += m[0].length;
      continue;
    }
    out.push(ch, "punct");
    i += 1;
  }
}

// ---------------------------------------------------------------------------
// HTML / XML (with embedded CSS and JavaScript for HTML)
// ---------------------------------------------------------------------------

interface MarkupState {
  mode: "text" | "comment" | "tag" | "attrValue" | "decl" | "cdata" | "pi" | "embedded";
  quote: string;
  tagName: string;
  closing: boolean;
  embedded: "css" | "js" | null;
  css: CssState;
  js: CLikeState;
}

function tokenizeMarkup(line: string, state: MarkupState, out: LineBuilder, isXml: boolean) {
  let i = 0;
  const n = line.length;
  while (i < n) {
    const rest = line.slice(i);
    switch (state.mode) {
      case "embedded": {
        const closer = state.embedded === "css" ? "</style" : "</script";
        const end = rest.toLowerCase().indexOf(closer);
        const segment = end === -1 ? rest : rest.slice(0, end);
        if (state.embedded === "css") tokenizeCss(segment, state.css, out);
        else tokenizeCLike(segment, CONFIGS.javascript!, state.js, out);
        i += segment.length;
        if (end !== -1) {
          state.mode = "text";
          state.embedded = null;
          state.js = { mode: "code", quote: "" };
          state.css = { depth: 0, paren: 0, inValue: false, inComment: false };
        }
        continue;
      }
      case "comment": {
        const end = line.indexOf("-->", i);
        if (end === -1) {
          out.push(rest, "comment");
          return;
        }
        out.push(line.slice(i, end + 3), "comment");
        i = end + 3;
        state.mode = "text";
        continue;
      }
      case "cdata": {
        const end = line.indexOf("]]>", i);
        if (end === -1) {
          out.push(rest, "string");
          return;
        }
        out.push(line.slice(i, end + 3), "string");
        i = end + 3;
        state.mode = "text";
        continue;
      }
      case "pi":
      case "decl": {
        const closer = state.mode === "pi" ? "?>" : ">";
        const end = line.indexOf(closer, i);
        if (end === -1) {
          out.push(rest, "meta");
          return;
        }
        out.push(line.slice(i, end + closer.length), "meta");
        i = end + closer.length;
        state.mode = "text";
        continue;
      }
      case "attrValue": {
        const end = line.indexOf(state.quote, i);
        if (end === -1) {
          out.push(rest, "string");
          return;
        }
        out.push(line.slice(i, end + 1), "string");
        i = end + 1;
        state.mode = "tag";
        continue;
      }
      case "tag": {
        const ch = line[i];
        if (/\s/.test(ch)) {
          const m = /^\s+/.exec(rest)!;
          out.push(m[0], "plain");
          i += m[0].length;
          continue;
        }
        if (rest.startsWith("/>")) {
          out.push("/>", "punct");
          i += 2;
          state.mode = "text";
          continue;
        }
        if (ch === ">") {
          out.push(">", "punct");
          i += 1;
          state.mode = "text";
          if (!isXml && !state.closing && (state.tagName === "style" || state.tagName === "script")) {
            state.mode = "embedded";
            state.embedded = state.tagName === "style" ? "css" : "js";
          }
          continue;
        }
        if (ch === "=") {
          out.push("=", "punct");
          i += 1;
          continue;
        }
        if (ch === '"' || ch === "'") {
          state.quote = ch;
          state.mode = "attrValue";
          out.push(ch, "string");
          i += 1;
          continue;
        }
        const m = /^[^\s=>"'/]+/.exec(rest);
        if (m) {
          out.push(m[0], "attr");
          i += m[0].length;
          continue;
        }
        out.push(ch, "punct");
        i += 1;
        continue;
      }
      default: {
        // text
        const lt = line.indexOf("<", i);
        const amp = line.indexOf("&", i);
        const next = [lt, amp].filter((x) => x !== -1).sort((a, b) => a - b)[0];
        if (next === undefined) {
          out.push(rest, "plain");
          return;
        }
        out.push(line.slice(i, next), "plain");
        i = next;
        const r = line.slice(i);
        if (r[0] === "&") {
          const m = /^&(#\d+|#x[0-9a-fA-F]+|[A-Za-z]\w*);/.exec(r);
          const text = m ? m[0] : "&";
          out.push(text, m ? "meta" : "plain");
          i += text.length;
          continue;
        }
        if (r.startsWith("<!--")) {
          out.push("<!--", "comment");
          i += 4;
          state.mode = "comment";
          continue;
        }
        if (r.startsWith("<![CDATA[")) {
          out.push("<![CDATA[", "string");
          i += 9;
          state.mode = "cdata";
          continue;
        }
        if (r.startsWith("<?")) {
          out.push("<?", "meta");
          i += 2;
          state.mode = "pi";
          continue;
        }
        if (r.startsWith("<!")) {
          out.push("<!", "meta");
          i += 2;
          state.mode = "decl";
          continue;
        }
        const open = /^<(\/?)([A-Za-z][\w:.-]*)/.exec(r);
        if (open) {
          out.push("<" + open[1], "punct");
          out.push(open[2], "tag");
          i += open[0].length;
          state.mode = "tag";
          state.tagName = open[2].toLowerCase();
          state.closing = open[1] === "/";
          continue;
        }
        out.push("<", "plain");
        i += 1;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// JSON and Markdown
// ---------------------------------------------------------------------------

function tokenizeJson(line: string, out: LineBuilder) {
  const re = /("(?:\\.|[^"\\])*"?)(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|(\s+)|([^\s])/g;
  for (const m of line.matchAll(re)) {
    if (m[1] !== undefined) {
      out.push(m[1], m[2] ? "property" : "string");
      if (m[2]) out.push(m[2], "punct");
    } else if (m[3] !== undefined) out.push(m[3], "number");
    else if (m[4] !== undefined) out.push(m[4], "keyword");
    else if (m[5] !== undefined) out.push(m[5], "plain");
    else out.push(m[6], "punct");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Highlights already-normalised lines. Returns one token array per line;
 * every token array joins back to exactly the input line.
 */
export function highlightLines(lines: string[], language: LanguageId): Token[][] {
  const cfg = CONFIGS[language];
  const clike: CLikeState = { mode: "code", quote: "" };
  const css: CssState = { depth: 0, paren: 0, inValue: false, inComment: false };
  const markup: MarkupState = {
    mode: "text",
    quote: "",
    tagName: "",
    closing: false,
    embedded: null,
    css: { depth: 0, paren: 0, inValue: false, inComment: false },
    js: { mode: "code", quote: "" },
  };

  return lines.map((line) => {
    const out = new LineBuilder();
    try {
      if (cfg) tokenizeCLike(line, cfg, clike, out);
      else if (language === "css") tokenizeCss(line, css, out);
      else if (language === "html") tokenizeMarkup(line, markup, out, false);
      else if (language === "xml") tokenizeMarkup(line, markup, out, true);
      else if (language === "json") tokenizeJson(line, out);
      else if (language === "markdown") out.push(line, /^\s{0,3}#/.test(line) ? "keyword" : "plain");
      else out.push(line, "plain");
    } catch {
      // Highlighting must never lose code: fall back to the raw line.
      return [{ text: line, kind: "plain" as const }];
    }
    // Safety net: if a tokenizer ever dropped or duplicated characters, use the raw line.
    const joined = out.tokens.map((t) => t.text).join("");
    if (joined !== line) return line ? [{ text: line, kind: "plain" as const }] : [];
    return out.tokens;
  });
}

/** A display row: a whole source line, or a wrapped continuation of one. */
export interface DisplayRow {
  /** 1-based source line number; null for wrapped continuation rows. */
  lineNumber: number | null;
  tokens: Token[];
}

/**
 * Wraps highlighted lines to a fixed number of characters without losing or
 * re-ordering anything. Continuation rows have lineNumber === null so line
 * numbers always match the original file.
 */
export function wrapLines(lines: Token[][], maxChars: number): DisplayRow[] {
  const width = Math.max(8, Math.floor(maxChars));
  const rows: DisplayRow[] = [];
  lines.forEach((tokens, index) => {
    const text = tokens.map((t) => t.text).join("");
    if (text.length <= width) {
      rows.push({ lineNumber: index + 1, tokens });
      return;
    }
    let start = 0;
    let first = true;
    while (start < text.length) {
      let end = Math.min(text.length, start + width);
      if (end < text.length) {
        // Prefer breaking after a space near the end of the row for readability.
        const windowStart = start + Math.floor(width * 0.6);
        const space = text.lastIndexOf(" ", end - 1);
        if (space >= windowStart) end = space + 1;
      }
      rows.push({ lineNumber: first ? index + 1 : null, tokens: sliceTokens(tokens, start, end) });
      first = false;
      start = end;
    }
  });
  return rows;
}

function sliceTokens(tokens: Token[], start: number, end: number): Token[] {
  const out: Token[] = [];
  let pos = 0;
  for (const token of tokens) {
    const tStart = pos;
    const tEnd = pos + token.text.length;
    pos = tEnd;
    if (tEnd <= start || tStart >= end) continue;
    out.push({ text: token.text.slice(Math.max(0, start - tStart), Math.min(token.text.length, end - tStart)), kind: token.kind });
  }
  return out;
}
