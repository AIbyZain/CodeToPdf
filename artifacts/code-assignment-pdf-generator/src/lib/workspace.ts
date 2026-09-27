/**
 * Pure helpers for the upload and review steps. Kept free of React so the
 * rules (duplicates, binary files, grouping edits) are easy to reason about
 * and test.
 */
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  SUPPORTED_SUMMARY,
  decodeSourceBytes,
  extensionOf,
  isBlankContent,
  isSupportedFilename,
} from '@workspace/code-render';
import type { AssignmentAnalysis, GroupedFile, SourceFile } from '@workspace/api-client-react';

export type NoticeTone = 'error' | 'warning' | 'info';
export interface Notice {
  tone: NoticeTone;
  message: string;
}

export interface IncomingFile {
  name: string;
  size: number;
  bytes: () => Promise<Uint8Array>;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function listNames(names: string[], max = 4) {
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}

/** "question1.css" -> "question1 (2).css", avoiding names already taken. */
export function uniqueName(name: string, taken: Set<string>) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  while (taken.has(`${stem} (${n})${ext}`)) n += 1;
  return `${stem} (${n})${ext}`;
}

/**
 * Validates and reads newly added files. Never overwrites an existing file:
 * identical duplicates are skipped, different files with the same name are
 * kept under a numbered name and the student is told about it.
 */
export async function intakeFiles(
  incoming: IncomingFile[],
  existing: SourceFile[],
  makeId: () => string,
): Promise<{ added: SourceFile[]; notices: Notice[] }> {
  const notices: Notice[] = [];
  const added: SourceFile[] = [];
  const all = () => [...existing, ...added];
  const unsupported: string[] = [];
  const binary: string[] = [];
  const empty: string[] = [];
  const identical: string[] = [];
  let totalBytes = existing.reduce((sum, file) => sum + file.size, 0);

  for (const file of incoming) {
    if (!isSupportedFilename(file.name)) {
      unsupported.push(file.name);
      continue;
    }
    if (all().length >= MAX_FILES) {
      notices.push({ tone: 'error', message: `You can add up to ${MAX_FILES} files. ${file.name} and any files after it were not added.` });
      break;
    }
    if (file.size > MAX_FILE_BYTES) {
      notices.push({
        tone: 'error',
        message: `${file.name} is too large (${formatSize(file.size)}). Each file must be under ${formatSize(MAX_FILE_BYTES)}.`,
      });
      continue;
    }
    if (totalBytes + file.size > MAX_TOTAL_BYTES) {
      notices.push({
        tone: 'error',
        message: `${file.name} was not added: the assignment would exceed ${formatSize(MAX_TOTAL_BYTES)} in total. Remove some files or split it into two PDFs.`,
      });
      continue;
    }

    let decoded;
    try {
      decoded = decodeSourceBytes(await file.bytes());
    } catch {
      notices.push({ tone: 'error', message: `${file.name} could not be read. Try saving it again and re-uploading.` });
      continue;
    }
    if (!decoded.ok) {
      binary.push(file.name);
      continue;
    }
    if (isBlankContent(decoded.text)) {
      empty.push(file.name);
      continue;
    }

    const sameName = all().find((f) => f.name === file.name);
    let name = file.name;
    if (sameName) {
      if (sameName.content === decoded.text) {
        identical.push(file.name);
        continue;
      }
      name = uniqueName(file.name, new Set(all().map((f) => f.name)));
      notices.push({
        tone: 'warning',
        message: `Two different files are named ${file.name}. The new one was added as "${name}" so neither is overwritten — preview both and remove the one you don't want.`,
      });
    }

    added.push({ id: makeId(), name, content: decoded.text, size: file.size });
    totalBytes += file.size;
  }

  if (unsupported.length) {
    const exts = [...new Set(unsupported.map((n) => extensionOf(n)).filter(Boolean))].map((e) => `.${e}`);
    notices.unshift({
      tone: 'error',
      message: `Skipped ${listNames(unsupported)}${exts.length ? ` (${exts.join(', ')} not supported)` : ''}. Supported: ${SUPPORTED_SUMMARY}.`,
    });
  }
  if (binary.length) {
    notices.push({ tone: 'error', message: `Skipped ${listNames(binary)}: ${binary.length === 1 ? 'it looks' : 'they look'} like a binary file, not source code.` });
  }
  if (empty.length) {
    notices.push({ tone: 'warning', message: `Skipped ${listNames(empty)}: ${empty.length === 1 ? 'the file is' : 'these files are'} empty.` });
  }
  if (identical.length) {
    notices.push({ tone: 'info', message: `${listNames(identical)} ${identical.length === 1 ? 'was' : 'were'} already added (identical copy skipped).` });
  }
  return { added, notices };
}

// ---------------------------------------------------------------------------
// Grouping edits. Every function returns a new analysis object.
// ---------------------------------------------------------------------------

export type Location = number | 'unassigned';

export function locateFile(analysis: AssignmentAnalysis, fileId: string): Location | null {
  if (analysis.ungrouped.some((f) => f.id === fileId)) return 'unassigned';
  const group = analysis.groups.find((g) => g.files.some((f) => f.id === fileId));
  return group ? group.questionNumber : null;
}

export function nextQuestionNumber(analysis: AssignmentAnalysis) {
  return analysis.groups.reduce((max, group) => Math.max(max, group.questionNumber), 0) + 1;
}

function detach(analysis: AssignmentAnalysis, fileId: string) {
  let selected: GroupedFile | undefined;
  const take = (file: GroupedFile) => {
    if (file.id === fileId) {
      selected = file;
      return false;
    }
    return true;
  };
  const groups = analysis.groups.map((group) => ({ ...group, files: group.files.filter(take) }));
  const ungrouped = analysis.ungrouped.filter(take);
  return { groups, ungrouped, selected };
}

/** Moves a file to a question ("new" creates the next question number) or to Unassigned. */
export function moveFile(analysis: AssignmentAnalysis, fileId: string, target: Location | 'new'): AssignmentAnalysis {
  const { groups, ungrouped, selected } = detach(analysis, fileId);
  if (!selected) return analysis;
  if (target === 'unassigned') {
    return { ...analysis, groups, ungrouped: [...ungrouped, { ...selected, detectedQuestion: null, confidence: 'low' }] };
  }
  const questionNumber = target === 'new' ? nextQuestionNumber(analysis) : target;
  const moved: GroupedFile = { ...selected, detectedQuestion: questionNumber, confidence: 'high' };
  const existing = groups.find((g) => g.questionNumber === questionNumber);
  const nextGroups = existing
    ? groups.map((g) => (g.questionNumber === questionNumber ? { ...g, files: [...g.files, moved] } : g))
    : [...groups, { questionNumber, files: [moved] }];
  nextGroups.sort((a, b) => a.questionNumber - b.questionNumber);
  return { ...analysis, groups: nextGroups, ungrouped };
}

export function removeFile(analysis: AssignmentAnalysis, fileId: string): AssignmentAnalysis {
  const { groups, ungrouped } = detach(analysis, fileId);
  return { ...analysis, groups, ungrouped };
}

/** Moves a file up (-1) or down (+1) within its question. */
export function reorderFile(analysis: AssignmentAnalysis, fileId: string, direction: -1 | 1): AssignmentAnalysis {
  const swap = (files: GroupedFile[]) => {
    const index = files.findIndex((f) => f.id === fileId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= files.length) return files;
    const copy = [...files];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    return copy;
  };
  return {
    ...analysis,
    groups: analysis.groups.map((g) => ({ ...g, files: swap(g.files) })),
    ungrouped: swap(analysis.ungrouped),
  };
}

export function addQuestion(analysis: AssignmentAnalysis): AssignmentAnalysis {
  return { ...analysis, groups: [...analysis.groups, { questionNumber: nextQuestionNumber(analysis), files: [] }] };
}

/** Deletes a question; any files in it go back to Unassigned (never lost). */
export function deleteQuestion(analysis: AssignmentAnalysis, questionNumber: number): AssignmentAnalysis {
  const group = analysis.groups.find((g) => g.questionNumber === questionNumber);
  if (!group) return analysis;
  return {
    ...analysis,
    groups: analysis.groups.filter((g) => g.questionNumber !== questionNumber),
    ungrouped: [...analysis.ungrouped, ...group.files.map((f) => ({ ...f, detectedQuestion: null, confidence: 'low' as const }))],
  };
}

/** Accepts every "Suggested: Question N" hint on unassigned files. */
export function acceptAllSuggestions(analysis: AssignmentAnalysis): AssignmentAnalysis {
  return analysis.ungrouped
    .filter((f) => f.detectedQuestion !== null && f.detectedQuestion > 0)
    .reduce((current, file) => moveFile(current, file.id, file.detectedQuestion as number), analysis);
}

export function countFiles(analysis: AssignmentAnalysis) {
  return analysis.groups.reduce((sum, g) => sum + g.files.length, 0) + analysis.ungrouped.length;
}
