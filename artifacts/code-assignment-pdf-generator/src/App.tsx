import { useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Code2,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  FileText,
  Info,
  LoaderCircle,
  Plus,
  RefreshCcw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  useAnalyzeAssignment,
  useGenerateAssignmentPdf,
  useHealthCheck,
  type AssignmentAnalysis,
  type AssignmentInfo,
  type GroupedFile,
  type PdfSettings,
  type QuestionGroup,
  type SourceFile,
} from '@workspace/api-client-react';
import { SUPPORTED_EXTENSIONS } from '@workspace/code-render';
import { CodePreviewDialog, unprintableSummary, type PreviewableFile } from '@/components/code-view';
import * as ws from '@/lib/workspace';
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
  semester: '',
  section: '',
  date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
};

const defaultSettings: PdfSettings = {
  pageSize: 'A4',
  fontSize: 'medium',
  lineNumbers: true,
  syntaxHighlighting: true,
  coverPage: true,
};

// Single source of truth shared with the API and the PDF renderer.
const supportedExtensions = SUPPORTED_EXTENSIONS.map((ext) => `.${ext}`);

const stages = [
  { number: 1 as Stage, label: 'Details', detail: 'Cover page information', icon: FileText },
  { number: 2 as Stage, label: 'Upload', detail: 'Source files', icon: UploadCloud },
  { number: 3 as Stage, label: 'Review', detail: 'Group & preview code', icon: ClipboardCheck },
  { number: 4 as Stage, label: 'Generate', detail: 'PDF settings & download', icon: Eye },
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
  const [notices, setNotices] = useState<ws.Notice[]>([]);
  const [reading, setReading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState('');
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);
  const [settings, setSettings] = useState<PdfSettings>(defaultSettings);
  /** Settings/grouping the current PDF was built from; used to flag a stale PDF. */
  const [builtFrom, setBuiltFrom] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const health = useHealthCheck();
  const analyze = useAnalyzeAssignment();
  const generatePdf = useGenerateAssignmentPdf();
  const healthLabel = health.isError ? 'API offline' : health.isLoading ? 'Checking workspace' : 'Workspace ready';

  const allGroupedCount = useMemo(() => (analysis ? ws.countFiles(analysis) : 0), [analysis]);
  const includedGroups = useMemo(
    () => (analysis ? analysis.groups.filter((group) => group.files.length > 0) : []),
    [analysis],
  );
  const includedFileCount = includedGroups.reduce((sum, group) => sum + group.files.length, 0);
  const unassignedCount = analysis?.ungrouped.length ?? 0;
  const suggestionCount = analysis?.ungrouped.filter((file) => file.detectedQuestion).length ?? 0;
  const currentKey = useMemo(
    () => JSON.stringify({ assignment, settings, groups: includedGroups.map((g) => [g.questionNumber, g.files.map((f) => f.id)]) }),
    [assignment, settings, includedGroups],
  );
  const pdfStale = !!pdfUrl && builtFrom !== currentKey;

  const updateAssignment = (field: keyof AssignmentInfo, value: string) => {
    setAssignment((current) => ({ ...current, [field]: value }));
  };

  const readFiles = async (incoming: File[]) => {
    if (!incoming.length) return;
    setReading(true);
    try {
      const { added, notices: nextNotices } = await ws.intakeFiles(
        incoming.map((file) => ({ name: file.name, size: file.size, bytes: async () => new Uint8Array(await file.arrayBuffer()) })),
        files,
        () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
      );
      setNotices(nextNotices);
      if (added.length) {
        setFiles((current) => [...current, ...added]);
        setAnalysis(null);
        setPdfUrl(null);
      }
    } finally {
      setReading(false);
    }
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
    if (!files.length) {
      setStage(2);
      setNotices([{ tone: 'error', message: 'Add at least one source file before reviewing the assignment.' }]);
      return;
    }
    analyze.mutate({ data: { assignment, files } }, {
      onSuccess: (result) => {
        setAnalysis(result);
        setPdfUrl(null);
        setStage(3);
      },
    });
  };

  // Review edits: every change goes through the pure helpers in lib/workspace.
  const editAnalysis = (change: (current: AssignmentAnalysis) => AssignmentAnalysis) => {
    setAnalysis((current) => (current ? change(current) : current));
  };
  const moveFile = (fileId: string, target: string) => {
    const destination = target === 'unassigned' ? 'unassigned' : target === 'new' ? 'new' : Number(target);
    editAnalysis((current) => ws.moveFile(current, fileId, destination));
  };
  const removeFromAssignment = (fileId: string) => {
    editAnalysis((current) => ws.removeFile(current, fileId));
    setFiles((current) => current.filter((file) => file.id !== fileId));
  };
  const reorderFile = (fileId: string, direction: -1 | 1) => editAnalysis((current) => ws.reorderFile(current, fileId, direction));
  const addQuestion = () => editAnalysis(ws.addQuestion);
  const deleteQuestion = (questionNumber: number) => editAnalysis((current) => ws.deleteQuestion(current, questionNumber));
  const acceptSuggestions = () => editAnalysis(ws.acceptAllSuggestions);

  const generate = () => {
    if (!analysis || !includedGroups.length) return;
    if (unassignedCount > 0) {
      setStage(3);
      return;
    }
    setPdfError('');
    const key = currentKey;
    generatePdf.mutate({ data: { assignment, groups: includedGroups, settings } }, {
      onSuccess: (blob) => {
        if (pdfUrl) URL.revokeObjectURL(pdfUrl);
        setPdfUrl(URL.createObjectURL(blob));
        setBuiltFrom(key);
        setStage(4);
      },
      onError: (error) => setPdfError(getErrorMessage(error, 'The PDF could not be generated. Please try again.')),
    });
  };

  const pdfFilename = `${(assignment.title.trim() || 'assignment').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'assignment'}.pdf`;

  const download = () => {
    if (!pdfUrl) {
      generate();
      return;
    }
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = pdfFilename;
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
                <SectionTitle eyebrow="01 / assignment details" title="Start with the cover sheet." description="These details appear on the PDF cover page. Every field is optional — fill in only what your instructor asks for." />
                <div className="grid gap-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.72)] p-5 shadow-[0_18px_50px_hsl(164_25%_15%/.04)] sm:grid-cols-2 sm:p-8">
                  <div className="sm:col-span-2">
                    <Field label="Assignment title" value={assignment.title} onChange={(value) => updateAssignment('title', value)} placeholder="e.g. Web Engineering — Lab 04" testId="input-assignment-title" />
                  </div>
                  <Field label="Student name" value={assignment.studentName} onChange={(value) => updateAssignment('studentName', value)} placeholder="Your full name" testId="input-student-name" />
                  <Field label="Roll number" value={assignment.rollNumber} onChange={(value) => updateAssignment('rollNumber', value)} placeholder="e.g. FA23-BSCS-017" testId="input-roll-number" />
                  <Field label="Course name" value={assignment.courseName} onChange={(value) => updateAssignment('courseName', value)} placeholder="e.g. Web Technologies" testId="input-course-name" />
                  <Field label="Instructor" value={assignment.instructorName} onChange={(value) => updateAssignment('instructorName', value)} placeholder="e.g. Dr. Maya Chen" testId="input-instructor-name" />
                  <Field label="Semester" value={assignment.semester ?? ''} onChange={(value) => updateAssignment('semester', value)} placeholder="e.g. Fall 2026" testId="input-semester" />
                  <Field label="Section" value={assignment.section ?? ''} onChange={(value) => updateAssignment('section', value)} placeholder="e.g. B" testId="input-section" />
                  <Field label="Date" value={assignment.date ?? ''} onChange={(value) => updateAssignment('date', value)} placeholder="e.g. 27 September 2026" testId="input-date" />
                  <div className="mt-2 flex flex-col gap-3 border-t border-[hsl(var(--border))] pt-5 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><Info size={14} /> You can turn the cover page off later in PDF settings.</div>
                    <Button data-testid="button-next-upload" onClick={() => setStage(2)}>Continue to upload <ArrowRight size={16} /></Button>
                  </div>
                </div>
              </div>
            )}

            {stage === 2 && (
              <div className="enter-up">
                <SectionTitle eyebrow="02 / upload files" title="Bring in the whole assignment." description="Add every file at once — e.g. question1.html, question1.css, question2.html… Files are read in your browser and never changed." action={<span className="font-mono-app rounded-full bg-[hsl(var(--secondary)/.55)] px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--primary))]">{files.length} file{files.length === 1 ? '' : 's'} added</span>} />
                <input ref={fileInputRef} type="file" multiple accept={supportedExtensions.join(',')} onChange={handleFileChange} className="hidden" data-testid="input-source-files" />
                <button
                  type="button"
                  data-testid="button-upload-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={async (event) => { event.preventDefault(); setDragActive(false); await readFiles(Array.from(event.dataTransfer.files)); }}
                  className={`group flex min-h-[230px] w-full flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition-all ${dragActive ? 'border-[hsl(var(--primary))] bg-[hsl(var(--secondary)/.28)]' : 'border-[hsl(var(--primary)/.35)] bg-[hsl(var(--card)/.62)] hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--secondary)/.16)]'}`}
                >
                  <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[4px_4px_0_hsl(var(--secondary))]">{reading ? <LoaderCircle className="animate-spin" size={24} /> : <UploadCloud size={24} strokeWidth={1.7} />}</span>
                  <span className="text-base font-semibold">{reading ? 'Reading files…' : 'Upload Files'}</span>
                  <span className="mt-2 max-w-md text-sm leading-6 text-[hsl(var(--muted-foreground))]">Drop files here or click to browse. HTML, CSS, JavaScript, Python, Java, C, C++, JSON, XML, TXT and more. Up to {ws.formatSize(1024 * 1024)} per file.</span>
                </button>

                {notices.length > 0 && (
                  <div data-testid="upload-notices" className="mt-5 space-y-2">
                    {notices.map((notice, index) => (
                      <div key={index} className={`flex items-start gap-3 rounded-xl border p-3.5 text-sm ${notice.tone === 'error' ? 'border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.07)]' : notice.tone === 'warning' ? 'border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.1)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)]'}`}>
                        {notice.tone === 'info' ? <Info className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" size={16} /> : <AlertTriangle className={`mt-0.5 shrink-0 ${notice.tone === 'error' ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--accent))]'}`} size={16} />}
                        <p className="leading-5 text-[hsl(var(--foreground))]">{notice.message}</p>
                      </div>
                    ))}
                    <button data-testid="button-dismiss-notices" onClick={() => setNotices([])} className="text-xs font-semibold text-[hsl(var(--muted-foreground))] underline hover:text-[hsl(var(--foreground))]">Dismiss messages</button>
                  </div>
                )}

                {files.length > 0 && (
                  <div className="mt-7 overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.72)]">
                    <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4"><h3 className="text-sm font-semibold">Uploaded files</h3><span className="font-mono-app text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">click a name to preview</span></div>
                    <div className="divide-y divide-[hsl(var(--border))]">
                      {files.map((file) => (
                        <div key={file.id} data-testid={`row-source-file-${file.id}`} className="flex items-center gap-3 px-5 py-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))] font-mono-app text-[9px] font-semibold text-[hsl(var(--primary))]">{prettyExtension(file.name)}</span>
                          <button type="button" onClick={() => setPreviewFile(file)} className="min-w-0 flex-1 text-left"><p className="truncate text-sm font-medium hover:underline">{file.name}</p><p className="font-mono-app mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">{formatSize(file.size)} · {file.content.split('\n').length} lines</p></button>
                          <button data-testid={`button-preview-file-${file.id}`} onClick={() => setPreviewFile(file)} title="Preview code" className="rounded-md p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--primary))]"><Code2 size={16} /></button>
                          <button data-testid={`button-remove-file-${file.id}`} onClick={() => removeFile(file.id)} title="Remove file" className="rounded-md p-2 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--destructive)/.1)] hover:text-[hsl(var(--destructive))]"><Trash2 size={16} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-8 flex flex-col-reverse justify-between gap-3 sm:flex-row">
                  <Button variant="quiet" data-testid="button-back-assignment" onClick={() => setStage(1)}><ChevronLeft size={16} /> Back</Button>
                  <Button data-testid="button-analyze-assignment" onClick={runAnalysis} disabled={!files.length || analyze.isPending || reading}>
                    {analyze.isPending ? <><LoaderCircle className="animate-spin" size={16} /> Organising files…</> : <>Review Assignment <ArrowRight size={16} /></>}
                  </Button>
                </div>
                {analyze.isError && <div data-testid="error-analysis" className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-[hsl(var(--destructive)/.08)] px-4 py-3 text-sm text-[hsl(var(--destructive))]"><span>{getErrorMessage(analyze.error, 'Your files could not be organised. Check them and try again.')}</span><button data-testid="button-retry-analysis" onClick={runAnalysis} className="font-semibold underline">Retry</button></div>}
              </div>
            )}

            {stage === 3 && (
              <div className="enter-up">
                <SectionTitle eyebrow="03 / review questions" title="Check the question structure." description="Files were grouped by their names. Move, reorder or remove anything that's wrong, and click a file to preview its code. Only this structure goes into the PDF." action={<div className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-xs"><CheckCircle2 size={14} className="text-[hsl(var(--primary))]" /><span data-testid="text-grouping-count">{allGroupedCount} files · {analysis?.groups.length ?? 0} questions</span></div>} />
                {!analysis ? (
                  <EmptyPanel icon={ClipboardCheck} title="Nothing to review yet" description="Upload your source files first." action={<Button data-testid="button-go-upload" onClick={() => setStage(2)}>Go to upload <ArrowRight size={16} /></Button>} />
                ) : (
                  <>
                    {unassignedCount > 0 && (
                      <div data-testid="warning-unassigned" className="mb-5 rounded-xl border border-[hsl(var(--accent)/.4)] bg-[hsl(var(--accent)/.1)] p-5">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--accent)/.16)] text-[hsl(var(--accent))]"><CircleHelp size={18} /></div>
                          <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-semibold">Unassigned files ({unassignedCount})</h3>
                            <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">We couldn't safely tell which question these belong to, so they were not placed anywhere. Assign each one to a question or remove it — unassigned files are not included in the PDF.</p>
                          </div>
                          {suggestionCount > 0 && <Button variant="outline" data-testid="button-accept-suggestions" onClick={acceptSuggestions} className="shrink-0"><Check size={15} /> Accept {suggestionCount} suggestion{suggestionCount === 1 ? '' : 's'}</Button>}
                        </div>
                        <div className="mt-4 space-y-2">{analysis.ungrouped.map((file, index) => <FileRow key={file.id} file={file} location="unassigned" index={index} total={analysis.ungrouped.length} groups={analysis.groups} onMove={moveFile} onRemove={removeFromAssignment} onReorder={reorderFile} onPreview={setPreviewFile} />)}</div>
                      </div>
                    )}
                    <div className="space-y-4">
                      {analysis.groups.map((group) => <QuestionCard key={group.questionNumber} group={group} groups={analysis.groups} onMove={moveFile} onRemove={removeFromAssignment} onReorder={reorderFile} onPreview={setPreviewFile} onDelete={deleteQuestion} />)}
                      {analysis.groups.length === 0 && <EmptyPanel icon={ClipboardCheck} title="No questions detected" description="None of the filenames named a question (like question1.html or q1.css). Add a question below and assign files to it." />}
                    </div>
                    <div className="mt-6 flex flex-col-reverse justify-between gap-3 sm:flex-row">
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <Button variant="quiet" data-testid="button-back-upload" onClick={() => setStage(2)}><ChevronLeft size={16} /> Back</Button>
                        <Button variant="outline" data-testid="button-reanalyze" onClick={runAnalysis} title="Discard your changes and group the files again"><RotateCcw size={15} /> Reset grouping</Button>
                      </div>
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <Button variant="outline" data-testid="button-add-question" onClick={addQuestion}><Plus size={16} /> Add question</Button>
                        <Button data-testid="button-generate-pdf" onClick={generate} disabled={!includedGroups.length || unassignedCount > 0 || generatePdf.isPending}>{generatePdf.isPending ? <><LoaderCircle className="animate-spin" size={16} /> Generating PDF…</> : <>Generate PDF <ArrowRight size={16} /></>}</Button>
                      </div>
                    </div>
                    {unassignedCount > 0 && <p className="mt-3 text-right text-xs text-[hsl(var(--muted-foreground))]">Assign or remove the {unassignedCount} unassigned file{unassignedCount === 1 ? '' : 's'} to continue.</p>}
                    {pdfError && <div data-testid="error-pdf-generation" className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-[hsl(var(--destructive)/.08)] px-4 py-3 text-sm text-[hsl(var(--destructive))]"><span>{pdfError}</span><button data-testid="button-retry-pdf" onClick={generate} className="font-semibold underline">Retry</button></div>}
                  </>
                )}
              </div>
            )}

            {stage === 4 && (
              <div className="enter-up">
                <SectionTitle eyebrow="04 / generate & download" title="Your assignment PDF." description="Adjust the settings if you like, then preview and download. Each question starts on a new page; long files continue across pages with nothing cut off." />
                {!analysis ? (
                  <EmptyPanel icon={Eye} title="Your PDF will appear here" description="Review your files first, then come back to generate the PDF." action={<Button data-testid="button-go-review" onClick={() => setStage(3)}>Go to review <ArrowRight size={16} /></Button>} />
                ) : (
                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="relative min-h-[490px] overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[0_22px_60px_hsl(164_25%_15%/.09)]">
                      {pdfUrl ? <iframe title="Generated assignment PDF preview" data-testid="iframe-pdf-preview" src={pdfUrl} className="h-[70vh] min-h-[520px] w-full border-0" /> : <PdfPaper assignment={assignment} groups={includedGroups} />}
                      {generatePdf.isPending && <div className="absolute inset-0 flex items-center justify-center bg-[hsl(var(--background)/.7)] text-sm font-semibold"><LoaderCircle className="mr-2 animate-spin" size={18} /> Generating PDF…</div>}
                    </div>
                    <div className="flex flex-col gap-4">
                      <SettingsPanel settings={settings} onChange={setSettings} />
                      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--primary))] p-5 text-[hsl(var(--primary-foreground))]">
                        <h3 className="text-lg font-semibold tracking-[-0.03em]">{pdfUrl && !pdfStale ? 'Ready to download' : pdfStale ? 'Settings changed' : 'Generate your PDF'}</h3>
                        <p className="mt-2 text-sm leading-6 text-[hsl(var(--primary-foreground)/.75)]">{includedGroups.length} question{includedGroups.length === 1 ? '' : 's'} · {includedFileCount} file{includedFileCount === 1 ? '' : 's'}{pdfStale ? ' — regenerate to apply your changes.' : ''}</p>
                        {(!pdfUrl || pdfStale) && <Button data-testid="button-regenerate-pdf" onClick={generate} disabled={generatePdf.isPending || unassignedCount > 0} className="mt-5 w-full bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] shadow-[0_5px_0_hsl(68_50%_48%)]"><RefreshCcw size={16} /> {pdfUrl ? 'Regenerate PDF' : 'Generate PDF'}</Button>}
                        {pdfUrl && <Button data-testid="button-download-pdf" onClick={download} className={`mt-3 w-full ${pdfStale ? 'bg-[hsl(var(--primary-foreground)/.15)] text-[hsl(var(--primary-foreground))] shadow-none' : 'bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] shadow-[0_5px_0_hsl(68_50%_48%)]'}`}><Download size={16} /> Download PDF{pdfStale ? ' (previous version)' : ''}</Button>}
                        {pdfUrl && <a data-testid="link-open-pdf" href={pdfUrl} target="_blank" rel="noreferrer" className="mt-3 flex items-center justify-center gap-2 text-xs font-semibold text-[hsl(var(--primary-foreground)/.85)] underline"><ExternalLink size={13} /> Preview PDF in a new tab</a>}
                      </div>
                      {pdfError && <div data-testid="error-pdf-generation-export" className="rounded-lg bg-[hsl(var(--destructive)/.08)] px-4 py-3 text-sm text-[hsl(var(--destructive))]">{pdfError}</div>}
                      {unassignedCount > 0 && <p className="rounded-lg bg-[hsl(var(--accent)/.1)] px-4 py-3 text-xs">{unassignedCount} file{unassignedCount === 1 ? ' is' : 's are'} still unassigned. <button className="font-semibold underline" onClick={() => setStage(3)}>Fix in review</button></p>}
                      <Button variant="outline" data-testid="button-edit-grouping" onClick={() => setStage(3)}><ChevronLeft size={16} /> Edit questions</Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
      <CodePreviewDialog file={previewFile} onOpenChange={(open) => { if (!open) setPreviewFile(null); }} />
    </div>
  );
}

type RowActions = {
  onMove: (id: string, target: string) => void;
  onRemove: (id: string) => void;
  onReorder: (id: string, direction: -1 | 1) => void;
  onPreview: (file: GroupedFile) => void;
};

function IconButton({ label, onClick, disabled, children, danger = false, testId }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; danger?: boolean; testId: string }) {
  return (
    <button type="button" data-testid={testId} title={label} aria-label={label} onClick={onClick} disabled={disabled} className={`rounded-md p-1.5 text-[hsl(var(--muted-foreground))] transition-colors disabled:opacity-30 ${danger ? 'hover:bg-[hsl(var(--destructive)/.1)] hover:text-[hsl(var(--destructive))]' : 'hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--primary))]'}`}>
      {children}
    </button>
  );
}

function FileRow({ file, location, index, total, groups, onMove, onRemove, onReorder, onPreview }: RowActions & { file: GroupedFile; location: number | 'unassigned'; index: number; total: number; groups: QuestionGroup[] }) {
  const suggestion = location === 'unassigned' && file.detectedQuestion ? file.detectedQuestion : null;
  const warning = unprintableSummary(file.content);
  return (
    <div data-testid={`row-grouped-file-${file.id}`} className="flex flex-col gap-2 rounded-lg border border-[hsl(var(--border)/.75)] bg-[hsl(var(--card)/.75)] p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--muted))] font-mono-app text-[8px] font-semibold text-[hsl(var(--primary))]">{prettyExtension(file.name)}</span>
        <button type="button" onClick={() => onPreview(file)} className="min-w-0 flex-1 text-left" title="Preview code">
          <p className="truncate text-sm font-medium hover:underline">{file.name}</p>
          <p className="font-mono-app mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">{formatSize(file.size)} · {file.detectedType || 'source file'}{suggestion ? ` · suggested: Question ${suggestion}` : ''}</p>
          {warning && <p className="mt-1 flex items-center gap-1 text-[10px] text-[hsl(var(--accent))]"><AlertTriangle size={11} /> {warning}</p>}
        </button>
      </div>
      <div className="flex items-center gap-1 self-end sm:self-auto">
        <select data-testid={`select-move-file-${file.id}`} aria-label={`Question for ${file.name}`} value={String(location)} onChange={(event) => onMove(file.id, event.target.value)} className="h-9 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-2 text-xs font-semibold text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--primary))]">
          {location === 'unassigned' && <option value="unassigned">Choose question…</option>}
          {groups.map((group) => <option key={group.questionNumber} value={group.questionNumber}>Question {group.questionNumber}</option>)}
          <option value="new">+ New question</option>
          {location !== 'unassigned' && <option value="unassigned">Unassigned</option>}
        </select>
        {suggestion && <button type="button" data-testid={`button-accept-suggestion-${file.id}`} onClick={() => onMove(file.id, String(suggestion))} className="h-9 whitespace-nowrap rounded-md bg-[hsl(var(--secondary)/.55)] px-2.5 text-xs font-semibold text-[hsl(var(--primary))]">Assign to Q{suggestion}</button>}
        <IconButton label="Preview code" testId={`button-preview-${file.id}`} onClick={() => onPreview(file)}><Code2 size={15} /></IconButton>
        {location !== 'unassigned' && <>
          <IconButton label="Move up" testId={`button-up-${file.id}`} onClick={() => onReorder(file.id, -1)} disabled={index === 0}><ArrowUp size={15} /></IconButton>
          <IconButton label="Move down" testId={`button-down-${file.id}`} onClick={() => onReorder(file.id, 1)} disabled={index === total - 1}><ArrowDown size={15} /></IconButton>
        </>}
        <IconButton label="Remove from assignment" testId={`button-remove-${file.id}`} onClick={() => onRemove(file.id)} danger><Trash2 size={15} /></IconButton>
      </div>
    </div>
  );
}

function QuestionCard({ group, groups, onDelete, ...actions }: RowActions & { group: QuestionGroup; groups: QuestionGroup[]; onDelete: (questionNumber: number) => void }) {
  return (
    <section data-testid={`card-question-group-${group.questionNumber}`} className="overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.72)]">
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.4)] px-5 py-3.5">
        <div className="flex items-center gap-3"><span className="font-mono-app flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--primary))] text-xs font-semibold text-[hsl(var(--primary-foreground))]">{String(group.questionNumber).padStart(2, '0')}</span><div><h3 className="text-sm font-semibold">Question {group.questionNumber}</h3><p className="text-xs text-[hsl(var(--muted-foreground))]">{group.files.length} file{group.files.length === 1 ? '' : 's'} · PDF order top to bottom</p></div></div>
        <IconButton label={`Delete question ${group.questionNumber}`} testId={`button-delete-question-${group.questionNumber}`} onClick={() => onDelete(group.questionNumber)} danger><X size={16} /></IconButton>
      </div>
      <div className="space-y-2 p-3">
        {group.files.length === 0 && <p className="rounded-lg border border-dashed border-[hsl(var(--border))] px-4 py-5 text-center text-xs text-[hsl(var(--muted-foreground))]">No files yet. Use a file's question menu to move it here. Empty questions are left out of the PDF.</p>}
        {group.files.map((file, index) => <FileRow key={file.id} file={file} location={group.questionNumber} index={index} total={group.files.length} groups={groups} {...actions} />)}
      </div>
    </section>
  );
}

function Segmented<T extends string>({ label, value, options, onSelect, testId }: { label: string; value: T; options: Array<[T, string]>; onSelect: (value: T) => void; testId: string }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold">{label}</p>
      <div className="grid gap-1 rounded-lg bg-[hsl(var(--muted))] p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map(([optionValue, optionLabel]) => (
          <button key={optionValue} type="button" data-testid={`${testId}-${optionValue}`} aria-pressed={value === optionValue} onClick={() => onSelect(optionValue)} className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${value === optionValue ? 'bg-[hsl(var(--card))] text-[hsl(var(--primary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`}>{optionLabel}</button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onToggle, testId }: { label: string; checked: boolean; onToggle: (checked: boolean) => void; testId: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-xs font-semibold">
      {label}
      <input type="checkbox" data-testid={testId} checked={checked} onChange={(event) => onToggle(event.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
    </label>
  );
}

function SettingsPanel({ settings, onChange }: { settings: PdfSettings; onChange: (settings: PdfSettings) => void }) {
  const set = <K extends keyof PdfSettings>(key: K, value: PdfSettings[K]) => onChange({ ...settings, [key]: value });
  return (
    <div data-testid="panel-pdf-settings" className="space-y-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.72)] p-5">
      <div className="flex items-center gap-2 text-sm font-semibold"><Settings2 size={16} className="text-[hsl(var(--primary))]" /> PDF settings</div>
      <Segmented label="Page size" value={settings.pageSize} options={[['A4', 'A4'], ['Letter', 'Letter']]} onSelect={(v) => set('pageSize', v)} testId="setting-page-size" />
      <Segmented label="Code font size" value={settings.fontSize} options={[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]} onSelect={(v) => set('fontSize', v)} testId="setting-font-size" />
      <div className="divide-y divide-[hsl(var(--border))]">
        <Toggle label="Line numbers" checked={settings.lineNumbers} onToggle={(v) => set('lineNumbers', v)} testId="setting-line-numbers" />
        <Toggle label="Syntax highlighting" checked={settings.syntaxHighlighting} onToggle={(v) => set('syntaxHighlighting', v)} testId="setting-syntax-highlighting" />
        <Toggle label="Cover page" checked={settings.coverPage} onToggle={(v) => set('coverPage', v)} testId="setting-cover-page" />
      </div>
    </div>
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