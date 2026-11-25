import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createId } from '@paralleldrive/cuid2';
import { FOLDER_MIME } from './index';

type FakeFile = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  bytes: Buffer | null;
  permissions: { role: string; type: string; allowFileDiscovery?: boolean }[];
};

/**
 * In-memory stand-in for the Google OAuth + Drive endpoints we use. For tests and for trying the
 * whole pipeline locally without a Google Cloud project (`PB_GOOGLE_BASE_URL=http://localhost:9099`).
 * It enforces the drive.file rule loosely: only files created through it exist.
 */
export class FakeGoogle {
  readonly files = new Map<string, FakeFile>();
  readonly email = 'owner@example.test';
  /** After revokeAccess() every refresh fails with invalid_grant and API calls answer 401. */
  revoked = false;
  /** Make the next N upload PUTs answer 503 (retry tests). */
  failUploads = 0;
  /** Answer storageQuotaExceeded on uploads. */
  quotaFull = false;
  requests: string[] = [];
  private server: Server | null = null;
  private tokens = new Set<string>();
  private uploads = new Map<string, { name: string; parents: string[]; mimeType: string }>();
  baseUrl = '';

  revokeAccess() {
    this.revoked = true;
    this.tokens.clear();
  }

  async start(port = 0): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(port, '127.0.0.1', r));
    const addr = this.server.address();
    const p = typeof addr === 'object' && addr ? addr.port : port;
    this.baseUrl = `http://127.0.0.1:${p}`;
    return this.baseUrl;
  }

  async stop() {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  /** `path/like/this` → file, for assertions. Paths start below the root `name`. */
  find(path: string[]): FakeFile | undefined {
    let parent: string | null = null;
    let cur: FakeFile | undefined;
    for (const name of path) {
      cur = [...this.files.values()].find(
        (f) =>
          f.name === name && !f.trashed && (parent === null ? true : f.parents.includes(parent)),
      );
      if (!cur) return undefined;
      parent = cur.id;
    }
    return cur;
  }

  children(id: string): FakeFile[] {
    return [...this.files.values()].filter((f) => f.parents.includes(id) && !f.trashed);
  }

  private async body(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  private send(
    res: ServerResponse,
    status: number,
    data: unknown,
    headers: Record<string, string> = {},
  ) {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(data === undefined ? '' : JSON.stringify(data));
  }

  private err(res: ServerResponse, status: number, reason: string, message = reason) {
    this.send(res, status, { error: { code: status, message, errors: [{ reason }] } });
  }

  private authed(req: IncomingMessage): boolean {
    const t = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    return !!t && this.tokens.has(t) && !this.revoked;
  }

  private newToken() {
    const t = `at-${createId()}`;
    this.tokens.add(t);
    return t;
  }

  private match(f: FakeFile, qs: string): boolean {
    if (f.trashed && /trashed=false/.test(qs)) return false;
    const name = /name='((?:[^'\\]|\\.)*)'/.exec(qs)?.[1]?.replace(/\\(.)/g, '$1');
    if (name !== undefined && f.name !== name) return false;
    const parent = /'((?:[^'\\]|\\.)*)' in parents/.exec(qs)?.[1];
    // 'root' is My Drive: files created without a parent live there.
    const inParent =
      parent === 'root'
        ? f.parents.length === 0 || f.parents.includes('root')
        : f.parents.includes(parent ?? '');
    if (parent && !inParent) return false;
    if (new RegExp(`mimeType='${FOLDER_MIME}'`).test(qs) && f.mimeType !== FOLDER_MIME)
      return false;
    if (new RegExp(`mimeType!='${FOLDER_MIME}'`).test(qs) && f.mimeType === FOLDER_MIME)
      return false;
    return true;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', this.baseUrl);
    const path = url.pathname;
    this.requests.push(`${req.method} ${path}`);
    try {
      // Test hooks (e2e and manual runs): flip the fake into a failure mode from outside.
      if (path === '/__revoke' && req.method === 'POST') {
        this.revokeAccess();
        return this.send(res, 200, { ok: true });
      }
      if (path === '/auth') {
        // Consent screen: approve at once and send the browser back with a code.
        const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
        redirect.searchParams.set('code', 'fake-code');
        redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
        res.writeHead(302, { location: redirect.toString() });
        return res.end();
      }
      if (path === '/token' && req.method === 'POST') {
        const form = new URLSearchParams((await this.body(req)).toString());
        if (form.get('grant_type') === 'authorization_code') {
          this.revoked = false;
          return this.send(res, 200, {
            access_token: this.newToken(),
            refresh_token: 'fake-refresh-token',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/drive.file',
          });
        }
        if (this.revoked || form.get('refresh_token') !== 'fake-refresh-token') {
          return this.send(res, 400, {
            error: 'invalid_grant',
            error_description: 'Token has been expired or revoked.',
          });
        }
        return this.send(res, 200, { access_token: this.newToken(), expires_in: 3600 });
      }
      if (!this.authed(req)) return this.err(res, 401, 'authError', 'Invalid Credentials');

      if (path === '/drive/v3/about')
        return this.send(res, 200, { user: { emailAddress: this.email } });

      if (path === '/drive/v3/files' && req.method === 'GET') {
        const qs = url.searchParams.get('q') ?? '';
        const files = [...this.files.values()]
          .filter((f) => this.match(f, qs))
          .map((f) => ({
            id: f.id,
            name: f.name,
            size: f.bytes ? String(f.bytes.length) : undefined,
          }));
        return this.send(res, 200, { files });
      }
      if (path === '/drive/v3/files' && req.method === 'POST') {
        const b = JSON.parse((await this.body(req)).toString()) as {
          name: string;
          mimeType?: string;
          parents?: string[];
        };
        const f: FakeFile = {
          id: createId(),
          name: b.name,
          mimeType: b.mimeType ?? 'application/octet-stream',
          parents: b.parents ?? [],
          trashed: false,
          bytes: null,
          permissions: [],
        };
        this.files.set(f.id, f);
        return this.send(res, 200, { id: f.id, name: f.name });
      }
      const one = /^\/drive\/v3\/files\/([^/]+)(\/permissions)?$/.exec(path);
      if (one) {
        const f = this.files.get(decodeURIComponent(one[1]!));
        if (!f) return this.err(res, 404, 'notFound', 'File not found');
        if (one[2] && req.method === 'POST') {
          f.permissions.push(JSON.parse((await this.body(req)).toString()));
          return this.send(res, 200, { id: createId() });
        }
        if (req.method === 'GET')
          return this.send(res, 200, {
            id: f.id,
            name: f.name,
            trashed: f.trashed,
            mimeType: f.mimeType,
          });
      }
      if (path === '/upload/drive/v3/files' && req.method === 'POST') {
        const b = JSON.parse((await this.body(req)).toString()) as {
          name: string;
          parents?: string[];
        };
        const id = createId();
        this.uploads.set(id, {
          name: b.name,
          parents: b.parents ?? [],
          mimeType: String(req.headers['x-upload-content-type'] ?? 'application/octet-stream'),
        });
        res.writeHead(200, { location: `${this.baseUrl}/upload/session/${id}` });
        return res.end();
      }
      const up = /^\/upload\/session\/(.+)$/.exec(path);
      if (up && req.method === 'PUT') {
        const meta = this.uploads.get(up[1]!);
        const bytes = await this.body(req);
        if (!meta) return this.err(res, 404, 'notFound');
        if (this.quotaFull)
          return this.err(
            res,
            403,
            'storageQuotaExceeded',
            'The user storage quota has been exceeded.',
          );
        if (this.failUploads > 0) {
          this.failUploads--;
          return this.err(res, 503, 'backendError', 'Service unavailable');
        }
        const f: FakeFile = {
          id: createId(),
          name: meta.name,
          mimeType: meta.mimeType,
          parents: meta.parents,
          trashed: false,
          bytes,
          permissions: [],
        };
        this.files.set(f.id, f);
        this.uploads.delete(up[1]!);
        return this.send(res, 200, { id: f.id });
      }
      this.err(res, 404, 'notFound', `no route ${req.method} ${path}`);
    } catch (e) {
      this.err(res, 500, 'backendError', e instanceof Error ? e.message : String(e));
    }
  }
}
