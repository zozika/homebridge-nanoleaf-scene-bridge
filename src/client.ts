/**
 * Minimal client for the Nanoleaf local OpenAPI (http://<host>:16021/api/v1).
 * Uses the global fetch of Node 20+, so the plugin has no runtime dependencies.
 */

export const DEFAULT_PORT = 16021;

/** Server-sent event ids of the OpenAPI. */
export const EVENT_STATE = 1;
export const EVENT_EFFECTS = 3;

export interface NanoleafInfo {
  name: string;
  serialNo: string;
  manufacturer: string;
  firmwareVersion: string;
  model: string;
  state: {
    on: { value: boolean };
  };
  effects: {
    select: string;
    effectsList: string[];
  };
}

export interface NanoleafEvent {
  attr: number;
  value: unknown;
}

export class NanoleafHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'NanoleafHttpError';
  }
}

export function apiBaseUrl(host: string, port: number): string {
  const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${hostPart}:${port}/api/v1`;
}

/**
 * Requests a new auth token. Only succeeds while the device is in pairing mode
 * (power button held for 5-7 seconds); otherwise the device answers 403.
 */
export async function requestToken(host: string, port = DEFAULT_PORT, timeoutMs = 5000): Promise<string> {
  const res = await fetch(`${apiBaseUrl(host, port)}/new`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const message = res.status === 403 ? 'Device is not in pairing mode' : `Pairing failed with HTTP ${res.status}`;
    throw new NanoleafHttpError(message, res.status);
  }
  const body = (await res.json()) as { auth_token?: string };
  if (!body.auth_token) {
    throw new Error('Pairing response did not contain an auth_token');
  }
  return body.auth_token;
}

export class NanoleafClient {
  private readonly url: string;

  constructor(
    readonly host: string,
    readonly port: number,
    token: string,
    private readonly timeoutMs = 5000,
  ) {
    this.url = `${apiBaseUrl(host, port)}/${token}`;
  }

  async getInfo(): Promise<NanoleafInfo> {
    const res = await this.request('GET', '/');
    return (await res.json()) as NanoleafInfo;
  }

  async selectEffect(name: string): Promise<void> {
    await this.request('PUT', '/effects', { select: name });
  }

  async setOn(on: boolean): Promise<void> {
    await this.request('PUT', '/state', { on: { value: on } });
  }

  /**
   * Reads the server-sent event stream until it ends or `signal` aborts,
   * calling `onEvent` for every received message.
   */
  async streamEvents(
    ids: number[],
    onEvent: (id: number, events: NanoleafEvent[]) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const res = await fetch(`${this.url}/events?id=${ids.join(',')}`, { signal });
    if (!res.ok || !res.body) {
      throw new NanoleafHttpError(`Event stream failed with HTTP ${res.status}`, res.status);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const message = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const parsed = parseEventMessage(message);
        if (parsed) {
          onEvent(parsed.id, parsed.events);
        }
      }
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetch(this.url + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      throw new NanoleafHttpError(`${method} ${path} failed with HTTP ${res.status}`, res.status);
    }
    return res;
  }
}

function parseEventMessage(message: string): { id: number; events: NanoleafEvent[] } | undefined {
  let id: number | undefined;
  const data: string[] = [];
  for (const line of message.split('\n')) {
    if (line.startsWith('id:')) {
      id = Number(line.slice(3).trim());
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trim());
    }
  }
  if (id === undefined || Number.isNaN(id) || data.length === 0) {
    return undefined;
  }
  try {
    const payload = JSON.parse(data.join('\n')) as { events?: NanoleafEvent[] };
    return { id, events: payload.events ?? [] };
  } catch {
    return undefined;
  }
}
