import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createId } from '@paralleldrive/cuid2';
import type { AgentToKiosk, KioskToAgent } from '@pb/capture/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import { AssetStore } from './assets';
import { CameraHub } from './camera-hub';
import { ConfigSync } from './config-sync';
import type { DeviceEntitlements, HeartbeatBody } from './device-api';
import { createLanApi } from './lan-api';
import { createLocalApi } from './local-api';
import { AGENT_VERSION, type AgentOptions } from './options';
import { PrintService } from './print/print-service';
import { MoneyService } from './money';
import { Processor } from './processing';
import { SessionFiles } from './sessions';
import { AgentStore } from './store';
import { Telemetry } from './telemetry';
import { UploadQueue } from './uploads';

type KioskReport = { cameraSource: string; cameraStatus: string; configVersion: number | null };

/** Composition root of the local agent. */
export class Agent {
  readonly store: AgentStore;
  readonly assets: AssetStore;
  readonly files: SessionFiles;
  readonly config: ConfigSync;
  readonly camera: CameraHub;
  readonly printer: PrintService;
  readonly processor: Processor;
  readonly telemetry: Telemetry;
  readonly money: MoneyService;
  uploads!: UploadQueue;
  readonly id: string;
  private servers: Server[] = [];
  private wss: WebSocketServer[] = [];
  private kiosk: KioskReport | null = null;
  localPort = 0;
  lanPort = 0;

  constructor(readonly options: AgentOptions) {
    this.store = new AgentStore(options.dataDir);
    this.id = this.store.getMeta('agent.id') ?? createId();
    this.store.setMeta('agent.id', this.id);
    const event = (
      kind: string,
      message: string,
      level: 'info' | 'warn' | 'error' = 'info',
      data?: unknown,
    ) => {
      this.store.event({ kind, message, level, data });
    };
    this.assets = new AssetStore(options.dataDir);
    this.files = new SessionFiles(this.store);
    this.config = new ConfigSync(
      this.store,
      this.assets,
      options.apiBase,
      options.configPollMs,
      event,
    );
    this.camera = new CameraHub(this.store, this.files, this.id, event);
    this.printer = new PrintService(this.store, options.printMode, event);
    this.processor = new Processor(
      this.store,
      this.files,
      this.assets,
      this.printer,
      (sessionId, step, progress) => {
        this.broadcast({ type: 'processing', sessionId, step, progress });
        // Strip + session record are on disk/outbox: upload in the background right away.
        if (step === 'done') void this.uploads?.kick();
      },
    );
    this.telemetry = new Telemetry(this.store, this.config.api, () => this.heartbeatBody());
    this.money = new MoneyService(
      this.store,
      this.config,
      this.telemetry,
      (msg) => this.broadcast(msg),
      event,
    );
    this.uploads = new UploadQueue(
      this.store,
      this.files,
      this.config.api,
      this.telemetry,
      {
        retentionDays: options.localRetentionDays ?? 0,
        intervalMs: options.uploadMs ?? 15_000,
      },
      event,
    );
    this.telemetry.subscribe((online) => {
      this.broadcast({ type: 'network', online });
      // Back online: files that waited offline go out now, without waiting for the backoff.
      if (online) this.uploads?.resetBackoff();
    });

    this.config.subscribe((s) => {
      this.broadcast({ type: 'config', version: s.status === 'ready' ? s.version : null });
      void this.telemetry.beat();
    });
    this.printer.subscribe((status) => this.broadcast({ type: 'printer', status }));
    this.camera.subscribe(() => void this.telemetry.beat());
  }

  private broadcast(msg: AgentToKiosk) {
    this.camera.broadcastKiosk(msg);
  }

  heartbeatBody(): HeartbeatBody {
    const cs = this.config.current;
    const tabletSelected = this.settings().cameraSource === 'tablet';
    let cameraStatus: HeartbeatBody['cameraStatus'] = 'unknown';
    if (tabletSelected) {
      const t = this.camera.state();
      cameraStatus =
        t.status === 'connected' ? 'ok' : t.status === 'disconnected' ? 'disconnected' : 'unknown';
    } else if (this.kiosk) {
      cameraStatus =
        this.kiosk.cameraStatus === 'connected'
          ? 'ok'
          : this.kiosk.cameraStatus === 'error'
            ? 'error'
            : 'unknown';
    }
    return {
      configVersion: this.kiosk?.configVersion ?? (cs.status === 'ready' ? cs.version : null),
      appVersion: `agent ${AGENT_VERSION}`,
      platform: `${process.platform}-${process.arch}`,
      cameraStatus,
      printerStatus: this.printer.status.status,
      // Only business data counts as "unsynced" (sessions, voucher use, cash), not log events.
      outboxPending: (() => {
        const k = this.store.pendingOutboxByKind();
        return (k.session ?? 0) + (k.voucher_use ?? 0) + (k.cash_approval ?? 0);
      })(),
      uploadsPending: this.store.uploadSummary().pending,
    };
  }

  /** Last plan flags from the API (kept for offline starts); null before the first heartbeat. */
  entitlements(): DeviceEntitlements | null {
    const raw = this.store.getMeta('entitlements');
    try {
      return raw ? (JSON.parse(raw) as DeviceEntitlements) : null;
    } catch {
      return null;
    }
  }

  settings() {
    return {
      cameraSource: (this.store.getMeta('camera.source') ?? 'webcam') as 'webcam' | 'tablet',
    };
  }

  status() {
    const cs = this.config.current;
    return {
      agentId: this.id,
      version: AGENT_VERSION,
      paired: this.config.paired,
      config: { status: cs.status, version: cs.status === 'ready' ? cs.version : null },
      online: this.telemetry.isOnline,
      camera: this.camera.state(),
      printer: this.printer.status,
      outboxPending: this.store.outboxCount(),
      outboxByKind: this.store.pendingOutboxByKind(),
      uploads: this.store.uploadSummary(),
      entitlements: this.entitlements(),
      vouchers: (() => {
        const boothId = cs.status === 'ready' ? cs.config.boothId : null;
        return boothId ? this.store.voucherCount(boothId) : 0;
      })(),
      printedSheets: this.store.printedSheets(),
      settings: this.settings(),
      lanPort: this.lanPort,
    };
  }

  async start(): Promise<void> {
    const local = await this.listen(
      createLocalApi(this).fetch,
      '127.0.0.1',
      this.options.localPort,
    );
    this.localPort = (local.address() as AddressInfo).port;
    const lan = await this.listen(
      createLanApi(this).fetch,
      this.options.lanHost,
      this.options.lanPort,
    );
    this.lanPort = (lan.address() as AddressInfo).port;

    const kioskWss = new WebSocketServer({ noServer: true });
    const cameraWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    this.wss.push(kioskWss, cameraWss);
    const allowed = new Set(this.options.allowedOrigins);
    local.on('upgrade', (req: IncomingMessage, socket, head) => {
      const origin = req.headers.origin;
      const host = (req.headers.host ?? '').toLowerCase();
      const okHost = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
      if (!req.url?.startsWith('/ws') || !okHost || (origin && !allowed.has(origin))) {
        socket.destroy();
        return;
      }
      kioskWss.handleUpgrade(req, socket, head, (ws) => this.onKioskSocket(ws));
    });
    lan.on('upgrade', (req: IncomingMessage, socket, head) => {
      if (!req.url?.startsWith('/camera/ws')) {
        socket.destroy();
        return;
      }
      cameraWss.handleUpgrade(req, socket, head, (ws) => this.camera.attachCamera(ws));
    });

    this.printer.start();
    await this.config.start();
    if (this.options.telemetry) {
      this.telemetry.start(this.options.heartbeatMs, this.options.outboxFlushMs);
      this.money.start();
      this.uploads.start();
    }
    this.store.event({
      level: 'info',
      kind: 'agent_started',
      message: `Agent ${AGENT_VERSION} berjalan`,
    });
  }

  private onKioskSocket(ws: WebSocket) {
    this.camera.attachKiosk(ws);
    const cs = this.config.current;
    ws.send(
      JSON.stringify({
        type: 'config',
        version: cs.status === 'ready' ? cs.version : null,
      } satisfies AgentToKiosk),
    );
    ws.send(
      JSON.stringify({ type: 'printer', status: this.printer.status } satisfies AgentToKiosk),
    );
    if (this.telemetry.isOnline !== null) {
      ws.send(
        JSON.stringify({ type: 'network', online: this.telemetry.isOnline } satisfies AgentToKiosk),
      );
    }
    const alive = setInterval(() => ws.readyState === ws.OPEN && ws.ping(), 15_000);
    ws.on('close', () => clearInterval(alive));
    ws.on('message', (raw) => {
      let msg: KioskToAgent;
      try {
        msg = JSON.parse(String(raw)) as KioskToAgent;
      } catch {
        return;
      }
      if (msg.type === 'signal') this.camera.relayFromKiosk(msg.peerId, msg.data);
      else if (msg.type === 'peer-closed') this.camera.peerClosed(msg.peerId);
      else if (msg.type === 'kiosk-status') {
        const prev = this.kiosk;
        this.kiosk = {
          cameraSource: msg.cameraSource,
          cameraStatus: msg.cameraStatus,
          configVersion: msg.configVersion,
        };
        if (
          !prev ||
          prev.cameraStatus !== msg.cameraStatus ||
          prev.configVersion !== msg.configVersion
        ) {
          void this.telemetry.beat();
        }
      }
    });
  }

  private listen(
    fetch: (req: Request) => Response | Promise<Response>,
    hostname: string,
    port: number,
  ): Promise<Server> {
    return new Promise((resolve, reject) => {
      const server = serve({ fetch, hostname, port }, () => resolve(server as Server)) as Server;
      server.once('error', reject);
      this.servers.push(server);
    });
  }

  async stop(): Promise<void> {
    this.config.stop();
    this.telemetry.stop();
    this.money.stop();
    await this.uploads.stop();
    this.printer.stop();
    this.camera.stop();
    for (const w of this.wss) {
      for (const c of w.clients) c.terminate();
      w.close();
    }
    await Promise.all(
      this.servers.map(
        (s) =>
          new Promise<void>((r) => {
            s.closeAllConnections?.();
            s.close(() => r());
          }),
      ),
    );
    this.store.close();
  }
}
