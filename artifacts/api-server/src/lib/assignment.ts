import type {
  AssignmentAnalysis,
  AssignmentAnalysisInput,
  GroupedFile,
  QuestionGroup,
  SourceFile,
} from "@workspace/api-zod";

import {
  MAX_FILE_BYTES,
  MAX_FILES,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_SUMMARY,
  extensionOf,
  isSupportedFilename,
  languageForFilename,
} from "@workspace/code-render";

export { SUPPORTED_EXTENSIONS };

/** Words that introduce a question number in a filename, longest first. */
const QUESTION_WORDS = "question|ques|qno|qn|q|task|problem|prob|exercise|ex";
const QUESTION_PATTERN = new RegExp(
  `(?:^|[^a-z])(?:${QUESTION_WORDS})[\\s_.#-]*(?:no[\\s_.#-]*)?0*(\\d{1,3})(?!\\d)`,
  "gi",
);

export type QuestionDetection = {
  number: number | null;
  confidence: "high" | "medium" | "low";
};

/**
 * Reads a question number from a filename.
 *
 * - "high": an explicit question word next to a number, e.g. question1.html,
 *   question_1.css, q1.js, Q1_HTML.html, Question-1.css, task2.py, ex3.c.
 *   Only high-confidence files are placed into a question automatically.
 * - "medium": the only number in an otherwise unlabeled name, e.g. 2.html or
 *   lab_2.js. This is shown as a suggestion but the file stays UNASSIGNED
 *   until the student confirms it, so nothing lands in the wrong question.
 * - "low": no usable number.
 */
export function detectQuestion(filename: string): QuestionDetection {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  // Split camelCase so "myQuestion2.js" is read as "my_Question2".
  const stem = base.replace(/\.[^.]+$/, "").replace(/([a-z])([A-Z])/g, "$1_$2");

  const explicit = new Set<number>();
  for (const match of stem.matchAll(QUESTION_PATTERN)) {
    const value = Number(match[1]);
    if (value > 0) explicit.add(value);
  }
  if (explicit.size === 1) return { number: [...explicit][0], confidence: "high" };
  if (explicit.size > 1) return { number: null, confidence: "low" };

  const numbers = stem.match(/\d+/g) ?? [];
  if (numbers.length === 1) {
    const value = Number(numbers[0]);
    if (value > 0 && value < 1000) return { number: value, confidence: "medium" };
  }
  return { number: null, confidence: "low" };
}

function validateFile(file: SourceFile) {
  if (!file.name.trim()) {
    throw new Error("One of the files has no name. Please remove it and upload it again.");
  }
  if (!isSupportedFilename(file.name)) {
    const ext = extensionOf(file.name);
    throw new Error(
      `"${file.name}" ${ext ? `(.${ext}) ` : ""}is not a supported file type. Upload ${SUPPORTED_SUMMARY} files.`,
    );
  }
  if (file.content.length > MAX_FILE_BYTES * 1.05) {
    throw new Error(`"${file.name}" is too large. Each file must be under ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`);
  }
}

export function validateFiles(files: SourceFile[]) {
  if (files.length > MAX_FILES) {
    throw new Error(`Too many files. Please upload at most ${MAX_FILES} files per assignment.`);
  }
  files.forEach(validateFile);
}

export function analyzeAssignment(
  input: AssignmentAnalysisInput,
): AssignmentAnalysis {
  validateFiles(input.files);

  const groups = new Map<number, GroupedFile[]>();
  const ungrouped: GroupedFile[] = [];

  input.files.forEach((file: SourceFile) => {
    const detected = detectQuestion(file.name);
    const groupedFile: GroupedFile = {
      ...file,
      // For unassigned files this carries the suggested question (or null).
      detectedQuestion: detected.number,
      detectedType: languageForFilename(file.name).label,
      confidence: detected.confidence,
    };

    if (detected.confidence !== "high" || detected.number === null) {
      ungrouped.push(groupedFile);
      return;
    }

    const questionFiles = groups.get(detected.number) ?? [];
    questionFiles.push(groupedFile);
    groups.set(detected.number, questionFiles);
  });

  const orderedGroups: QuestionGroup[] = Array.from(groups.entries())
    .sort(([left], [right]) => left - right)
    .map(([questionNumber, files]) => ({
      questionNumber,
      files: sortFiles(files),
    }));

  return {
    assignment: input.assignment,
    groups: orderedGroups,
    ungrouped: [...ungrouped].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    supportedExtensions: [...SUPPORTED_EXTENSIONS],
  };
}

export function sortFiles<T extends { name: string }>(files: T[]) {
  const rank = (name: string) => {
    const extension = extensionOf(name);
    if (extension === "html" || extension === "htm") return 0;
    if (extension === "css") return 1;
    if (["js", "jsx", "ts", "tsx"].includes(extension)) return 2;
    return 3;
  };

  return files
    .map((file, index) => ({ file, index }))
    .sort(
      (a, b) =>
        rank(a.file.name) - rank(b.file.name) ||
        a.file.name.localeCompare(b.file.name, undefined, { numeric: true }) ||
        a.index - b.index,
    )
    .map(({ file }) => file);
}
