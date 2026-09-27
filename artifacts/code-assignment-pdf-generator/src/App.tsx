import { useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Download,
  Eye,
  FileCode2,
  FileText,
  Info,
  LoaderCircle,
  Plus,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
  X,
} from 'lucide-react';
import {
  useAnalyzeAssignment,
  useGenerateAssignmentPdf,
  useHealthCheck,
  type AssignmentAnalysis,
  type AssignmentInfo,
  type GroupedFile,
  type QuestionGroup,
  type SourceFile,
} from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import type { ReactNode } from 'react';

const queryClient = new QueryClient();

type Stage = 1 | 2 | 3 | 4;

const initialAssignment: AssignmentInfo = {
  title: '',
  studentName: '',
  rollNumber: '',
  courseName: '',
  instructorName: '',
};

const supportedExtensions = [
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.html', '.java', '.js', '.jsx',
  '.json', '.kt', '.md', '.py', '.rb', '.rs', '.sql', '.swift', '.ts', '.tsx', '.txt',
];

const stages = [
  { number: 1 as Stage, label: 'Assignment', detail: 'Identity & details', icon: FileText },
  { number: 2 as Stage, label: 'Upload', detail: 'Source files', icon: UploadCloud },
  { number: 3 as Stage, label: 'Review', detail: 'Question grouping', icon: ClipboardCheck },
  { number: 4 as Stage, label: 'Export', detail: 'Preview & download', icon: Eye },
];

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function prettyExtension(name: string) {
  const ext = extensionOf(name);
  return ext ? ext.slice(1).toUpperCase() : 'FILE';
}

function SectionTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <div className="font-mono-app mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--primary))]">
          <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" />
          {eyebrow}
        </div>
        <h2 className="text-balance text-3xl font-semibold tracking-[-0.04em] text-[hsl(var(--foreground))] sm:text-4xl">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[hsl(var(--muted-foreground))]">{description}</p>
      </div>
      {action}
    </div>
  );
}

function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'outline' | 'danger' }) {
  const styles = {
    primary: 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_5px_0_hsl(193_48%_25%)] hover:-translate-y-0.5 hover:shadow-[0_7px_0_hsl(193_48%_25%)] active:translate-y-0 active:shadow-[0_3px_0_hsl(193_48%_25%)]',
    quiet: 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))]',
    outline: 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]',
    danger: 'border border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--destructive)/.08)] text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.14)]',
  };
  return (
    <button
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  required = false,
  testId,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  testId: string;
}) {
  return (
    <label className="group block">
      <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-[hsl(var(--foreground))]">
        {label}
        {required && <span className="text-[hsl(var(--accent))]">*</span>}
        {hint && <span className="font-normal text-[hsl(var(--muted-foreground))]">{hint}</span>}
      </span>
      <input
        data-testid={testId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-12 w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3.5 text-sm text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary))] focus:ring-4 focus:ring-[hsl(var(--primary)/.11)]"
      />
    </label>
  );
}

function EmptyPanel({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof FileText;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)] px-6 py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[hsl(var(--secondary)/.55)] text-[hsl(var(--primary))]">
        <Icon size={22} strokeWidth={1.8} />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[hsl(var(--muted-foreground))]">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function AppShell() {
  const [stage, setStage] = useState<Stage>(1);
  const [assignment, setAssignment] = useState<AssignmentInfo>(initialAssignment);
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [analysis, setAnalysis] = useState<AssignmentAnalysis | null>(null);
  const [unsupported, setUnsupported] = useState<string[]>([]);
  const [fileError, setFileError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const health = useHealthCheck();
  const analyze = useAnalyzeAssignment();
  const generatePdf = useGenerateAssignmentPdf();
  const healthLabel = health.isError ? 'API offline' : health.isLoading ? 'Checking workspace' : 'Workspace ready';

  const requiredComplete = assignment.title.trim() && assignment.studentName.trim() && assignment.courseName.trim();
  const allGroupedCount = useMemo(
    () => analysis ? analysis.groups.reduce((sum, group) => sum + group.files.length, 0) + analysis.ungrouped.length : 0,
    [analysis],
  );

  const updateAssignment = (field: keyof AssignmentInfo, value: string) => {
    setAssignment((current) => ({ ...current, [field]: value }));
  };

  const readFiles = async (incoming: File[]) => {
    setFileError('');
    const rejected = incoming.filter((file) => !supportedExtensions.includes(extensionOf(file.name)));
    setUnsupported(rejected.map((file) => file.name));
    const accepted = incoming.filter((file) => supportedExtensions.includes(extensionOf(file.name)));
    if (!accepted.length) {
      if (rejected.length) setFileError('No supported source files were added.');
      return;
    }
    const existingNames = new Set(files.map((file) => file.name));
    const uniqueAccepted = accepted.filter((file) => !existingNames.has(file.name));
    const sourceFiles = await Promise.all(uniqueAccepted.map(async (file) => ({
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${file.name}-${file.lastModified}`,
      name: file.name,
      content: await file.text(),
      size: file.size,
    })));
    setFiles((current) => [...current, ...sourceFiles]);
    setAnalysis(null);
    setPdfUrl(null);
    if (uniqueAccepted.length === 0 && !rejected.length) setFileError('Those files are already in this workspace.');
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await readFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const removeFile = (id: string) => {
    setFiles((current) => current.filter((file) => file.id !== id));
    setAnalysis(null);
    setPdfUrl(null);
  };

  const runAnalysis = () => {
    if (!requiredComplete) {
      setStage(1);
      return;
    }
    if (!files.length) {
      setStage(2);
      setFileError('Add at least one supported source file before analyzing.');
      return;
    }
    setFileError('');
    analyze.mutate({ data: { assignment, files } }, {
      onSuccess: (result) => {
        setAnalysis(result);
        setPdfUrl(null);
        setStage(3);
      },
    });
  };

  const moveFile = (fileId: string, target: string) => {
    if (!analysis) return;
    let selected: GroupedFile | undefined;
    const nextGroups = analysis.groups.map((group) => ({
      ...group,
      files: group.files.filter((file) => {
        if (file.id === fileId) {
          selected = file;
          return false;
        }
        return true;
      }),
    })).filter((group) => group.files.length > 0);
    const nextUngrouped = analysis.ungrouped.filter((file) => {
      if (file.id === fileId) {
        selected = file;
        return false;
      }
      return true;
    });
    if (!selected) return;
    if (target === 'unassigned') {
      nextUngrouped.push({ ...selected, detectedQuestion: null, confidence: 'low' });
    } else {
      const questionNumber = Number(target);
      const targetGroup = nextGroups.find((group) => group.questionNumber === questionNumber);
      const moved = { ...selected, detectedQuestion: questionNumber, confidence: 'high' as const };
      if (targetGroup) targetGroup.files.push(moved);
      else nextGroups.push({ questionNumber, files: [moved] });
    }
    nextGroups.sort((a, b) => a.questionNumber - b.questionNumber);
    setAnalysis({ ...analysis, groups: nextGroups, ungrouped: nextUngrouped });
    setPdfUrl(null);
  };

  const addQuestion = () => {
    if (!analysis) return;
    const nextNumber = analysis.groups.reduce((max, group) => Math.max(max, group.questionNumber), 0) + 1;
    setAnalysis({ ...analysis, groups: [...analysis.groups, { questionNumber: nextNumber, files: [] }] });
  };

  const generate = () => {
    if (!analysis || !analysis.groups.length) return;
    setPdfError('');
    generatePdf.mutate({ data: { assignment, groups: analysis.groups.filter((group) => group.files.length > 0) } }, {
      onSuccess: (blob) => {
        if (pdfUrl) URL.revokeObjectURL(pdfUrl);
        setPdfUrl(URL.createObjectURL(blob));
        setStage(4);
      },
      onError: (error) => setPdfError(getErrorMessage(error, 'The PDF could not be generated. Please try again.')),
    });
  };

  const download = () => {
    if (!pdfUrl) {
      generate();
      return;
    }
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = `${(assignment.title || 'assignment').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const canGoToStage = (nextStage: Stage) => {
    if (nextStage === 3 && !analysis) return false;
    if (nextStage === 4 && !analysis) return false;
    return true;
  };

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden">
      <div className="noise" />
      <header className="relative z-10 border-b border-[hsl(var(--border)/.8)] bg-[hsl(var(--background)/.82)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-4 sm:px-8 lg:px-12">
          <button data-testid="button-brand-home" onClick={() => setStage(1)} className="group flex items-center gap-3 text-left">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[3px_3px_0_hsl(var(--secondary))] transition-transform group-hover:-rotate-3">
              <FileCode2 size={18} />
            </span>
            <span>
              <span className="block text-sm font-bold tracking-[-0.02em]">paper / compile</span>
              <span className="font-mono-app block text-[10px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">assignment pdf generator</span>
            </span>
          </button>
          <div data-testid="status-workspace" className="font-mono-app flex items-center gap-2 text-[10px] uppercase tracking-[0.13em] text-[hsl(var(--muted-foreground))]">
            <span className={`h-2 w-2 rounded-full ${health.isError ? 'bg-[hsl(var(--accent))]' : 'pulse-dot bg-[hsl(var(--secondary))]'}`} />
            <span className="hidden sm:inline">{healthLabel}</span>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto flex max-w-[1440px] flex-col lg:flex-row">
        <aside className="w-full shrink-0 border-b border-[hsl(var(--border)/.8)] px-5 py-5 sm:px-8 lg:w-[285px] lg:border-b-0 lg:border-r lg:px-8 lg:py-12 xl:w-[320px]">
          <div className="mb-6 hidden lg:block">
            <div className="font-mono-app text-[10px] uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">A calm path to submission</div>
            <p className="mt-3 max-w-[210px] text-sm leading-6 text-[hsl(var(--muted-foreground))]">Your files stay in this workspace until you are ready to export.</p>
          </div>
          <nav aria-label="Workflow stages" className="flex gap-2 overflow-x-auto lg:block lg:space-y-2">
            {stages.map((item) => {
              const Icon = item.icon;
              const active = stage === item.number;
              const complete = stage > item.number || (item.number === 3 && !!analysis);
              const locked = !canGoToStage(item.number);
              return (
                <button
                  key={item.number}
                  data-testid={`button-stage-${item.number}`}
                  disabled={locked}
                  onClick={() => setStage(item.number)}
                  className={`group flex min-w-[150px] flex-1 items-center gap-3 rounded-xl px-3 py-3 text-left transition-all lg:w-full ${active ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[4px_4px_0_hsl(var(--secondary))]' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'} ${locked ? 'cursor-not-allowed opacity-45' : ''}`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${active ? 'border-[hsl(var(--primary-foreground)/.2)] bg-[hsl(var(--primary-foreground)/.12)]' : complete ? 'border-[hsl(var(--primary)/.25)] bg-[hsl(var(--secondary)/.55)] text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'}`}>
                    {complete && !active ? <Check size={15} /> : <Icon size={15} />}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${active ? '' : 'text-[hsl(var(--foreground))]'}`}>{item.label}</span>
                    <span className={`block truncate text-[11px] ${active ? 'text-[hsl(var(--primary-foreground)/.65)]' : 'text-[hsl(var(--muted-foreground))]'}`}>{item.detail}</span>
                  </span>
                  {active && <ChevronRight className="ml-auto hidden lg:block" size={15} />}
                </button>
              );
            })}
          </nav>
          <div className="mt-8 hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)] p-4 lg:block">
            <div className="flex items-start gap-2 text-[hsl(var(--primary))]"><ShieldCheck size={16} /><span className="text-xs font-semibold">Built for deadline mode</span></div>
            <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Review every detection before a single PDF is made.</p>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-5 py-9 sm:px-8 sm:py-12 lg:px-14 lg:py-16 xl:px-20">
          <div className="mx-auto max-w-[930px]">
            {stage === 1 && (
              <div className="enter-up">
                <SectionTitle eyebrow="01 / assignment brief" title="Start with the cover sheet." description="A few details give your final PDF a proper academic header. You can change anything before export." />
                <div className="grid gap-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.72)] p-5 shadow-[0_18px_50px_hsl(164_25%_15%/.04)] sm:grid-cols-2 sm:p-8">
                  <div className="sm:col-span-2">
                    <Field label="Assignment title" value={assignment.title} onChange={(value) => updateAssignment('title', value)} placeholder="e.g. Data Structures — Lab 04" required testId="input-assignment-title" />
                  </div>
                  <Field label="Student name" value={assignment.studentName} onChange={(value) => updateAssignment('studentName', value)} placeholder="Your full name" required testId="input-student-name" />
                  <Field label="Roll number" hint="optional" value={assignment.rollNumber} onChange={(value) => updateAssignment('rollNumber', value)} placeholder="e.g. CS-24-017" testId="input-roll-number" />
                  <Field label="Course name" value={assignment.courseName} onChange={(value) => updateAssignment('courseName', value)} placeholder="e.g. Advanced Programming" required testId="input-course-name" />
                  <Field label="Instructor" hint="optional" value={assignment.instructorName} onChange={(value) => updateAssignment('instructorName', value)} placeholder="e.g. Dr. Maya Chen" testId="input-instructor-name" />
                  <div className="mt-2 flex items-center justify-between border-t border-[hsl(var(--border))] pt-5 sm:col-span-2">
                    <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><Info size={14} /> Required fields are marked with an asterisk.</div>
                    <Button data-testid="button-next-upload" onClick={() => setStage(2)} disabled={!requiredComplete}>Continue <ArrowRight size={16} /></Button>
                  </div>
                </div>
                {!requiredComplete && <p data-testid="text-assignment-hint" className="mt-4 text-center text-xs text-[hsl(var(--muted-foreground))]">Add a title, your name, and course to continue.</p>}
              </div>
            )}

            {stage === 2 && (
              <div className="enter-up">
                <SectionTitle eyebrow="02 / source material" title="Bring in the whole assignment." description="Drop your source files here. We read filenames and contents locally so the analyzer can suggest question groups." action={<span className="font-mono-app rounded-full bg-[hsl(var(--secondary)/.55)] px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--primary))]">{files.length} file{files.length === 1 ? '' : 's'} staged</span>} />
                <input ref={fileInputRef} type="file" multiple accept={supportedExtensions.join(',')} onChange={handleFileChange} className="hidden" data-testid="input-source-files" />
                <button
                  type="button"
                  data-testid="button-upload-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={async (event) => { event.preventDefault(); setDragActive(false); await readFiles(Array.from(event.dataTransfer.files)); }}
                  className={`group flex min-h-[250px] w-full flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition-all ${dragActive ? 'scale-[1.01] border-[hsl(var(--primary))] bg-[hsl(var(--secondary)/.28)]' : 'border-[hsl(var(--primary)/.35)] bg-[hsl(var(--card)/.62)] hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--secondary)/.16)]'}`}
                >
                  <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[4px_4px_0_hsl(var(--secondary))] transition-transform group-hover:-translate-y-1"><UploadCloud size={24} strokeWidth={1.7} /></span>
                  <span className="text-base font-semibold">Drop source files or browse</span>
                  <span className="mt-2 max-w-md text-sm leading-6 text-[hsl(var(--muted-foreground))]">JavaScript, TypeScript, Python, Java, C++, SQL and more. Multiple files are welcome.</span>
                  <span className="font-mono-app mt-5 text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--primary))]">{supportedExtensions.length} formats supported</span>
                </button>

                {unsupported.length > 0 && (
                  <div data-testid="error-unsupported-files" className="mt-5 flex items-start gap-3 rounded-xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.1)] p-4 text-sm">
                    <CircleHelp className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" size={17} />
                    <div><p className="font-semibold text-[hsl(var(--foreground))]">Some files were skipped</p><p className="mt-1 leading-5 text-[hsl(var(--muted-foreground))]">{unsupported.join(', ')} {unsupported.length === 1 ? 'is' : 'are'} not a supported source format.</p></div>
                    <button data-testid="button-dismiss-unsupported" onClick={() => setUnsupported([])} className="ml-auto text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"><X size={16} /></button>
                  </div>
                )}
                {fileError && <p data-testid="error-file-upload" className="mt-4 rounded-lg bg-[hsl(var(--destructive)/.08)] px-3 py-2 text-sm text-[hsl(var(--destructive))]">{fileError}</p>}

                {files.length > 0 && (
                  <div className="mt-7 overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.72)]">
                    <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4"><h3 className="text-sm font-semibold">Staged files</h3><span className="font-mono-app text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">ready to inspect</span></div>
                    <div className="divide-y divide-[hsl(var(--border))]">
                      {files.map((file) => (
                        <div key={file.id} data-testid={`row-source-file-${file.id}`} className="flex items-center gap-3 px-5 py-3.5">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))] font-mono-app text-[9px] font-semibold text-[hsl(var(--primary))]">{prettyExtension(file.name)}</span>
                          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file.name}</p><p className="font-mono-app mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">{formatSize(file.size)} · source text loaded</p></div>
                          <button data-testid={`button-remove-file-${file.id}`} onClick={() => removeFile(file.id)} className="rounded-md p-2 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--destructive)/.1)] hover:text-[hsl(var(--destructive))]}"><Trash2 size={16} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-8 flex flex-col-reverse justify-between gap-3 sm:flex-row">
                  <Button variant="quiet" data-testid="button-back-assignment" onClick={() => setStage(1)}><ChevronLeft size={16} /> Back</Button>
                  <Button data-testid="button-analyze-assignment" onClick={runAnalysis} disabled={!files.length || analyze.isPending}>
                    {analyze.isPending ? <><LoaderCircle className="animate-spin" size={16} /> Reading files…</> : <><WandSparkles size={16} /> Analyze & group files</>}
                  </Button>
                </div>
                {analyze.isError && <div data-testid="error-analysis" className="mt-4 flex items-center justify-between rounded-lg bg-[hsl(var(--destructive)/.08)] px-4 py-3 text-sm text-[hsl(var(--destructive))]"><span>{getErrorMessage(analyze.error, 'Analysis failed. Check your files and try again.')}</span><button data-testid="button-retry-analysis" onClick={runAnalysis} className="font-semibold underline">Retry</button></div>}
              </div>
            )}

            {stage === 3 && (
              <div className="enter-up">
                <SectionTitle eyebrow="03 / human review" title="Check the suggested structure." description="The analyzer makes a first pass from filenames. You have the final say — move any file to the right question before exporting." action={<div className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-xs"><CheckCircle2 size={14} className="text-[hsl(var(--primary))]" /><span data-testid="text-grouping-count">{allGroupedCount} files mapped</span></div>} />
                {!analysis ? (
                  <EmptyPanel icon={ClipboardCheck} title="Nothing to review yet" description="Upload your source files and run the analyzer first." action={<Button data-testid="button-go-upload" onClick={() => setStage(2)}>Go to upload <ArrowRight size={16} /></Button>} />
                ) : (
                  <>
                    <div className="mb-5 flex flex-col gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.2)] p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3"><Sparkles size={18} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" /><div><p className="text-sm font-semibold">Detection complete</p><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{analysis.groups.length} question group{analysis.groups.length === 1 ? '' : 's'} detected. Low-confidence files deserve a quick look.</p></div></div>
                      <Button variant="outline" data-testid="button-reanalyze" onClick={() => { setStage(2); runAnalysis(); }}><RotateCcw size={15} /> Re-analyze</Button>
                    </div>
                    <div className="space-y-4">
                      {analysis.groups.map((group) => <QuestionCard key={group.questionNumber} group={group} groups={analysis.groups} onMove={moveFile} />)}
                      {analysis.ungrouped.length > 0 && (
                        <div className="rounded-xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.07)] p-5">
                          <div className="mb-4 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--accent)/.16)] text-[hsl(var(--accent))]"><CircleHelp size={18} /></div><div><h3 className="text-sm font-semibold">Needs a home</h3><p className="text-xs text-[hsl(var(--muted-foreground))]">These files could not be confidently assigned.</p></div></div>
                          <div className="space-y-2">{analysis.ungrouped.map((file) => <FileRow key={file.id} file={file} groups={analysis.groups} onMove={moveFile} />)}</div>
                        </div>
                      )}
                      {analysis.groups.length === 0 && analysis.ungrouped.length === 0 && <EmptyPanel icon={ClipboardCheck} title="No question groups detected" description="Try checking the source filenames, then re-run the analysis." action={<Button data-testid="button-review-upload" onClick={() => setStage(2)}>Back to files <ChevronLeft size={16} /></Button>} />}
                    </div>
                    <div className="mt-6 flex flex-col-reverse justify-between gap-3 sm:flex-row"><Button variant="quiet" data-testid="button-back-upload" onClick={() => setStage(2)}><ChevronLeft size={16} /> Back</Button><div className="flex flex-col gap-3 sm:flex-row"><Button variant="outline" data-testid="button-add-question" onClick={addQuestion}><Plus size={16} /> Add question group</Button><Button data-testid="button-generate-preview" onClick={generate} disabled={!analysis.groups.some((group) => group.files.length) || generatePdf.isPending}>{generatePdf.isPending ? <><LoaderCircle className="animate-spin" size={16} /> Building preview…</> : <>Generate preview <ArrowRight size={16} /></>}</Button></div></div>
                    {pdfError && <div data-testid="error-pdf-generation" className="mt-4 flex items-center justify-between rounded-lg bg-[hsl(var(--destructive)/.08)] px-4 py-3 text-sm text-[hsl(var(--destructive))]"><span>{pdfError}</span><button data-testid="button-retry-pdf" onClick={generate} className="font-semibold underline">Retry</button></div>}
                  </>
                )}
              </div>
            )}

            {stage === 4 && (
              <div className="enter-up">
                <SectionTitle eyebrow="04 / finished document" title="Make your submission count." description="One last glance, then download a clean PDF with your assignment details and source files in question order." action={<div className="flex items-center gap-2 text-xs font-semibold text-[hsl(var(--primary))]"><ShieldCheck size={15} /> Review complete</div>} />
                {!analysis ? (
                  <EmptyPanel icon={Eye} title="Your preview will appear here" description="Complete the file analysis first, then come back to generate your PDF." action={<Button data-testid="button-go-review" onClick={() => setStage(3)}>Go to review <ArrowRight size={16} /></Button>} />
                ) : (
                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="relative min-h-[490px] overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[0_22px_60px_hsl(164_25%_15%/.09)]">
                      {pdfUrl ? <iframe title="Generated assignment PDF preview" data-testid="iframe-pdf-preview" src={pdfUrl} className="h-[600px] w-full border-0" /> : <PdfPaper assignment={assignment} groups={analysis.groups} />}
                    </div>
                    <div className="flex flex-col gap-4">
                      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--primary))] p-5 text-[hsl(var(--primary-foreground))]">
                        <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))]"><Download size={19} /></div>
                        <h3 className="text-lg font-semibold tracking-[-0.03em]">Ready to download</h3>
                        <p className="mt-2 text-sm leading-6 text-[hsl(var(--primary-foreground)/.7)]">Your PDF includes {analysis.groups.filter((group) => group.files.length > 0).length} question groups and {allGroupedCount} source files.</p>
                        <Button data-testid="button-download-pdf" onClick={download} className="mt-5 w-full bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] shadow-[0_5px_0_hsl(68_50%_48%)] hover:shadow-[0_7px_0_hsl(68_50%_48%)]">{pdfUrl ? <><Download size={16} /> Download PDF</> : <><WandSparkles size={16} /> Generate PDF</>}</Button>
                      </div>
                      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.72)] p-5">
                        <div className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck size={16} className="text-[hsl(var(--primary))]" /> Document checklist</div>
                        <ul className="mt-4 space-y-3 text-xs text-[hsl(var(--muted-foreground))]"><li className="flex gap-2"><Check size={14} className="shrink-0 text-[hsl(var(--primary))]" /> Assignment header included</li><li className="flex gap-2"><Check size={14} className="shrink-0 text-[hsl(var(--primary))]" /> Source files ordered by question</li><li className="flex gap-2"><Check size={14} className="shrink-0 text-[hsl(var(--primary))]" /> Ready for a final upload</li></ul>
                      </div>
                      <Button variant="outline" data-testid="button-edit-grouping" onClick={() => setStage(3)}><ChevronLeft size={16} /> Edit grouping</Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function FileRow({ file, groups, onMove }: { file: GroupedFile; groups: QuestionGroup[]; onMove: (id: string, target: string) => void }) {
  return (
    <div data-testid={`row-grouped-file-${file.id}`} className="flex flex-col gap-3 rounded-lg border border-[hsl(var(--border)/.75)] bg-[hsl(var(--card)/.75)] p-3 sm:flex-row sm:items-center">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--muted))] font-mono-app text-[8px] font-semibold text-[hsl(var(--primary))]">{prettyExtension(file.name)}</span>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file.name}</p><p className="font-mono-app mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">{formatSize(file.size)} · {file.detectedType || 'source file'}</p></div>
      <Confidence confidence={file.confidence} />
      <label className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><span className="whitespace-nowrap">Move to</span><select data-testid={`select-move-file-${file.id}`} value={String(file.detectedQuestion ?? 'unassigned')} onChange={(event) => onMove(file.id, event.target.value)} className="h-9 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-2 text-xs font-semibold text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--primary))]">{groups.map((group) => <option key={group.questionNumber} value={group.questionNumber}>Question {group.questionNumber}</option>)}<option value="unassigned">Unassigned</option></select></label>
    </div>
  );
}

function QuestionCard({ group, groups, onMove }: { group: QuestionGroup; groups: QuestionGroup[]; onMove: (id: string, target: string) => void }) {
  return (
    <section data-testid={`card-question-group-${group.questionNumber}`} className="overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.72)]">
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.4)] px-5 py-4"><div className="flex items-center gap-3"><span className="font-mono-app flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--primary))] text-xs font-semibold text-[hsl(var(--primary-foreground))]">{String(group.questionNumber).padStart(2, '0')}</span><div><h3 className="text-sm font-semibold">Question {group.questionNumber}</h3><p className="text-xs text-[hsl(var(--muted-foreground))]">{group.files.length} source file{group.files.length === 1 ? '' : 's'}</p></div></div><CheckCircle2 size={17} className="text-[hsl(var(--primary))]" /></div>
      <div className="space-y-2 p-3">{group.files.map((file) => <FileRow key={file.id} file={file} groups={groups} onMove={onMove} />)}</div>
    </section>
  );
}

function Confidence({ confidence }: { confidence: GroupedFile['confidence'] }) {
  const labels = { high: 'High confidence', medium: 'Worth checking', low: 'Low confidence' };
  const colors = { high: 'bg-[hsl(var(--secondary)/.55)] text-[hsl(var(--primary))]', medium: 'bg-[hsl(var(--accent)/.13)] text-[hsl(var(--accent))]', low: 'bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]' };
  return <span data-testid={`badge-confidence-${confidence}`} className={`hidden whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold sm:inline ${colors[confidence]}`}>{labels[confidence]}</span>;
}

function PdfPaper({ assignment, groups }: { assignment: AssignmentInfo; groups: QuestionGroup[] }) {
  return (
    <div data-testid="preview-pdf-paper" className="mx-auto max-w-[650px] p-7 sm:p-12">
      <div className="border-b-2 border-[hsl(var(--primary))] pb-5"><div className="font-mono-app text-[9px] uppercase tracking-[0.18em] text-[hsl(var(--primary))]">Coursework submission</div><h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{assignment.title || 'Untitled assignment'}</h3><div className="mt-4 grid grid-cols-2 gap-y-2 text-xs text-[hsl(var(--muted-foreground))]"><span><strong className="text-[hsl(var(--foreground))]">Student</strong> {assignment.studentName || '—'}</span><span><strong className="text-[hsl(var(--foreground))]">Roll no.</strong> {assignment.rollNumber || '—'}</span><span><strong className="text-[hsl(var(--foreground))]">Course</strong> {assignment.courseName || '—'}</span><span><strong className="text-[hsl(var(--foreground))]">Instructor</strong> {assignment.instructorName || '—'}</span></div></div>
      <div className="mt-7 space-y-5">{groups.filter((group) => group.files.length).map((group) => <div key={group.questionNumber} className="border-b border-[hsl(var(--border))] pb-4"><div className="flex items-center gap-2 text-sm font-semibold"><span className="font-mono-app text-[hsl(var(--primary))]">Q{group.questionNumber}</span><span>Question {group.questionNumber}</span></div><div className="mt-2 space-y-1">{group.files.map((file) => <div key={file.id} className="flex items-center justify-between rounded bg-[hsl(var(--muted)/.55)] px-3 py-2 text-xs"><span>{file.name}</span><span className="font-mono-app text-[9px] text-[hsl(var(--muted-foreground))]">{formatSize(file.size)}</span></div>)}</div></div>)}</div>
      <div className="mt-7 flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]"><ShieldCheck size={13} className="text-[hsl(var(--primary))]" /> Generated with paper / compile</div>
    </div>
  );
}

function Router() {
  return (
    <ErrorBoundary>
      <Switch><Route path="/" component={AppShell} /><Route component={NotFound} /></Switch>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;