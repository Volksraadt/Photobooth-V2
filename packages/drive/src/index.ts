/**
 * Google Drive over plain `fetch`. The only OAuth scope is `drive.file` (docs/decisions.md):
 * the app sees and edits only the files and folders it created itself, so no Google security
 * assessment for restricted scopes is needed.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export type GoogleEndpoints = {
  /** Consent screen. */
  authUrl: string;
  tokenUrl: string;
  /** Drive REST (`/drive/v3`). */
  apiBase: string;
  /** Drive upload (`/upload/drive/v3`). */
  uploadBase: string;
};

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  apiBase: 'https://www.googleapis.com/drive/v3',
  uploadBase: 'https://www.googleapis.com/upload/drive/v3',
};

/** Tests and local fakes: one base URL serving /auth, /token, /drive/v3 and /upload/drive/v3. */
export function endpointsFromBase(base: string): GoogleEndpoints {
  const b = base.replace(/\/$/, '');
  return {
    authUrl: `${b}/auth`,
    tokenUrl: `${b}/token`,
    apiBase: `${b}/drive/v3`,
    uploadBase: `${b}/upload/drive/v3`,
  };
}

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  endpoints?: GoogleEndpoints;
};

export function googleConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const apiUrl = (env.PB_PUBLIC_API_URL ?? `http://localhost:${env.API_PORT ?? 8787}`).replace(
    /\/$/,
    '',
  );
  return {
    clientId,
    clientSecret,
    redirectUri: env.GOOGLE_REDIRECT_URI ?? `${apiUrl}/oauth/google/callback`,
    endpoints: env.PB_GOOGLE_BASE_URL ? endpointsFromBase(env.PB_GOOGLE_BASE_URL) : undefined,
  };
}

export type DriveErrorKind =
  /** Access token or refresh token no longer valid: the owner revoked access. */
  | 'auth'
  /** Owner's Drive is full. */
  | 'quota'
  /** Folder/file gone or the app may not touch it any more. */
  | 'not_found'
  /** Rate limit, 5xx, network: retry with backoff. */
  | 'transient'
  | 'permanent';

export class DriveError extends Error {
  constructor(
    message: string,
    readonly kind: DriveErrorKind,
    readonly status = 0,
    readonly reason = '',
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

const QUOTA_REASONS = ['storageQuotaExceeded'];
const RATE_REASONS = [
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'dailyLimitExceeded',
  'quotaExceeded',
  'backendError',
];
const GONE_REASONS = ['notFound', 'appNotAuthorizedToFile', 'insufficientFilePermissions'];

async function errorFrom(res: Response, what: string): Promise<DriveError> {
  const text = await res.text().catch(() => '');
  let reason = '';
  let message = '';
  try {
    const j = JSON.parse(text) as {
      error?: { message?: string; errors?: { reason?: string }[] } | string;
      error_description?: string;
    };
    if (typeof j.error === 'string') {
      reason = j.error;
      message = j.error_description ?? j.error;
    } else {
      reason = j.error?.errors?.[0]?.reason ?? '';
      message = j.error?.message ?? '';
    }
  } catch {
    message = text.slice(0, 200);
  }
  const msg = `${what}: HTTP ${res.status}${message ? ` ${message}` : ''}`;
  if (res.status === 401) return new DriveError(msg, 'auth', 401, reason);
  if (res.status === 404 || GONE_REASONS.includes(reason))
    return new DriveError(msg, 'not_found', res.status, reason);
  if (QUOTA_REASONS.includes(reason)) return new DriveError(msg, 'quota', res.status, reason);
  if (res.status === 429 || res.status >= 500 || RATE_REASONS.includes(reason))
    return new DriveError(msg, 'transient', res.status, reason);
  return new DriveError(msg, 'permanent', res.status, reason);
}

async function send(what: string, url: string, init: RequestInit & { timeoutMs?: number }) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 60_000) });
  } catch (err) {
    throw new DriveError(
      `${what}: ${err instanceof Error ? err.message : String(err)}`,
      'transient',
    );
  }
}

export class GoogleOAuth {
  readonly endpoints: GoogleEndpoints;

  get redirectUri(): string {
    return this.cfg.redirectUri;
  }

  constructor(private readonly cfg: GoogleOAuthConfig) {
    this.endpoints = cfg.endpoints ?? GOOGLE_ENDPOINTS;
  }

  /** `access_type=offline` + `prompt=consent` so Google always returns a refresh token. */
  authUrl(state: string): string {
    const u = new URL(this.endpoints.authUrl);
    u.searchParams.set('client_id', this.cfg.clientId);
    u.searchParams.set('redirect_uri', this.cfg.redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', DRIVE_SCOPE);
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
    u.searchParams.set('include_granted_scopes', 'false');
    u.searchParams.set('state', state);
    return u.toString();
  }

  private async token(body: Record<string, string>, what: string) {
    const res = await send(what, this.endpoints.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        ...body,
      }),
      timeoutMs: 20_000,
    });
    if (!res.ok) {
      const err = await errorFrom(res, what);
      // invalid_grant = refresh token revoked/expired; other 4xx = bad client config.
      if (err.reason === 'invalid_grant' || err.reason === 'invalid_token')
        throw new DriveError(err.message, 'auth', res.status, 'invalid_grant');
      if (err.kind === 'not_found' || err.kind === 'permanent')
        throw new DriveError(err.message, 'permanent', res.status, err.reason);
      throw err;
    }
    return (await res.json()) as {
      access_token: string;
      expires_in?: number;
      refresh_token?: string;
      scope?: string;
    };
  }

  async exchangeCode(code: string) {
    const t = await this.token(
      { grant_type: 'authorization_code', code, redirect_uri: this.cfg.redirectUri },
      'Google token exchange',
    );
    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null,
      scope: t.scope ?? '',
      expiresInSec: t.expires_in ?? 3600,
    };
  }

  async refresh(refreshToken: string) {
    const t = await this.token(
      { grant_type: 'refresh_token', refresh_token: refreshToken },
      'Google token refresh',
    );
    return { accessToken: t.access_token, expiresInSec: t.expires_in ?? 3600 };
  }
}

export type DriveFolder = { id: string; name: string };

/** `'` and `\` must be escaped inside a Drive query string. */
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class DriveClient {
  private readonly ep: GoogleEndpoints;

  /** `accessToken(forceRefresh)` supplies a valid bearer token. */
  constructor(
    private readonly accessToken: (forceRefresh: boolean) => Promise<string>,
    endpoints: GoogleEndpoints = GOOGLE_ENDPOINTS,
  ) {
    this.ep = endpoints;
  }

  /** One retry with a fresh access token when Google answers 401. */
  private async call(what: string, url: string, init: RequestInit & { timeoutMs?: number } = {}) {
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken(attempt > 0);
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${token}`);
      const res = await send(what, url, { ...init, headers });
      if (res.status === 401 && attempt === 0) {
        await res.arrayBuffer().catch(() => undefined);
        continue;
      }
      if (!res.ok) throw await errorFrom(res, what);
      return res;
    }
  }

  private json(what: string, url: string, init: RequestInit & { timeoutMs?: number } = {}) {
    return this.call(what, url, init).then((r) => r.json() as Promise<Record<string, unknown>>);
  }

  async accountEmail(): Promise<string> {
    const j = (await this.json(
      'Drive about',
      `${this.ep.apiBase}/about?fields=user(emailAddress)`,
    )) as {
      user?: { emailAddress?: string };
    };
    return j.user?.emailAddress ?? '';
  }

  /**
   * Top-level folders (directly in My Drive) this app created; drive.file never lists anything
   * else. Only these are sensible root folders: booth, date and session folders live below them.
   */
  async listAppFolders(): Promise<DriveFolder[]> {
    const params = new URLSearchParams({
      q: `mimeType='${FOLDER_MIME}' and trashed=false and 'root' in parents`,
      fields: 'files(id,name)',
      orderBy: 'name',
      pageSize: '100',
    });
    const j = (await this.json('Drive list folders', `${this.ep.apiBase}/files?${params}`)) as {
      files?: DriveFolder[];
    };
    return j.files ?? [];
  }

  /** The folder if it exists and is not in the trash. */
  async getFolder(id: string): Promise<DriveFolder | null> {
    try {
      const j = (await this.json(
        'Drive get folder',
        `${this.ep.apiBase}/files/${encodeURIComponent(id)}?fields=id,name,trashed,mimeType`,
      )) as { id: string; name: string; trashed?: boolean; mimeType?: string };
      if (j.trashed || j.mimeType !== FOLDER_MIME) return null;
      return { id: j.id, name: j.name };
    } catch (err) {
      if (err instanceof DriveError && err.kind === 'not_found') return null;
      throw err;
    }
  }

  async findChild(name: string, parentId: string | null, folder: boolean) {
    const parts = [`name='${q(name)}'`, 'trashed=false'];
    if (parentId) parts.push(`'${q(parentId)}' in parents`);
    if (folder) parts.push(`mimeType='${FOLDER_MIME}'`);
    else parts.push(`mimeType!='${FOLDER_MIME}'`);
    const params = new URLSearchParams({
      q: parts.join(' and '),
      fields: 'files(id,name,size)',
      pageSize: '1',
    });
    const j = (await this.json('Drive find', `${this.ep.apiBase}/files?${params}`)) as {
      files?: { id: string; name: string; size?: string }[];
    };
    return j.files?.[0] ?? null;
  }

  async createFolder(name: string, parentId: string | null): Promise<DriveFolder> {
    const j = (await this.json('Drive create folder', `${this.ep.apiBase}/files?fields=id,name`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    })) as DriveFolder;
    return { id: j.id, name: j.name };
  }

  /** Find-or-create (retries after a crash must not make a second folder). */
  async ensureFolder(name: string, parentId: string | null): Promise<DriveFolder> {
    const found = await this.findChild(name, parentId, true);
    return found ? { id: found.id, name: found.name } : this.createFolder(name, parentId);
  }

  /**
   * Resumable upload, one PUT. A file with the same name already in the folder is returned
   * instead (a retry after the response was lost must not duplicate).
   */
  async uploadFile(f: {
    name: string;
    parentId: string;
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<{ id: string; reused: boolean }> {
    const existing = await this.findChild(f.name, f.parentId, false);
    if (existing && Number(existing.size ?? -1) === f.bytes.byteLength)
      return { id: existing.id, reused: true };
    const start = await this.call(
      'Drive upload start',
      `${this.ep.uploadBase}/files?uploadType=resumable&fields=id`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-type': f.mimeType,
          'x-upload-content-length': String(f.bytes.byteLength),
        },
        body: JSON.stringify({ name: f.name, parents: [f.parentId] }),
      },
    );
    const location = start.headers.get('location');
    await start.arrayBuffer().catch(() => undefined);
    if (!location) throw new DriveError('Drive upload start: no session URL', 'permanent');
    const done = await this.call('Drive upload', location, {
      method: 'PUT',
      headers: { 'content-type': f.mimeType, 'content-length': String(f.bytes.byteLength) },
      // A copy typed Uint8Array<ArrayBuffer>, which every fetch typing (DOM or Node) accepts.
      body: new Uint8Array(f.bytes),
      timeoutMs: 5 * 60_000,
    });
    const j = (await done.json()) as { id: string };
    return { id: j.id, reused: false };
  }

  /** "Anyone with the link can view" (not listed in search). */
  async shareAnyoneReader(fileId: string): Promise<void> {
    await this.call(
      'Drive share',
      `${this.ep.apiBase}/files/${encodeURIComponent(fileId)}/permissions?fields=id`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone', allowFileDiscovery: false }),
      },
    ).then((r) => r.arrayBuffer());
  }
}

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

/** AAD for the encrypted refresh token (`@pb/crypto` SecretBox): bound to the org. */
export const driveAad = (orgId: string) => `org:${orgId}:drive`;

/**
 * Access tokens live ~1 h; refreshing once per job would waste calls (and Google rate limits
 * token refreshes). One cache per process, keyed by org.
 */
export class AccessTokenCache {
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  /** A `DriveClient` token supplier for one org. `loadRefreshToken` decrypts the stored token. */
  supplier(
    orgId: string,
    oauth: GoogleOAuth,
    loadRefreshToken: () => Promise<string>,
  ): (forceRefresh: boolean) => Promise<string> {
    return async (force) => {
      const hit = this.tokens.get(orgId);
      if (!force && hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
      const refreshed = await oauth.refresh(await loadRefreshToken());
      this.tokens.set(orgId, {
        token: refreshed.accessToken,
        expiresAt: Date.now() + refreshed.expiresInSec * 1000,
      });
      return refreshed.accessToken;
    };
  }

  forget(orgId: string) {
    this.tokens.delete(orgId);
  }
}
