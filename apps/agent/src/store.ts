import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createId } from '@paralleldrive/cuid2';

/**
 * Local SQLite (docs/schema.md C). Times are ISO 8601 UTC. Nothing is deleted from
 * local_sessions/local_files here: files are removed only after a confirmed upload (F5).
 */

const MIGRATIONS: string[] = [
  `
  create table meta (key text primary key, value text not null);
  create table config_cache (
    version integer primary key,
    config_id text,
    etag text,
    config text not null,
    -- assetId → path under dataDir/assets (JSON)
    asset_paths text not null,
    activated_at text not null
  );
  create table local_sessions (
    id text primary key,
    code text not null unique,
    booth_id text not null,
    config_version integer not null,
    frame_id text,
    filter_id text,
    payment_method text,
    amount integer not null default 0,
    extra_prints integer not null default 0,
    status text not null,
    download_url text,
    data text,
    started_at text not null,
    completed_at text,
    sync_status text not null default 'pending',
    created_at text not null,
    updated_at text not null
  );
  create table local_files (
    id text primary key,
    session_id text not null references local_sessions(id),
    kind text not null,
    slot_index integer,
    take_number integer,
    path text not null,
    mime_type text not null,
    width integer,
    height integer,
    bytes integer not null,
    sha256 text not null,
    source text,
    selected integer not null default 0,
    captured_at text,
    upload_status text not null default 'pending',
    created_at text not null
  );
  create index local_files_session on local_files(session_id);
  create table local_vouchers (
    code_hash text not null,
    booth_id text not null,
    used_at text,
    synced integer not null default 0,
    primary key (booth_id, code_hash)
  );
  create table outbox (
    id text primary key,
    kind text not null,
    payload text not null,
    created_at text not null,
    attempts integer not null default 0,
    next_attempt_at text not null,
    last_error text
  );
  create table camera_pairings (
    id text primary key,
    name text not null,
    platform text not null,
    token_hash text not null unique,
    created_at text not null,
    last_seen_at text,
    revoked_at text
  );
  create table print_jobs (
    id text primary key,
    session_id text,
    sheets integer not null,
    printer text not null,
    status text not null,
    file_path text not null,
    os_job_id text,
    error text,
    created_at text not null,
    updated_at text not null
  );
  `,
];

export type LocalSessionRow = {
  id: string;
  code: string;
  booth_id: string;
  config_version: number;
  frame_id: string | null;
  filter_id: string | null;
  payment_method: string | null;
  amount: number;
  extra_prints: number;
  status: 'capturing' | 'completed' | 'failed';
  download_url: string | null;
  data: string | null;
  started_at: string;
  completed_at: string | null;
  sync_status: string;
  created_at: string;
  updated_at: string;
};

export type LocalFileRow = {
  id: string;
  session_id: string;
  kind: 'original' | 'composite' | 'print';
  slot_index: number | null;
  take_number: number | null;
  path: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  bytes: number;
  sha256: string;
  source: string | null;
  selected: number;
  captured_at: string | null;
  upload_status: string;
  created_at: string;
};

export type OutboxRow = {
  id: string;
  kind: 'device_event' | 'print_job';
  payload: string;
  created_at: string;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
};

export type PrintJobRow = {
  id: string;
  session_id: string | null;
  sheets: number;
  printer: string;
  status: 'queued' | 'printing' | 'done' | 'failed';
  file_path: string;
  os_job_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type CameraPairingRow = {
  id: string;
  name: string;
  platform: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

export type DeviceEventInput = {
  level: 'info' | 'warn' | 'error';
  kind: string;
  message?: string;
  data?: unknown;
};

const now = () => new Date().toISOString();

export class AgentStore {
  readonly db: DatabaseSync;
  private closed = false;

  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'agent.sqlite'));
    this.db.exec(
      'pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;',
    );
    this.migrate();
  }

  private migrate() {
    const current = Number(
      (this.db.prepare('pragma user_version').get() as { user_version: number }).user_version,
    );
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.exec('begin');
      try {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`pragma user_version = ${v + 1}`);
        this.db.exec('commit');
      } catch (err) {
        this.db.exec('rollback');
        throw err;
      }
    }
  }

  close() {
    this.closed = true;
    this.db.close();
  }

  private all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  private get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  private run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params);
  }

  // --- meta / settings ---

  getMeta(key: string): string | null {
    return this.get<{ value: string }>('select value from meta where key = ?', key)?.value ?? null;
  }

  setMeta(key: string, value: string | null) {
    if (value === null) this.run('delete from meta where key = ?', key);
    else
      this.run(
        'insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value',
        key,
        value,
      );
  }

  // --- config cache ---

  saveConfig(entry: {
    version: number;
    configId: string | null;
    etag: string | null;
    config: unknown;
    assetPaths: Record<string, string>;
  }) {
    this.run(
      `insert into config_cache (version, config_id, etag, config, asset_paths, activated_at)
       values (?, ?, ?, ?, ?, ?)
       on conflict(version) do update set config_id = excluded.config_id, etag = excluded.etag,
         config = excluded.config, asset_paths = excluded.asset_paths, activated_at = excluded.activated_at`,
      entry.version,
      entry.configId,
      entry.etag,
      JSON.stringify(entry.config),
      JSON.stringify(entry.assetPaths),
      now(),
    );
  }

  /** Most recently activated config (offline start). */
  latestConfig(): {
    version: number;
    etag: string | null;
    config: unknown;
    assetPaths: Record<string, string>;
  } | null {
    const row = this.get<{
      version: number;
      etag: string | null;
      config: string;
      asset_paths: string;
    }>(
      'select version, etag, config, asset_paths from config_cache order by activated_at desc, version desc limit 1',
    );
    return row
      ? {
          version: row.version,
          etag: row.etag,
          config: JSON.parse(row.config),
          assetPaths: JSON.parse(row.asset_paths) as Record<string, string>,
        }
      : null;
  }

  clearConfigs() {
    this.run('delete from config_cache');
  }

  // --- sessions & files ---

  ensureSession(s: {
    id: string;
    code: string;
    boothId: string;
    configVersion: number;
    startedAt: string;
  }): LocalSessionRow {
    this.run(
      `insert into local_sessions (id, code, booth_id, config_version, status, started_at, created_at, updated_at)
       values (?, ?, ?, ?, 'capturing', ?, ?, ?) on conflict(id) do nothing`,
      s.id,
      s.code,
      s.boothId,
      s.configVersion,
      s.startedAt,
      now(),
      now(),
    );
    return this.session(s.id)!;
  }

  session(id: string): LocalSessionRow | undefined {
    return this.get<LocalSessionRow>('select * from local_sessions where id = ?', id);
  }

  sessions(limit = 50): LocalSessionRow[] {
    return this.all<LocalSessionRow>(
      'select * from local_sessions order by started_at desc limit ?',
      limit,
    );
  }

  completeSession(
    id: string,
    patch: {
      frameId: string | null;
      filterId: string | null;
      paymentMethod: string | null;
      amount: number;
      extraPrints: number;
      downloadUrl: string | null;
      data: unknown;
      status: 'completed' | 'failed';
    },
  ) {
    this.run(
      `update local_sessions set frame_id = ?, filter_id = ?, payment_method = ?, amount = ?,
         extra_prints = ?, download_url = ?, data = ?, status = ?, completed_at = ?, updated_at = ?
       where id = ?`,
      patch.frameId,
      patch.filterId,
      patch.paymentMethod,
      patch.amount,
      patch.extraPrints,
      patch.downloadUrl,
      JSON.stringify(patch.data),
      patch.status,
      now(),
      now(),
      id,
    );
  }

  addFile(
    f: Omit<LocalFileRow, 'id' | 'created_at' | 'upload_status' | 'selected'> & { id?: string },
  ) {
    const id = f.id ?? createId();
    this.run(
      `insert into local_files (id, session_id, kind, slot_index, take_number, path, mime_type, width, height,
         bytes, sha256, source, captured_at, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      f.session_id,
      f.kind,
      f.slot_index,
      f.take_number,
      f.path,
      f.mime_type,
      f.width,
      f.height,
      f.bytes,
      f.sha256,
      f.source,
      f.captured_at,
      now(),
    );
    return this.file(id)!;
  }

  file(id: string): LocalFileRow | undefined {
    return this.get<LocalFileRow>('select * from local_files where id = ?', id);
  }

  files(sessionId: string): LocalFileRow[] {
    return this.all<LocalFileRow>(
      'select * from local_files where session_id = ? order by created_at, slot_index, take_number',
      sessionId,
    );
  }

  shotFile(sessionId: string, slotIndex: number, takeNumber: number): LocalFileRow | undefined {
    return this.get<LocalFileRow>(
      `select * from local_files where session_id = ? and kind = 'original' and slot_index = ? and take_number = ?`,
      sessionId,
      slotIndex,
      takeNumber,
    );
  }

  markSelected(sessionId: string, fileIds: string[]) {
    this.run(
      `update local_files set selected = 0 where session_id = ? and kind = 'original'`,
      sessionId,
    );
    const stmt = this.db.prepare(
      'update local_files set selected = 1 where id = ? and session_id = ?',
    );
    for (const id of fileIds) stmt.run(id, sessionId);
  }

  // --- print jobs ---

  addPrintJob(j: { sessionId: string | null; sheets: number; printer: string; filePath: string }) {
    const id = createId();
    this.run(
      `insert into print_jobs (id, session_id, sheets, printer, status, file_path, created_at, updated_at)
       values (?, ?, ?, ?, 'queued', ?, ?, ?)`,
      id,
      j.sessionId,
      j.sheets,
      j.printer,
      j.filePath,
      now(),
      now(),
    );
    return this.printJob(id)!;
  }

  updatePrintJob(
    id: string,
    patch: { status: PrintJobRow['status']; osJobId?: string | null; error?: string | null },
  ) {
    this.run(
      'update print_jobs set status = ?, os_job_id = coalesce(?, os_job_id), error = ?, updated_at = ? where id = ?',
      patch.status,
      patch.osJobId ?? null,
      patch.error ?? null,
      now(),
      id,
    );
    return this.printJob(id)!;
  }

  printJob(id: string): PrintJobRow | undefined {
    return this.get<PrintJobRow>('select * from print_jobs where id = ?', id);
  }

  printJobs(limit = 20): PrintJobRow[] {
    return this.all<PrintJobRow>(
      'select * from print_jobs order by created_at desc limit ?',
      limit,
    );
  }

  /** Sheets successfully sent to a printer (paper/ribbon estimate). */
  printedSheets(): number {
    return (
      this.get<{ n: number | null }>(
        `select sum(sheets) as n from print_jobs where status = 'done'`,
      )?.n ?? 0
    );
  }

  // --- outbox ---

  enqueue(kind: OutboxRow['kind'], payload: unknown, id: string = createId()) {
    const ts = now();
    this.run(
      'insert into outbox (id, kind, payload, created_at, next_attempt_at) values (?, ?, ?, ?, ?) on conflict(id) do nothing',
      id,
      kind,
      JSON.stringify(payload),
      ts,
      ts,
    );
    return id;
  }

  /** Records a device_events row to send to the API (kept until the API confirms). */
  event(e: DeviceEventInput) {
    // Late callbacks (sockets closing during shutdown) after close(): nothing to record.
    if (this.closed) return null;
    return this.enqueue('device_event', {
      level: e.level,
      kind: e.kind,
      message: e.message ?? null,
      data: e.data ?? null,
      occurredAt: now(),
    });
  }

  dueOutbox(limit = 100): OutboxRow[] {
    return this.all<OutboxRow>(
      'select * from outbox where next_attempt_at <= ? order by created_at limit ?',
      now(),
      limit,
    );
  }

  outboxCount(): number {
    return this.get<{ n: number }>('select count(*) as n from outbox')!.n;
  }

  ackOutbox(ids: string[]) {
    const stmt = this.db.prepare('delete from outbox where id = ?');
    for (const id of ids) stmt.run(id);
  }

  failOutbox(ids: string[], error: string) {
    const rows = ids
      .map((id) => this.get<OutboxRow>('select * from outbox where id = ?', id))
      .filter(Boolean) as OutboxRow[];
    for (const row of rows) {
      const attempts = row.attempts + 1;
      // 10 s, 20 s, 40 s … capped at 10 minutes.
      const delay = Math.min(600_000, 10_000 * 2 ** Math.min(attempts - 1, 6));
      this.run(
        'update outbox set attempts = ?, next_attempt_at = ?, last_error = ? where id = ?',
        attempts,
        new Date(Date.now() + delay).toISOString(),
        error.slice(0, 500),
        row.id,
      );
    }
  }

  // --- camera pairings ---

  addCameraPairing(p: { name: string; platform: string; tokenHash: string }): CameraPairingRow {
    const id = createId();
    this.run(
      'insert into camera_pairings (id, name, platform, token_hash, created_at) values (?, ?, ?, ?, ?)',
      id,
      p.name,
      p.platform,
      p.tokenHash,
      now(),
    );
    return this.get<CameraPairingRow>('select * from camera_pairings where id = ?', id)!;
  }

  cameraByTokenHash(tokenHash: string): CameraPairingRow | undefined {
    return this.get<CameraPairingRow>(
      'select * from camera_pairings where token_hash = ? and revoked_at is null',
      tokenHash,
    );
  }

  cameraPairings(): CameraPairingRow[] {
    return this.all<CameraPairingRow>(
      'select * from camera_pairings where revoked_at is null order by created_at desc',
    );
  }

  touchCamera(id: string) {
    this.run('update camera_pairings set last_seen_at = ? where id = ?', now(), id);
  }

  revokeCamera(id: string) {
    this.run(
      'update camera_pairings set revoked_at = ? where id = ? and revoked_at is null',
      now(),
      id,
    );
  }
}
