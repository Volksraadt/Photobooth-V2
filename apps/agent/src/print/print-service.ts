import type { PrinterStatusSummary } from '@pb/capture/protocol';
import type { PrintProfile } from '@pb/schema';
import type { AgentStore, PrintJobRow } from '../store';
import {
  listSystemPrinters,
  PrintError,
  submitPrint,
  VIRTUAL_PRINTER,
  type PrinterInfo,
} from './printers';

const PRINTER_KEY = 'printer.name';
const STATUS_POLL_MS = 30_000;

/**
 * Printer selection (admin), status polling, and print jobs recorded in print_jobs + outbox.
 * A job is `done` once the OS spooler/CUPS accepted it (physical completion is not tracked).
 */
export class PrintService {
  private printers: PrinterInfo[] = [];
  private summary: PrinterStatusSummary = { name: null, status: 'unknown', message: null };
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<(s: PrinterStatusSummary) => void>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: AgentStore,
    private readonly mode: 'system' | 'virtual',
    private readonly onEvent: (
      kind: string,
      message: string,
      level: 'info' | 'warn' | 'error',
      data?: unknown,
    ) => void,
  ) {}

  start() {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), STATUS_POLL_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  subscribe(listener: (s: PrinterStatusSummary) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get status(): PrinterStatusSummary {
    return this.summary;
  }

  selected(): string | null {
    const saved = this.store.getMeta(PRINTER_KEY);
    if (saved) return saved;
    if (this.mode === 'virtual') return VIRTUAL_PRINTER;
    return this.printers.find((p) => p.isDefault && !p.virtual)?.name ?? null;
  }

  select(name: string | null) {
    this.store.setMeta(PRINTER_KEY, name);
    this.onEvent('printer_selected', `Printer dipilih: ${name ?? '(default OS)'}`, 'info');
    this.updateSummary();
  }

  async list(): Promise<PrinterInfo[]> {
    await this.refresh();
    return this.printers;
  }

  async refresh(): Promise<void> {
    const system = this.mode === 'virtual' ? [] : await listSystemPrinters();
    this.printers = [
      ...system,
      { name: VIRTUAL_PRINTER, isDefault: false, status: 'ok', message: null, virtual: true },
    ];
    this.updateSummary();
  }

  private updateSummary(override?: Partial<PrinterStatusSummary>) {
    const name = this.selected();
    const p = name ? this.printers.find((x) => x.name === name) : undefined;
    const next: PrinterStatusSummary = name
      ? p
        ? { name, status: p.status, message: p.message }
        : { name, status: 'disconnected', message: 'Printer tidak ditemukan di sistem' }
      : { name: null, status: 'unknown', message: 'Belum ada printer dipilih' };
    Object.assign(next, override);
    const changed = JSON.stringify(next) !== JSON.stringify(this.summary);
    const wasBad = this.summary.status === 'error' || this.summary.status === 'disconnected';
    this.summary = next;
    if (!changed) return;
    if ((next.status === 'error' || next.status === 'disconnected') && !wasBad && name) {
      this.onEvent('printer_error', next.message ?? 'Printer bermasalah', 'error', {
        printer: name,
      });
    }
    for (const l of [...this.listeners]) l(next);
  }

  /**
   * Prints `sheets` copies of a sheet file. Jobs run one after another (one printer).
   * Throws PrintError when no printer is selected or the OS rejects the job.
   */
  print(input: {
    file: string;
    sheets: number;
    profile: PrintProfile;
    sessionId: string | null;
    sessionCode: string | null;
    title: string;
  }): Promise<PrintJobRow> {
    const run = async (): Promise<PrintJobRow> => {
      if (this.printers.length === 0) await this.refresh();
      const printer = this.selected();
      if (!printer) throw new PrintError('Belum ada printer dipilih (mode admin → Printer).');
      let job = this.store.addPrintJob({
        sessionId: input.sessionId,
        sheets: input.sheets,
        printer,
        filePath: input.file,
      });
      job = this.store.updatePrintJob(job.id, { status: 'printing' });
      try {
        const res = await submitPrint(
          {
            printer,
            file: input.file,
            copies: input.sheets,
            paper: { widthIn: input.profile.paper.widthIn, heightIn: input.profile.paper.heightIn },
            title: input.title,
          },
          this.store.dataDir,
        );
        job = this.store.updatePrintJob(job.id, { status: 'done', osJobId: res.osJobId });
        if (this.summary.status !== 'ok' && this.summary.status !== 'warning') {
          this.updateSummary({ status: 'ok', message: null });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        job = this.store.updatePrintJob(job.id, { status: 'failed', error: message });
        this.updateSummary({ status: 'error', message });
        this.record(job, input.sessionCode);
        throw err instanceof PrintError ? err : new PrintError(message);
      }
      this.record(job, input.sessionCode);
      return job;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private record(job: PrintJobRow, sessionCode: string | null) {
    this.store.enqueue(
      'print_job',
      {
        sessionId: job.session_id,
        sessionCode,
        sheets: job.sheets,
        status: job.status,
        occurredAt: job.updated_at,
      },
      job.id,
    );
  }
}
