import { execFile } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type PrinterInfo = {
  /** OS queue name (`lp -d`, Windows printer name), or VIRTUAL_PRINTER. */
  name: string;
  isDefault: boolean;
  status: 'ok' | 'warning' | 'error' | 'disconnected' | 'unknown';
  message: string | null;
  virtual: boolean;
};

/** Built-in printer that writes the sheet to dataDir/prints (dev, tests, dry runs). */
export const VIRTUAL_PRINTER = 'Printer virtual (simpan ke file)';

export type PrintRequest = {
  printer: string;
  file: string;
  copies: number;
  paper: { widthIn: number; heightIn: number };
  title: string;
};

export type PrintResult = { osJobId: string | null; detail: string };

export class PrintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrintError';
  }
}

/** Win32_Printer.PrinterStatus: 1 other, 2 unknown, 3 idle, 4 printing, 5 warmup, 6 stopped, 7 offline. */
function windowsStatus(p: {
  PrinterStatus?: number;
  WorkOffline?: boolean;
  DetectedErrorState?: number;
}) {
  if (p.WorkOffline || p.PrinterStatus === 7)
    return { status: 'disconnected' as const, message: 'Printer offline' };
  if (p.PrinterStatus === 6) return { status: 'error' as const, message: 'Printer berhenti' };
  // DetectedErrorState: 0 unknown, 2 no error; 3 low paper, 4 no paper, 5 low toner, 6 no toner, 7 door open, 8 jammed, 9 offline …
  const e = p.DetectedErrorState ?? 0;
  if (e === 4 || e === 6 || e === 7 || e === 8 || e === 9 || e === 10 || e === 11) {
    return { status: 'error' as const, message: `Printer error (kode ${e})` };
  }
  if (e === 3 || e === 5)
    return { status: 'warning' as const, message: 'Kertas/tinta hampir habis' };
  if (p.PrinterStatus === 3 || p.PrinterStatus === 4 || p.PrinterStatus === 5) {
    return { status: 'ok' as const, message: null };
  }
  return { status: 'unknown' as const, message: null };
}

async function listWindows(): Promise<PrinterInfo[]> {
  const { stdout } = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance -ClassName Win32_Printer | Select-Object Name,Default,WorkOffline,PrinterStatus,DetectedErrorState | ConvertTo-Json -Compress',
    ],
    { timeout: 20_000, windowsHide: true },
  );
  const text = stdout.trim();
  if (!text) return [];
  const parsed = JSON.parse(text) as unknown;
  const rows = (Array.isArray(parsed) ? parsed : [parsed]) as {
    Name: string;
    Default?: boolean;
    WorkOffline?: boolean;
    PrinterStatus?: number;
    DetectedErrorState?: number;
  }[];
  return rows.map((p) => ({
    name: p.Name,
    isDefault: !!p.Default,
    ...windowsStatus(p),
    virtual: false,
  }));
}

/** Parses `lpstat -p` / `lpstat -d` (CUPS, macOS + Linux). Exported for tests. */
export function parseLpstat(printers: string, defaults: string): PrinterInfo[] {
  const def = /destination:\s*(\S+)/.exec(defaults)?.[1] ?? null;
  const out: PrinterInfo[] = [];
  for (const line of printers.split('\n')) {
    const m = /^printer\s+(\S+)\s+(.*)$/.exec(line.trim());
    if (!m) continue;
    const rest = m[2]!;
    const disabled = /disabled/i.test(rest);
    out.push({
      name: m[1]!,
      isDefault: m[1] === def,
      status: disabled ? 'error' : /idle|printing|now printing/i.test(rest) ? 'ok' : 'unknown',
      message: disabled ? 'Printer dinonaktifkan (CUPS)' : null,
      virtual: false,
    });
  }
  return out;
}

async function listCups(): Promise<PrinterInfo[]> {
  const opts = { timeout: 10_000, env: { ...process.env, LANG: 'C', LC_ALL: 'C' } };
  const [p, d] = await Promise.all([
    run('lpstat', ['-p'], opts).catch((err: { stdout?: string }) => ({ stdout: err.stdout ?? '' })),
    run('lpstat', ['-d'], opts).catch(() => ({ stdout: '' })),
  ]);
  return parseLpstat(p.stdout, d.stdout);
}

export async function listSystemPrinters(): Promise<PrinterInfo[]> {
  try {
    return process.platform === 'win32' ? await listWindows() : await listCups();
  } catch (err) {
    console.warn('[agent] printer detection failed', err);
    return [];
  }
}

const PS_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'print-image.ps1');

/** Path of the PowerShell print script (the Tauri bundle overrides it next to the agent). */
export function printScriptPath(): string {
  return process.env.PB_PRINT_SCRIPT ?? PS_SCRIPT;
}

async function printWindows(req: PrintRequest): Promise<PrintResult> {
  try {
    const { stdout } = await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        printScriptPath(),
        '-Printer',
        req.printer,
        '-Path',
        req.file,
        '-Copies',
        String(req.copies),
        '-WidthIn',
        String(req.paper.widthIn),
        '-HeightIn',
        String(req.paper.heightIn),
        '-DocName',
        req.title,
      ],
      { timeout: 60_000, windowsHide: true },
    );
    return { osJobId: null, detail: stdout.trim() };
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new PrintError((e.stderr || e.message).trim().split('\n').slice(0, 3).join(' '));
  }
}

async function printCups(req: PrintRequest): Promise<PrintResult> {
  const pt = (inch: number) => Math.round(inch * 72);
  try {
    const { stdout } = await run(
      'lp',
      [
        '-d',
        req.printer,
        '-n',
        String(req.copies),
        '-t',
        req.title,
        '-o',
        `media=w${pt(req.paper.widthIn)}h${pt(req.paper.heightIn)}`,
        '-o',
        'fit-to-page',
        req.file,
      ],
      { timeout: 30_000, env: { ...process.env, LANG: 'C', LC_ALL: 'C' } },
    );
    return { osJobId: /request id is (\S+)/.exec(stdout)?.[1] ?? null, detail: stdout.trim() };
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new PrintError((e.stderr || e.message).trim());
  }
}

export async function printVirtual(req: PrintRequest, dataDir: string): Promise<PrintResult> {
  const dir = join(dataDir, 'prints');
  await mkdir(dir, { recursive: true });
  const target = join(
    dir,
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${req.title}-x${req.copies}.jpg`,
  );
  await copyFile(req.file, target);
  return { osJobId: null, detail: target };
}

export async function submitPrint(req: PrintRequest, dataDir: string): Promise<PrintResult> {
  if (req.printer === VIRTUAL_PRINTER) return printVirtual(req, dataDir);
  return process.platform === 'win32' ? printWindows(req) : printCups(req);
}
