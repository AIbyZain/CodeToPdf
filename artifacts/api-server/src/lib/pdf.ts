import {
  PDFDocument,
  PDFFont,
  PDFPage,
  rgb,
  StandardFonts,
  type RGB,
} from "pdf-lib";
import type { AssignmentPdfInput, GroupedFile, PdfSettings } from "@workspace/api-zod";
import {
  CODE_THEME,
  highlightLines,
  isBlankContent,
  languageForFilename,
  normalizeSource,
  wrapLines,
  type DisplayRow,
  type Token,
  type TokenKind,
} from "@workspace/code-render";

// ---------------------------------------------------------------------------
// Settings and page geometry
// ---------------------------------------------------------------------------

export const DEFAULT_PDF_SETTINGS: PdfSettings = {
  pageSize: "A4",
  fontSize: "medium",
  lineNumbers: true,
  syntaxHighlighting: true,
  coverPage: true,
};

const PAGE_SIZES = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
} as const;

/** Courier is monospaced: every glyph is exactly 0.6em wide. */
const COURIER_ADVANCE = 0.6;

const FONT_SIZES = {
  small: { size: 7.5, lineHeight: 10.4 },
  medium: { size: 8.5, lineHeight: 11.8 },
  large: { size: 10, lineHeight: 13.8 },
} as const;

const MARGIN_X = 48;
const MARGIN_TOP = 46;
const CONTENT_BOTTOM = 58;
const FOOTER_Y = 26;

const CAPTION_HEIGHT = 20;
const PANEL_HEADER = 20;
const PANEL_PAD_TOP = 9;
const PANEL_PAD_BOTTOM = 8;
const PANEL_PAD_X = 12;
const BLOCK_GAP = 18;
/** Never start a file (or a continuation) with fewer rows than this on a page. */
const MIN_ROWS_ON_PAGE = 5;

function hex(color: string): RGB {
  const value = Number.parseInt(color.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

const colors = {
  ink: rgb(0.1, 0.14, 0.2),
  muted: rgb(0.36, 0.41, 0.5),
  faint: rgb(0.55, 0.6, 0.68),
  border: rgb(0.82, 0.85, 0.9),
  accent: rgb(0.13, 0.42, 0.5),
  panel: hex(CODE_THEME.background),
  panelHeader: hex(CODE_THEME.headerBackground),
  panelHeaderText: hex(CODE_THEME.headerText),
  panelBorder: hex(CODE_THEME.border),
  gutter: hex(CODE_THEME.gutter),
  replaced: rgb(1, 0.37, 0.34),
  tokens: Object.fromEntries(
    Object.entries(CODE_THEME.tokens).map(([kind, value]) => [kind, hex(value)]),
  ) as Record<TokenKind, RGB>,
};

interface Fonts {
  code: PDFFont;
  codeItalic: PDFFont;
  body: PDFFont;
  bold: PDFFont;
  /** Code points the standard fonts can draw (WinAnsi). */
  charset: Set<number>;
}

// ---------------------------------------------------------------------------
// Text safety: the standard PDF fonts only cover WinAnsi (Latin-1 plus smart
// quotes, dashes, € and similar). Anything else becomes a clearly coloured "?"
// instead of crashing the whole export.
// ---------------------------------------------------------------------------

function safeText(value: string, fonts: Fonts): string {
  let out = "";
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    out += cp >= 0x20 && fonts.charset.has(cp) ? ch : "?";
  }
  return out;
}

interface SafeToken extends Token {
  replaced?: boolean;
}

/** Splits tokens so characters the font cannot draw become separate "?" tokens. */
function toSafeTokens(tokens: Token[], fonts: Fonts): SafeToken[] {
  const out: SafeToken[] = [];
  for (const token of tokens) {
    let buffer = "";
    for (const ch of token.text) {
      const cp = ch.codePointAt(0)!;
      if (cp >= 0x20 && fonts.charset.has(cp)) {
        buffer += ch;
      } else {
        if (buffer) out.push({ text: buffer, kind: token.kind });
        buffer = "";
        out.push({ text: "?", kind: token.kind, replaced: true });
      }
    }
    if (buffer) out.push({ text: buffer, kind: token.kind });
  }
  return out;
}

function fitText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (font.widthOfTextAtSize(text.slice(0, mid) + "…", size) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, low) + "…";
}

function wrapWords(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = fitText(word, font, size, maxWidth);
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

interface Layout {
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  charWidth: number;
  gutterWidth: number;
  maxChars: number;
  settings: PdfSettings;
}

function createLayout(settings: PdfSettings, maxLineNumber: number): Layout {
  const [width, height] = PAGE_SIZES[settings.pageSize];
  const { size, lineHeight } = FONT_SIZES[settings.fontSize];
  const charWidth = size * COURIER_ADVANCE;
  const digits = Math.max(2, String(maxLineNumber).length);
  // Line numbers need a gutter; without them we still keep a narrow one for
  // the "»" marker that shows a long line was wrapped.
  const gutterWidth = settings.lineNumbers ? (digits + 1) * charWidth + 8 : charWidth * 2;
  const panelWidth = width - MARGIN_X * 2;
  const usable = panelWidth - PANEL_PAD_X * 2 - gutterWidth;
  // Small safety margin so the last character never touches the panel edge.
  const maxChars = Math.floor((usable - 1) / charWidth);
  return { width, height, fontSize: size, lineHeight, charWidth, gutterWidth, maxChars, settings };
}

interface PreparedFile {
  file: GroupedFile;
  language: string;
  lineCount: number;
  rows: DisplayRow[];
  empty: boolean;
}

function prepareFile(file: GroupedFile, layout: Layout): PreparedFile {
  const language = languageForFilename(file.name);
  const empty = isBlankContent(file.content);
  const lines = normalizeSource(file.content);
  const tokens = layout.settings.syntaxHighlighting
    ? highlightLines(lines, language.id)
    : lines.map((line) => (line ? [{ text: line, kind: "plain" as const }] : []));
  return {
    file,
    language: language.label,
    lineCount: empty ? 0 : lines.length,
    rows: empty ? [] : wrapLines(tokens, layout.maxChars),
    empty,
  };
}

class PageWriter {
  pages: PDFPage[] = [];
  /** Question shown in the running header of each page. */
  pageQuestion = new Map<PDFPage, number>();
  page!: PDFPage;
  y = 0;

  constructor(
    private document: PDFDocument,
    private layout: Layout,
    private fonts: Fonts,
    private assignmentLabel: string,
  ) {}

  newPage(questionNumber: number, isQuestionStart: boolean) {
    const { width, height } = this.layout;
    this.page = this.document.addPage([width, height]);
    this.pages.push(this.page);
    this.pageQuestion.set(this.page, questionNumber);

    const top = height - MARGIN_TOP;
    if (isQuestionStart) {
      this.page.drawText(`Question ${questionNumber}`, {
        x: MARGIN_X,
        y: top - 14,
        size: 18,
        font: this.fonts.bold,
        color: colors.ink,
      });
      this.page.drawLine({
        start: { x: MARGIN_X, y: top - 24 },
        end: { x: width - MARGIN_X, y: top - 24 },
        thickness: 1.2,
        color: colors.ink,
      });
      this.y = top - 44;
    } else {
      this.page.drawText(`Question ${questionNumber} (continued)`, {
        x: MARGIN_X,
        y: top - 8,
        size: 9,
        font: this.fonts.bold,
        color: colors.muted,
      });
      this.page.drawLine({
        start: { x: MARGIN_X, y: top - 15 },
        end: { x: width - MARGIN_X, y: top - 15 },
        thickness: 0.6,
        color: colors.border,
      });
      this.y = top - 32;
    }
    const label = fitText(this.assignmentLabel, this.fonts.body, 8, width / 2 - MARGIN_X);
    const labelWidth = this.fonts.body.widthOfTextAtSize(label, 8);
    this.page.drawText(label, {
      x: width - MARGIN_X - labelWidth,
      y: top - (isQuestionStart ? 10 : 8),
      size: 8,
      font: this.fonts.body,
      color: colors.faint,
    });
  }

  rowsThatFit(): number {
    const room = this.y - CAPTION_HEIGHT - PANEL_HEADER - PANEL_PAD_TOP - PANEL_PAD_BOTTOM - CONTENT_BOTTOM;
    return Math.max(0, Math.floor(room / this.layout.lineHeight));
  }

  writeFile(prepared: PreparedFile, questionNumber: number) {
    const rows = prepared.rows;
    let index = 0;
    let part = 0;
    const totalRows = Math.max(1, rows.length);

    while (index < totalRows) {
      const remaining = totalRows - index;
      let fit = this.rowsThatFit();
      if (fit < Math.min(MIN_ROWS_ON_PAGE, remaining)) {
        this.newPage(questionNumber, false);
        fit = this.rowsThatFit();
      }
      const count = Math.min(remaining, fit);
      this.drawBlock(prepared, index, count, part > 0);
      index += count;
      part += 1;
    }
    this.y -= BLOCK_GAP;
  }

  private drawBlock(prepared: PreparedFile, start: number, count: number, continued: boolean) {
    const { width, lineHeight, fontSize, charWidth, gutterWidth, settings } = this.layout;
    const { fonts, page } = this;
    const panelX = MARGIN_X;
    const panelWidth = width - MARGIN_X * 2;

    // Caption: "File: question1.html"
    const captionY = this.y - 11;
    page.drawText("File:", { x: panelX, y: captionY, size: 10, font: fonts.body, color: colors.muted });
    const nameX = panelX + fonts.body.widthOfTextAtSize("File: ", 10);
    const name = fitText(safeText(prepared.file.name, fonts), fonts.bold, 10, panelWidth * 0.62);
    page.drawText(name, { x: nameX, y: captionY, size: 10, font: fonts.bold, color: colors.ink });
    if (continued) {
      page.drawText("(continued)", {
        x: nameX + fonts.bold.widthOfTextAtSize(name, 10) + 5,
        y: captionY,
        size: 9,
        font: fonts.body,
        color: colors.muted,
      });
    }

    // Line range, e.g. "HTML · lines 46–90 of 130"
    const rows = prepared.rows.slice(start, start + count);
    const numbered = rows.map((r) => r.lineNumber).filter((n): n is number => n !== null);
    const firstLine = numbered[0] ?? prepared.rows.slice(0, start).reverse().find((r) => r.lineNumber)?.lineNumber ?? 1;
    const lastLine = numbered[numbered.length - 1] ?? firstLine;
    const rangeLabel = prepared.empty
      ? `${prepared.language} · empty file`
      : `${prepared.language} · lines ${firstLine}–${lastLine} of ${prepared.lineCount}`;
    const rangeWidth = fonts.body.widthOfTextAtSize(rangeLabel, 8);
    page.drawText(rangeLabel, {
      x: panelX + panelWidth - rangeWidth,
      y: captionY + 1,
      size: 8,
      font: fonts.body,
      color: colors.muted,
    });

    // Editor-style panel sized to its content.
    const panelTop = this.y - CAPTION_HEIGHT;
    const bodyHeight = Math.max(1, count) * lineHeight + PANEL_PAD_TOP + PANEL_PAD_BOTTOM;
    const panelHeight = PANEL_HEADER + bodyHeight;
    const panelBottom = panelTop - panelHeight;
    page.drawRectangle({
      x: panelX,
      y: panelBottom,
      width: panelWidth,
      height: panelHeight,
      color: colors.panel,
      borderColor: colors.panelBorder,
      borderWidth: 0.8,
    });
    page.drawRectangle({
      x: panelX,
      y: panelTop - PANEL_HEADER,
      width: panelWidth,
      height: PANEL_HEADER,
      color: colors.panelHeader,
    });
    [rgb(0.96, 0.38, 0.35), rgb(0.98, 0.74, 0.31), rgb(0.37, 0.8, 0.49)].forEach((color, i) => {
      page.drawCircle({ x: panelX + 13 + i * 11, y: panelTop - PANEL_HEADER / 2, size: 3.2, color });
    });
    page.drawText(fitText(safeText(prepared.file.name, fonts), fonts.body, 8, panelWidth - 90), {
      x: panelX + 52,
      y: panelTop - PANEL_HEADER / 2 - 2.8,
      size: 8,
      font: fonts.body,
      color: colors.panelHeaderText,
    });

    const codeX = panelX + PANEL_PAD_X + gutterWidth;
    if (settings.lineNumbers) {
      const sepX = codeX - 6;
      page.drawLine({
        start: { x: sepX, y: panelBottom + 4 },
        end: { x: sepX, y: panelTop - PANEL_HEADER - 4 },
        thickness: 0.4,
        color: colors.panelBorder,
      });
    }

    const firstBaseline = panelTop - PANEL_HEADER - PANEL_PAD_TOP - fontSize * 0.82;

    if (prepared.empty) {
      page.drawText("(This file is empty.)", {
        x: codeX,
        y: firstBaseline,
        size: fontSize,
        font: fonts.codeItalic,
        color: colors.tokens.comment,
      });
    }

    rows.forEach((row, i) => {
      const y = firstBaseline - i * lineHeight;
      if (settings.lineNumbers && row.lineNumber !== null) {
        const label = String(row.lineNumber);
        page.drawText(label, {
          x: codeX - 10 - label.length * charWidth,
          y,
          size: fontSize,
          font: fonts.code,
          color: colors.gutter,
        });
      } else if (row.lineNumber === null) {
        page.drawText("»", { x: codeX - 10 - charWidth, y, size: fontSize, font: fonts.code, color: colors.gutter });
      }

      let x = codeX;
      for (const token of toSafeTokens(row.tokens, fonts)) {
        const advance = token.text.length * charWidth;
        if (token.text.trim()) {
          const color = token.replaced
            ? colors.replaced
            : settings.syntaxHighlighting
              ? colors.tokens[token.kind]
              : colors.tokens.plain;
          page.drawText(token.text, {
            x,
            y,
            size: fontSize,
            font: token.kind === "comment" && settings.syntaxHighlighting ? fonts.codeItalic : fonts.code,
            color,
          });
        }
        x += advance;
      }
    });

    this.y = panelBottom - 10;
  }
}

// ---------------------------------------------------------------------------
// Cover page and contents
// ---------------------------------------------------------------------------

interface ContentsEntry {
  questionNumber: number;
  files: string[];
  page: number;
}

const CONTENTS_ROW = 19;

/**
 * Works out the whole cover/contents layout before anything is drawn, so we
 * know how many front pages there will be (and therefore the final page
 * numbers to print in the contents) in a single pass.
 */
function planCover(input: AssignmentPdfInput, layout: Layout, fonts: Fonts, entries: number) {
  const { width, height } = layout;
  const a = input.assignment;
  const textWidth = width - MARGIN_X * 2;
  const titleLines = wrapWords(safeText(a.title?.trim() || "Code Assignment", fonts), fonts.bold, 26, textWidth).slice(0, 3);
  const details = [
    ["Student", a.studentName],
    ["Roll number", a.rollNumber],
    ["Course", a.courseName],
    ["Instructor", a.instructorName],
    ["Semester", a.semester],
    ["Section", a.section],
    ["Date", a.date],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()));

  const eyebrowY = height - 110;
  const titleY = eyebrowY - 38;
  const ruleY = titleY - titleLines.length * 32 + 8;
  const detailsY = ruleY - 34;
  const contentsY = detailsY - Math.ceil(details.length / 2) * 40 - (details.length ? 22 : 0);

  // Place every contents row: [pageIndex, y].
  const rows: Array<{ page: number; y: number }> = [];
  const headers: Array<{ page: number; y: number }> = [{ page: 0, y: contentsY }];
  let pageIndex = 0;
  let y = contentsY - 26;
  for (let i = 0; i < entries; i += 1) {
    if (y < CONTENT_BOTTOM + CONTENTS_ROW) {
      pageIndex += 1;
      const headerY = height - MARGIN_TOP - 14;
      headers.push({ page: pageIndex, y: headerY });
      y = headerY - 26;
    }
    rows.push({ page: pageIndex, y });
    y -= CONTENTS_ROW;
  }
  return { pageCount: pageIndex + 1, titleLines, details, eyebrowY, titleY, ruleY, detailsY, rows, headers };
}

function drawCover(
  document: PDFDocument,
  input: AssignmentPdfInput,
  layout: Layout,
  fonts: Fonts,
  contents: ContentsEntry[],
): number {
  const { width, height } = layout;
  const a = input.assignment;
  const plan = planCover(input, layout, fonts, contents.length);
  const pages = Array.from({ length: plan.pageCount }, (_, i) => document.insertPage(i, [width, height]));
  const cover = pages[0];
  const textWidth = width - MARGIN_X * 2;

  const eyebrow = safeText((a.courseName?.trim() || "Code assignment").toUpperCase(), fonts);
  cover.drawText(fitText(eyebrow, fonts.bold, 10, textWidth), {
    x: MARGIN_X,
    y: plan.eyebrowY,
    size: 10,
    font: fonts.bold,
    color: colors.accent,
  });
  plan.titleLines.forEach((line, i) => {
    cover.drawText(line, { x: MARGIN_X, y: plan.titleY - i * 32, size: 26, font: fonts.bold, color: colors.ink });
  });
  cover.drawLine({
    start: { x: MARGIN_X, y: plan.ruleY },
    end: { x: width - MARGIN_X, y: plan.ruleY },
    thickness: 2,
    color: colors.ink,
  });

  const columnWidth = textWidth / 2;
  plan.details.forEach(([label, value], index) => {
    const x = MARGIN_X + (index % 2) * columnWidth;
    const rowY = plan.detailsY - Math.floor(index / 2) * 40;
    cover.drawText(label.toUpperCase(), { x, y: rowY, size: 7.5, font: fonts.body, color: colors.muted });
    cover.drawText(fitText(safeText(value.trim(), fonts), fonts.body, 12.5, columnWidth - 16), {
      x,
      y: rowY - 16,
      size: 12.5,
      font: fonts.body,
      color: colors.ink,
    });
  });

  plan.headers.forEach(({ page, y }) => {
    const target = pages[page];
    target.drawText(page === 0 ? "Contents" : "Contents (continued)", {
      x: MARGIN_X,
      y,
      size: 12,
      font: fonts.bold,
      color: colors.ink,
    });
    target.drawLine({
      start: { x: MARGIN_X, y: y - 8 },
      end: { x: width - MARGIN_X, y: y - 8 },
      thickness: 0.6,
      color: colors.border,
    });
  });

  contents.forEach((entry, i) => {
    const { page, y } = plan.rows[i];
    const target = pages[page];
    const pageLabel = String(entry.page + plan.pageCount);
    const pageWidth = fonts.body.widthOfTextAtSize(pageLabel, 10);
    target.drawText(`Question ${entry.questionNumber}`, { x: MARGIN_X, y, size: 10, font: fonts.bold, color: colors.ink });
    const filesX = MARGIN_X + 86;
    const files = fitText(safeText(entry.files.join(", "), fonts), fonts.body, 9, width - MARGIN_X - filesX - pageWidth - 16);
    target.drawText(files, { x: filesX, y, size: 9, font: fonts.body, color: colors.muted });
    target.drawText(pageLabel, { x: width - MARGIN_X - pageWidth, y, size: 10, font: fonts.body, color: colors.ink });
  });

  return plan.pageCount;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function buildAssignmentPdf(input: AssignmentPdfInput) {
  const settings: PdfSettings = { ...DEFAULT_PDF_SETTINGS, ...(input.settings ?? {}) };
  const document = await PDFDocument.create();
  const code = await document.embedFont(StandardFonts.Courier);
  const fonts: Fonts = {
    code,
    codeItalic: await document.embedFont(StandardFonts.CourierOblique),
    body: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
    charset: new Set(code.getCharacterSet()),
  };

  const a = input.assignment;
  const title = a.title?.trim() || "Code Assignment";
  document.setTitle(title);
  if (a.studentName?.trim()) document.setAuthor(a.studentName.trim());
  if (a.courseName?.trim()) document.setSubject(a.courseName.trim());
  document.setCreator("Code Assignment PDF Generator");
  document.setProducer("Code Assignment PDF Generator");

  // Questions in numeric order; files in the order the student arranged them.
  const groups = [...input.groups]
    .filter((group) => group.files.length > 0)
    .sort((x, y) => x.questionNumber - y.questionNumber);
  if (!groups.length) throw new Error("There are no files to include in the PDF.");

  // Size the line-number gutter for the longest file so all panels line up.
  const maxLines = Math.max(
    1,
    ...groups.flatMap((group) => group.files.map((file) => normalizeSource(file.content).length)),
  );
  const layout = createLayout(settings, maxLines);
  const writer = new PageWriter(
    document,
    layout,
    fonts,
    safeText([title, a.studentName?.trim()].filter(Boolean).join(" · "), fonts),
  );

  const contents: ContentsEntry[] = [];
  for (const group of groups) {
    writer.newPage(group.questionNumber, true);
    contents.push({
      questionNumber: group.questionNumber,
      files: group.files.map((file) => file.name),
      page: writer.pages.length,
    });
    for (const file of group.files) {
      writer.writeFile(prepareFile(file, layout), group.questionNumber);
    }
  }

  if (settings.coverPage) {
    drawCover(document, input, layout, fonts, contents);
  }

  // Footers last, once the total page count is known.
  const allPages = document.getPages();
  const total = allPages.length;
  const footerLeft = safeText(
    [a.studentName?.trim(), a.rollNumber?.trim()].filter(Boolean).join(" · ") || title,
    fonts,
  );
  allPages.forEach((page, index) => {
    const { width } = page.getSize();
    page.drawLine({
      start: { x: MARGIN_X, y: FOOTER_Y + 12 },
      end: { x: width - MARGIN_X, y: FOOTER_Y + 12 },
      thickness: 0.5,
      color: colors.border,
    });
    page.drawText(fitText(footerLeft, fonts.body, 7.5, width / 2), {
      x: MARGIN_X,
      y: FOOTER_Y,
      size: 7.5,
      font: fonts.body,
      color: colors.muted,
    });
    const label = `Page ${index + 1} of ${total}`;
    page.drawText(label, {
      x: width - MARGIN_X - fonts.body.widthOfTextAtSize(label, 7.5),
      y: FOOTER_Y,
      size: 7.5,
      font: fonts.body,
      color: colors.muted,
    });
  });

  return document.save();
}
