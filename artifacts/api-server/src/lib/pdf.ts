import {
  PDFDocument,
  PDFFont,
  PDFPage,
  rgb,
  StandardFonts,
} from "pdf-lib";
import type { AssignmentPdfInput, GroupedFile } from "@workspace/api-zod";
import { sortFiles } from "./assignment";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CODE_FONT_SIZE = 8.2;
const CODE_LINE_HEIGHT = 11.5;
const MAX_CODE_LINES = 54;
const MAX_CHARS_PER_LINE = 92;

const colors = {
  ink: rgb(0.1, 0.14, 0.2),
  muted: rgb(0.36, 0.41, 0.5),
  border: rgb(0.82, 0.85, 0.9),
  panel: rgb(0.06, 0.09, 0.15),
  panelHeader: rgb(0.09, 0.13, 0.2),
  code: rgb(0.84, 0.89, 0.96),
  lineNumber: rgb(0.42, 0.5, 0.62),
  keyword: rgb(0.57, 0.65, 1),
  string: rgb(0.49, 0.84, 0.67),
  comment: rgb(0.45, 0.56, 0.64),
  number: rgb(0.96, 0.72, 0.4),
};

function safeText(value: string) {
  return value.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "·");
}

function wrapLine(line: string) {
  if (line.length <= MAX_CHARS_PER_LINE) return [line];
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += MAX_CHARS_PER_LINE) {
    chunks.push(line.slice(index, index + MAX_CHARS_PER_LINE));
  }
  return chunks;
}

function drawFooter(page: PDFPage, pageNumber: number, font: PDFFont, totalPages?: number) {
  page.drawLine({
    start: { x: MARGIN, y: 35 },
    end: { x: PAGE_WIDTH - MARGIN, y: 35 },
    thickness: 0.6,
    color: colors.border,
  });
  page.drawText(
    totalPages ? `Code Assignment · Page ${pageNumber} of ${totalPages}` : `Code Assignment · Page ${pageNumber}`,
    {
      x: MARGIN,
      y: 21,
      size: 7.5,
      font,
      color: colors.muted,
    },
  );
}

function tokenColor(token: string) {
  if (/^(\/\/|#|\/\*|\*)/.test(token)) return colors.comment;
  if (/^(["'`])/.test(token)) return colors.string;
  if (/^\d/.test(token)) return colors.number;
  return colors.keyword;
}

function drawHighlightedLine(
  page: PDFPage,
  line: string,
  x: number,
  y: number,
  font: PDFFont,
) {
  const pattern =
    /("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\/\/.*|#.*|\/\*.*\*\/|\b(?:const|let|var|function|return|if|else|for|while|class|import|from|def|public|private|protected|int|void|new|true|false|null|None|extends|static|package|using|include)\b|\b\d+(?:\.\d+)?\b)/g;
  let cursor = 0;
  let currentX = x;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    const before = safeText(line.slice(cursor, index));
    if (before) {
      page.drawText(before, { x: currentX, y, size: CODE_FONT_SIZE, font, color: colors.code });
      currentX += font.widthOfTextAtSize(before, CODE_FONT_SIZE);
    }
    const token = safeText(match[0]);
    page.drawText(token, {
      x: currentX,
      y,
      size: CODE_FONT_SIZE,
      font,
      color: tokenColor(token),
    });
    currentX += font.widthOfTextAtSize(token, CODE_FONT_SIZE);
    cursor = index + match[0].length;
  }
  const after = safeText(line.slice(cursor));
  if (after) {
    page.drawText(after, { x: currentX, y, size: CODE_FONT_SIZE, font, color: colors.code });
  }
}

function drawCodePage(
  document: PDFDocument,
  file: GroupedFile,
  questionNumber: number,
  pageNumber: number,
  filePart: number,
  totalParts: number,
  codeFont: PDFFont,
  headingFont: PDFFont,
  bodyFont: PDFFont,
) {
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const panelX = MARGIN;
  const panelY = 66;
  const panelWidth = PAGE_WIDTH - MARGIN * 2;
  const panelHeight = PAGE_HEIGHT - panelY - 98;
  const headerHeight = 34;

  page.drawText(`Question ${questionNumber}`, {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN,
    size: 17,
    font: headingFont,
    color: colors.ink,
  });
  page.drawText(
    `File: ${safeText(file.name)}${totalParts > 1 ? `  ·  Part ${filePart} of ${totalParts}` : ""}`,
    {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN - 22,
      size: 9,
      font: bodyFont,
      color: colors.muted,
    },
  );

  page.drawRectangle({
    x: panelX,
    y: panelY,
    width: panelWidth,
    height: panelHeight,
    color: colors.panel,
    borderColor: rgb(0.16, 0.21, 0.3),
    borderWidth: 0.8,
  });
  page.drawRectangle({
    x: panelX,
    y: panelY + panelHeight - headerHeight,
    width: panelWidth,
    height: headerHeight,
    color: colors.panelHeader,
  });
  [rgb(0.96, 0.38, 0.35), rgb(0.98, 0.74, 0.31), rgb(0.37, 0.8, 0.49)].forEach(
    (color, index) => {
      page.drawCircle({
        x: panelX + 16 + index * 14,
        y: panelY + panelHeight - 17,
        size: 4,
        color,
      });
    },
  );
  page.drawText(safeText(file.name), {
    x: panelX + 68,
    y: panelY + panelHeight - 20,
    size: 8.5,
    font: bodyFont,
    color: rgb(0.7, 0.76, 0.84),
  });

  const codeLines = file.content.replace(/\r\n/g, "\n").split("\n").flatMap(wrapLine);
  const visibleLines = codeLines.slice((filePart - 1) * MAX_CODE_LINES, filePart * MAX_CODE_LINES);
  const startY = panelY + panelHeight - headerHeight - 20;
  visibleLines.forEach((line, index) => {
    const y = startY - index * CODE_LINE_HEIGHT;
    const lineNumber = (filePart - 1) * MAX_CODE_LINES + index + 1;
    page.drawText(String(lineNumber).padStart(3, " "), {
      x: panelX + 14,
      y,
      size: CODE_FONT_SIZE,
      font: codeFont,
      color: colors.lineNumber,
    });
    drawHighlightedLine(page, line, panelX + 50, y, codeFont);
  });

  drawFooter(page, pageNumber, bodyFont);
  return page;
}

export async function buildAssignmentPdf(input: AssignmentPdfInput) {
  const document = await PDFDocument.create();
  const codeFont = await document.embedFont(StandardFonts.Courier);
  const titleFont = await document.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await document.embedFont(StandardFonts.Helvetica);

  const cover = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  cover.drawText("CODE ASSIGNMENT", {
    x: MARGIN,
    y: PAGE_HEIGHT - 120,
    size: 12,
    font: bodyFont,
    color: colors.muted,
  });
  cover.drawText(safeText(input.assignment.title), {
    x: MARGIN,
    y: PAGE_HEIGHT - 178,
    size: 31,
    maxWidth: PAGE_WIDTH - MARGIN * 2,
    font: titleFont,
    color: colors.ink,
  });
  cover.drawLine({
    start: { x: MARGIN, y: PAGE_HEIGHT - 205 },
    end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 205 },
    thickness: 2,
    color: colors.ink,
  });

  const details = [
    ["Student", input.assignment.studentName],
    ["Roll number", input.assignment.rollNumber],
    ["Course", input.assignment.courseName],
    ["Instructor", input.assignment.instructorName],
  ];
  details.forEach(([label, value], index) => {
    const y = PAGE_HEIGHT - 280 - index * 42;
    cover.drawText(label.toUpperCase(), {
      x: MARGIN,
      y,
      size: 7.5,
      font: bodyFont,
      color: colors.muted,
    });
    cover.drawText(safeText(value), {
      x: MARGIN,
      y: y - 17,
      size: 13,
      font: bodyFont,
      color: colors.ink,
    });
  });
  cover.drawText("Generated with Code Assignment PDF Generator", {
    x: MARGIN,
    y: 82,
    size: 8.5,
    font: bodyFont,
    color: colors.muted,
  });
  drawFooter(cover, 1, bodyFont);

  let pageNumber = 1;
  const orderedGroups = [...input.groups].sort((a, b) => a.questionNumber - b.questionNumber);
  for (const group of orderedGroups) {
    for (const file of sortFiles(group.files)) {
      const lines = file.content.replace(/\r\n/g, "\n").split("\n").flatMap(wrapLine);
      const totalParts = Math.max(1, Math.ceil(lines.length / MAX_CODE_LINES));
      for (let part = 1; part <= totalParts; part += 1) {
        pageNumber += 1;
        drawCodePage(
          document,
          file,
          group.questionNumber,
          pageNumber,
          part,
          totalParts,
          codeFont,
          titleFont,
          bodyFont,
        );
      }
    }
  }

  return document.save();
}
