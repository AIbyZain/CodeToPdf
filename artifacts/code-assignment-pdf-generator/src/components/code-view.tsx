import { useMemo, useState } from 'react';
import {
  CODE_THEME,
  findUnprintableCharacters,
  highlightLines,
  languageForFilename,
  normalizeSource,
} from '@workspace/code-render';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Rendering thousands of rows at once is slow; show this many first. */
const INITIAL_LINES = 1500;

export interface PreviewableFile {
  name: string;
  content: string;
  size: number;
}

/**
 * Read-only code viewer: line numbers, syntax highlighting, scrolling.
 * Uses exactly the same tokenizer and colours as the PDF, so what the student
 * sees here is what they get in the document. The source is never modified.
 */
export function CodeView({ name, content }: { name: string; content: string }) {
  const [showAll, setShowAll] = useState(false);
  const language = languageForFilename(name);
  const lines = useMemo(() => normalizeSource(content), [content]);
  const highlighted = useMemo(() => highlightLines(lines, language.id), [lines, language.id]);
  const visible = showAll ? highlighted : highlighted.slice(0, INITIAL_LINES);
  const gutterChars = String(lines.length).length;

  return (
    <div
      data-testid="code-view"
      className="overflow-hidden rounded-xl border"
      style={{ background: CODE_THEME.background, borderColor: CODE_THEME.border }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2.5 text-xs"
        style={{ background: CODE_THEME.headerBackground, color: CODE_THEME.headerText }}
      >
        <span className="h-2.5 w-2.5 rounded-full bg-[#f5615a]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#fabd4f]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#5ecc7d]" />
        <span className="ml-2 truncate font-mono-app">{name}</span>
        <span className="ml-auto whitespace-nowrap font-mono-app opacity-80">
          {language.label} · {lines.length} line{lines.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-max min-w-full border-collapse font-mono-app text-[12.5px] leading-[1.6]">
          <tbody>
            {visible.map((tokens, index) => (
              <tr key={index}>
                <td
                  className="sticky left-0 select-none border-r px-3 text-right align-top"
                  style={{
                    color: CODE_THEME.gutter,
                    background: CODE_THEME.background,
                    borderColor: CODE_THEME.border,
                    minWidth: `${gutterChars + 3}ch`,
                  }}
                >
                  {index + 1}
                </td>
                <td className="whitespace-pre px-4 align-top" style={{ color: CODE_THEME.tokens.plain }}>
                  {tokens.length === 0
                    ? ' '
                    : tokens.map((token, i) => (
                        <span
                          key={i}
                          style={{
                            color: CODE_THEME.tokens[token.kind],
                            fontStyle: token.kind === 'comment' ? 'italic' : undefined,
                          }}
                        >
                          {token.text}
                        </span>
                      ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!showAll && highlighted.length > INITIAL_LINES && (
          <div className="p-3 text-center">
            <button
              type="button"
              data-testid="button-show-all-lines"
              onClick={() => setShowAll(true)}
              className="rounded-md border px-3 py-1.5 text-xs"
              style={{ color: CODE_THEME.headerText, borderColor: CODE_THEME.border }}
            >
              Showing {INITIAL_LINES} of {highlighted.length} lines — show all
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Characters in a file that the PDF font can't print (shown as "?" in the PDF). */
export function unprintableSummary(content: string) {
  const { characters, count } = findUnprintableCharacters(content);
  if (!count) return null;
  return `${count} character${count === 1 ? '' : 's'} (${characters.join(' ')}) can't be printed by the PDF font and will appear as a red “?”.`;
}

export function CodePreviewDialog({
  file,
  onOpenChange,
}: {
  file: PreviewableFile | null;
  onOpenChange: (open: boolean) => void;
}) {
  const warning = file ? unprintableSummary(file.content) : null;
  return (
    <Dialog open={!!file} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl gap-3 bg-[hsl(var(--card))] p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="truncate pr-8 text-base">{file?.name}</DialogTitle>
          <DialogDescription className="text-xs">
            Read-only preview — this is exactly how the code will be coloured in the PDF.
          </DialogDescription>
        </DialogHeader>
        {warning && (
          <p data-testid="text-unprintable-warning" className="rounded-lg bg-[hsl(var(--accent)/.1)] px-3 py-2 text-xs text-[hsl(var(--foreground))]">
            {warning}
          </p>
        )}
        {file && <CodeView name={file.name} content={file.content} />}
      </DialogContent>
    </Dialog>
  );
}
