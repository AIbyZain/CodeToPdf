import type {
  AssignmentAnalysis,
  AssignmentAnalysisInput,
  GroupedFile,
  QuestionGroup,
  SourceFile,
} from "@workspace/api-zod";

export const SUPPORTED_EXTENSIONS = [
  "html",
  "htm",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "java",
  "c",
  "h",
  "cpp",
  "cc",
  "cxx",
  "json",
  "xml",
  "txt",
];

const TYPE_BY_EXTENSION: Record<string, string> = {
  html: "HTML",
  htm: "HTML",
  css: "CSS",
  js: "JavaScript",
  jsx: "JavaScript",
  ts: "TypeScript",
  tsx: "TypeScript",
  py: "Python",
  java: "Java",
  c: "C",
  h: "C",
  cpp: "C++",
  cc: "C++",
  cxx: "C++",
  json: "JSON",
  xml: "XML",
  txt: "Text",
};

function extensionFor(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function detectQuestion(name: string) {
  const stem = name.replace(/\.[^.]+$/, "");
  const explicit = stem.match(/(?:question|ques|q)[\s_-]*(\d+)/i);
  if (explicit) {
    return { number: Number(explicit[1]), confidence: "high" as const };
  }

  const separatedNumber = stem.match(/(?:^|[\s_-])(\d+)(?:[\s_-]|$)/);
  if (separatedNumber) {
    return { number: Number(separatedNumber[1]), confidence: "medium" as const };
  }

  return { number: null, confidence: "low" as const };
}

export function analyzeAssignment(
  input: AssignmentAnalysisInput,
): AssignmentAnalysis {
  const groups = new Map<number, GroupedFile[]>();
  const ungrouped: GroupedFile[] = [];

  input.files.forEach((file: SourceFile) => {
    const extension = extensionFor(file.name);
    const detected = detectQuestion(file.name);
    const groupedFile: GroupedFile = {
      ...file,
      detectedQuestion: detected.number,
      detectedType: TYPE_BY_EXTENSION[extension] ?? "Unsupported",
      confidence: detected.confidence,
    };

    if (!SUPPORTED_EXTENSIONS.includes(extension)) {
      throw new Error(
        `"${file.name}" is not supported. Upload HTML, CSS, JavaScript, Python, Java, C, C++, JSON, XML, or TXT files.`,
      );
    }

    if (detected.number === null) {
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
    ungrouped,
    supportedExtensions: SUPPORTED_EXTENSIONS,
  };
}

export function sortFiles<T extends { name: string }>(files: T[]) {
  const rank = (name: string) => {
    const extension = extensionFor(name);
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
        a.index - b.index,
    )
    .map(({ file }) => file);
}
