import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const TOKEN_URL = 'https://auth.x.ai/oauth2/token';
interface Credentials { access: string; refresh: string; expires: number }
interface Device { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval?: number }
const pending = new Map<string, { device: Device; deadline: number; next: number; interval: number; busy: boolean }>();

async function tokenRequest(body: Record<string, string>) {
  return fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal: AbortSignal.timeout(20000) });
}
function fromResponse(data: any, previousRefresh = ''): Credentials {
  if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('Grok returned an invalid sign-in response.');
  return { access: data.access_token, refresh: data.refresh_token || previousRefresh, expires: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
}
export class GrokAuth {
  private directory: string;
  private path: string;
  constructor(private cwd: string) {
    this.directory = join(cwd, '.shippost-grok');
    this.path = join(this.directory, 'subscription.json');
  }
  private read(): Credentials | null {
    try { return JSON.parse(readFileSync(this.path, 'utf8')); } catch { return null; }
  }
  private legacy(): Credentials | null {
    // Import the user's existing Grok sign-in; generation no longer starts its CLI.
    try {
      const data = JSON.parse(readFileSync(join(this.directory, 'auth.json'), 'utf8'));
      const entry = data[`https://auth.x.ai::${CLIENT_ID}`];
      if (entry?.key && entry?.refresh_token) return { access: entry.key, refresh: entry.refresh_token, expires: Date.parse(entry.expires_at) || 0 };
    } catch { /* No existing native sign-in. */ }
    return null;
  }
  connected(): boolean { return !!(this.read()?.access || this.legacy()?.access); }
  private save(credentials: Credentials) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temp = this.path + '.' + randomUUID();
    try {
      writeFileSync(temp, JSON.stringify(credentials), { mode: 0o600, flag: 'wx' });
      renameSync(temp, this.path);
    } finally { if (existsSync(temp)) unlinkSync(temp); }
  }
  private async locked<T>(work: () => Promise<T>): Promise<T> {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    writeFileSync(join(this.directory, '.gitignore'), '*\n', { mode: 0o600 });
    const lock = join(this.directory, 'subscription.lock');
    const deadline = Date.now() + 30000;
    for (;;) {
      try { writeFileSync(lock, '', { flag: 'wx', mode: 0o600 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try { if (Date.now() - statSync(lock).mtimeMs > 60000) unlinkSync(lock); } catch { /* Another process released it. */ }
        if (Date.now() >= deadline) throw new Error('Grok sign-in is busy. Try again shortly.');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    try { return await work(); } finally { unlinkSync(lock); }
  }
  async accessToken(): Promise<string> {
    return this.locked(async () => {
      let credentials = this.read();
      if (!credentials) {
        credentials = this.legacy();
        if (credentials) this.save(credentials);
      }
      if (!credentials?.access) throw new Error('Connect your Grok subscription in Settings.');
      let expires = credentials.expires;
      try {
        const exp = JSON.parse(Buffer.from(credentials.access.split('.')[1], 'base64url').toString()).exp;
        if (typeof exp === 'number') expires = Math.min(expires, exp * 1000);
      } catch { /* Opaque tokens use the stored expiry. */ }
      if (expires > Date.now() + 120000) return credentials.access;
      const response = await tokenRequest({ grant_type: 'refresh_token', refresh_token: credentials.refresh, client_id: CLIENT_ID });
      if (!response.ok) throw new Error('Grok subscription sign-in expired. Reconnect in Settings.');
      credentials = fromResponse(await response.json(), credentials.refresh);
      this.save(credentials);
      return credentials.access;
    });
  }
  async start() {
    const response = await fetch('https://auth.x.ai/oauth2/device/code', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, scope: 'openid profile email offline_access grok-cli:access api:access' }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Grok sign-in could not start (HTTP ${response.status}).`);
    const device = await response.json() as Device;
    if (!device.device_code || !device.user_code || !device.verification_uri || new URL(device.verification_uri).protocol !== 'https:') throw new Error('Grok returned an invalid sign-in link.');
    const interval = Math.max(5000, (Number(device.interval) || 5) * 1000);
    pending.set(this.cwd, { device, deadline: Date.now() + (Number(device.expires_in) || 300) * 1000, next: Date.now() + interval, interval, busy: false });
    return { url: device.verification_uri, code: device.user_code };
  }
  async poll() {
    const state = pending.get(this.cwd);
    if (!state) return { status: this.connected() ? 'connected' : 'disconnected' };
    if (Date.now() > state.deadline) { pending.delete(this.cwd); throw new Error('Grok sign-in timed out. Connect again.'); }
    if (state.busy || Date.now() < state.next) return { status: 'pending' };
    state.busy = true;
    try {
      const response = await tokenRequest({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: state.device.device_code, client_id: CLIENT_ID });
      const data = await response.json() as any;
      if (response.ok) {
        await this.locked(async () => this.save(fromResponse(data)));
        pending.delete(this.cwd);
        return { status: 'connected' };
      }
      if (data.error === 'slow_down') state.interval += 5000;
      if (data.error === 'authorization_pending' || data.error === 'slow_down') return { status: 'pending' };
      pending.delete(this.cwd);
      throw new Error('Grok sign-in was denied or expired. Connect again.');
    } finally { state.busy = false; state.next = Date.now() + state.interval; }
  }
}
