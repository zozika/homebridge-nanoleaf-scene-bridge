import fs from 'node:fs';

/** Persists auth tokens obtained by pairing, keyed by device host, in the Homebridge storage folder. */
export class TokenStore {
  private tokens: Record<string, string> = {};

  constructor(private readonly file: string) {
    try {
      this.tokens = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
    } catch {
      this.tokens = {};
    }
  }

  get(host: string): string | undefined {
    return this.tokens[host];
  }

  values(): string[] {
    return Object.values(this.tokens);
  }

  set(host: string, token: string): void {
    if (this.tokens[host] === token) {
      return;
    }
    this.tokens[host] = token;
    this.save();
  }

  delete(host: string): void {
    if (host in this.tokens) {
      delete this.tokens[host];
      this.save();
    }
  }

  private save(): void {
    fs.writeFileSync(this.file, JSON.stringify(this.tokens, null, 2), { mode: 0o600 });
  }
}
