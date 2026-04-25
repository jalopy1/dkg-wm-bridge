/**
 * Lightweight HTTP client for the DKG v10 daemon API.
 * Zero dependencies — uses Node 18+ native fetch.
 * Focused on Working Memory and Shared Memory operations.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface Quad {
  subject: string;
  predicate: string;
  object: string;
  graph?: string;
}

export interface ClientOptions {
  baseUrl?: string;
  authToken?: string;
  timeoutMs?: number;
}

export class DkgClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(opts?: ClientOptions) {
    this.baseUrl = (opts?.baseUrl ?? process.env.DKG_API_URL ?? 'http://127.0.0.1:9200').replace(/\/+$/, '');
    this.token = opts?.authToken ?? process.env.DKG_AUTH_TOKEN ?? DkgClient.loadToken();
    this.timeoutMs = opts?.timeoutMs ?? 30_000;
  }

  private static loadToken(): string {
    try {
      const raw = readFileSync(join(homedir(), '.dkg', 'auth.token'), 'utf-8');
      // Skip comment lines (# ...) and blank lines, take the first real token line
      const token = raw.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#'));
      if (!token) throw new Error('auth.token file is empty or contains only comments');
      return token;
    } catch (err) {
      if (err instanceof Error && err.message.includes('auth.token')) throw err;
      throw new Error('No DKG auth token found. Set DKG_AUTH_TOKEN or ensure ~/.dkg/auth.token exists.');
    }
  }

  private headers(json = true): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers(false),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json() as Promise<T>;
  }

  // -- Status -----------------------------------------------------------------

  async status(): Promise<{ ok: boolean; peerId?: string; error?: string }> {
    try {
      const data = await this.get<Record<string, unknown>>('/api/status');
      return { ok: true, peerId: data.peerId as string | undefined };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async getWallets(): Promise<{ wallets: string[]; chainId: string }> {
    return this.get('/api/wallets');
  }

  /** Get the primary wallet address (first wallet = operational). */
  async getAgentAddress(): Promise<string> {
    const { wallets } = await this.getWallets();
    if (!wallets?.length) throw new Error('No wallets configured on the DKG node');
    return wallets[0];
  }

  // -- Context Graphs ---------------------------------------------------------

  async listContextGraphs(): Promise<{ contextGraphs: any[] }> {
    return this.get('/api/context-graph/list');
  }

  async createContextGraph(id: string, name: string, description?: string): Promise<{ created: string; uri: string }> {
    return this.post('/api/context-graph/create', { id, name, description });
  }

  // -- Working Memory: Assertions ---------------------------------------------

  async createAssertion(
    contextGraphId: string,
    name: string,
  ): Promise<{ assertionUri: string | null; alreadyExists: boolean }> {
    try {
      const res = await this.post<{ assertionUri: string }>('/api/assertion/create', { contextGraphId, name });
      return { assertionUri: res.assertionUri, alreadyExists: false };
    } catch (err) {
      if (err instanceof Error && err.message.includes('already exists')) {
        return { assertionUri: null, alreadyExists: true };
      }
      throw err;
    }
  }

  async writeAssertion(
    contextGraphId: string,
    name: string,
    quads: Quad[],
  ): Promise<{ written: number }> {
    return this.post(`/api/assertion/${encodeURIComponent(name)}/write`, { contextGraphId, quads });
  }

  async queryAssertion(
    contextGraphId: string,
    name: string,
  ): Promise<{ quads: unknown[]; count: number }> {
    return this.post(`/api/assertion/${encodeURIComponent(name)}/query`, { contextGraphId });
  }

  async promoteAssertion(
    contextGraphId: string,
    name: string,
    entities?: string[],
  ): Promise<Record<string, unknown>> {
    return this.post(`/api/assertion/${encodeURIComponent(name)}/promote`, {
      contextGraphId,
      entities: entities ?? 'all',
    });
  }

  async discardAssertion(
    contextGraphId: string,
    name: string,
  ): Promise<{ discarded: boolean }> {
    return this.post(`/api/assertion/${encodeURIComponent(name)}/discard`, { contextGraphId });
  }

  async getAssertionHistory(
    contextGraphId: string,
    name: string,
  ): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ contextGraphId });
    return this.get(`/api/assertion/${encodeURIComponent(name)}/history?${params}`);
  }

  // -- Working Memory: File Import --------------------------------------------

  async importFile(
    contextGraphId: string,
    name: string,
    fileBuffer: Buffer,
    fileName: string,
    contentType?: string,
  ): Promise<Record<string, unknown>> {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: contentType ?? 'application/octet-stream' });
    form.append('file', blob, fileName);
    form.append('contextGraphId', contextGraphId);
    if (contentType) form.append('contentType', contentType);

    const res = await fetch(`${this.baseUrl}/api/assertion/${encodeURIComponent(name)}/import-file`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${this.token}` },
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`import-file ${name} → ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json() as Promise<Record<string, unknown>>;
  }

  // -- Shared Memory ----------------------------------------------------------

  async writeSharedMemory(
    contextGraphId: string,
    quads: Quad[],
  ): Promise<{ shareOperationId: string }> {
    return this.post('/api/shared-memory/write', { contextGraphId, quads, localOnly: true });
  }

  async publishSharedMemory(
    contextGraphId: string,
    opts?: { rootEntities?: string[]; clearAfter?: boolean },
  ): Promise<Record<string, unknown>> {
    const hasSubset = Array.isArray(opts?.rootEntities) && opts!.rootEntities!.length > 0;
    return this.post('/api/shared-memory/publish', {
      contextGraphId,
      selection: opts?.rootEntities ?? 'all',
      clearAfter: opts?.clearAfter ?? !hasSubset,
    });
  }

  // -- SPARQL Query -----------------------------------------------------------

  async query(
    sparql: string,
    opts?: {
      contextGraphId?: string;
      view?: 'working-memory' | 'shared-working-memory' | 'verified-memory';
      agentAddress?: string;
      assertionName?: string;
    },
  ): Promise<any> {
    return this.post('/api/query', { sparql, ...opts });
  }
}
