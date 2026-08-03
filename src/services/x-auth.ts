import { createServer, IncomingMessage, ServerResponse } from 'http';
import { TwitterApi } from 'twitter-api-v2';
import open from 'open';
import { chmodSync, existsSync, lstatSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { hostname, userInfo } from 'os';
import type { XTokens, XTokensStore } from '../types/x-tokens.js';
import { logger } from '../utils/logger.js';

/**
 * Escape HTML entities to prevent XSS attacks
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Port 9876 to avoid conflicts with common dev servers (3000, 8080, etc.)
const CALLBACK_PORT = 9876;
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'like.write', 'follows.read', 'follows.write', 'offline.access'];
const TOKEN_STORE_VERSION = 1;
const TOKEN_STORE_ALGORITHM = 'aes-256-gcm';
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const OAUTH_RESPONSE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

interface EncryptedXTokensStore {
  version: typeof TOKEN_STORE_VERSION;
  encrypted: true;
  algorithm: typeof TOKEN_STORE_ALGORITHM;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

export class XAuthService {
  private cwd: string;
  private clientId: string;
  private clientSecret?: string;
  private tokensPath: string;

  constructor(cwd: string, clientId: string, clientSecret?: string) {
    this.cwd = cwd;
    this.clientId = clientId;
    this.clientSecret = clientSecret || process.env.TWITTER_CLIENT_SECRET;
    this.tokensPath = join(cwd, '.shippost-tokens.json');
  }

  /**
   * Start OAuth flow and get access token
   */
  async authorize(): Promise<XTokens> {
    // Create Twitter API client with client secret if available (for confidential clients)
    const clientConfig: { clientId: string; clientSecret?: string } = {
      clientId: this.clientId,
    };
    if (this.clientSecret) {
      clientConfig.clientSecret = this.clientSecret;
    }
    const client = new TwitterApi(clientConfig);

    // Generate auth link (PKCE is handled automatically by the library)
    const { url: authUrl, codeVerifier, state } = client.generateOAuth2AuthLink(REDIRECT_URI, {
      scope: SCOPES,
    });

    // Start local server to receive callback
    const authCode = await this.startCallbackServer(state, authUrl);

    // Exchange code for tokens
    let loginResult;
    try {
      loginResult = await client.loginWithOAuth2({
        code: authCode,
        codeVerifier,
        redirectUri: REDIRECT_URI,
      });
    } catch (error) {
      // Provide more helpful error messages for common issues
      const err = error as { code?: number; message?: string };
      if (err.code === 401 || err.message?.includes('401')) {
        throw new Error(
          'X API authentication failed (401). This usually means:\n' +
          '  1. The Client ID is invalid or the app was deleted\n' +
          '  2. The app\'s OAuth 2.0 settings are misconfigured\n' +
          `  3. The redirect URI doesn't match: ${REDIRECT_URI}\n` +
          'Please check your app at https://developer.x.com/en/portal/dashboard'
        );
      }
      throw error;
    }

    const {
      accessToken,
      refreshToken,
      expiresIn,
    } = loginResult;

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const tokens: XTokens = {
      accessToken,
      refreshToken,
      expiresAt,
    };

    // Save tokens
    this.saveTokens(tokens);

    return tokens;
  }

  /**
   * Check if we're in a headless/terminal-only environment
   */
  private isHeadless(): boolean {
    return !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && process.platform !== 'darwin' && process.platform !== 'win32';
  }

  /**
   * Prompt user to paste the callback URL and extract the auth code
   */
  private async getCodeFromManualInput(expectedState: string, authUrl: string): Promise<string> {
    logger.step('Terminal-only environment detected. Manual authentication required.');
    logger.blank();
    logger.info('1. Visit this URL in your browser:');
    logger.blank();
    logger.info(authUrl);
    logger.blank();
    logger.info('2. Authorize the app');
    logger.info('3. You\'ll be redirected to a page that won\'t load (that\'s expected)');
    logger.info('4. Copy the FULL URL from your browser\'s address bar');
    logger.info('   It will look like: http://127.0.0.1:9876/callback?state=...&code=...');
    logger.blank();

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve, reject) => {
      rl.question('Paste the callback URL here: ', (input) => {
        rl.close();
        
        try {
          const callbackUrl = new URL(input.trim());
          const code = callbackUrl.searchParams.get('code');
          const state = callbackUrl.searchParams.get('state');
          const error = callbackUrl.searchParams.get('error');

          if (state !== expectedState) {
            reject(new Error('State mismatch. Please try again from the beginning.'));
            return;
          }

          if (error) {
            reject(new Error(`Authorization failed: ${error}`));
            return;
          }

          if (!code) {
            reject(new Error('No authorization code found in URL. Make sure you copied the full URL.'));
            return;
          }

          resolve(code);
        } catch {
          reject(new Error('Invalid URL. Please paste the complete callback URL from your browser.'));
        }
      });
    });
  }

  /**
   * Start local HTTP server to receive OAuth callback
   */
  private startCallbackServer(expectedState: string, authUrl: string): Promise<string> {
    // In headless environments, use manual input instead of callback server
    if (this.isHeadless()) {
      return this.getCodeFromManualInput(expectedState, authUrl);
    }

    return new Promise((resolve, reject) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') {
          res.writeHead(405, OAUTH_RESPONSE_HEADERS);
          res.end('<html><body><h1>Method Not Allowed</h1></body></html>');
          return;
        }

        const expectedHost = `127.0.0.1:${CALLBACK_PORT}`;
        if (req.headers.host !== expectedHost) {
          res.writeHead(400, OAUTH_RESPONSE_HEADERS);
          res.end('<html><body><h1>Invalid Host Header</h1></body></html>');
          return;
        }

        const url = new URL(req.url || '', `http://${req.headers.host}`);

        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');
          const error = url.searchParams.get('error');

          if (state !== expectedState) {
            res.writeHead(400, OAUTH_RESPONSE_HEADERS);
            res.end(`
              <html>
                <body>
                  <h1>Invalid Request</h1>
                  <p>Missing or invalid parameters.</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
            server.close();
            reject(new Error('Invalid OAuth callback'));
            return;
          }

          if (error) {
            res.writeHead(400, OAUTH_RESPONSE_HEADERS);
            res.end(`
              <html>
                <body>
                  <h1>Authorization Failed</h1>
                  <p>Error: ${escapeHtml(error)}</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
            server.close();
            reject(new Error(`Authorization failed: ${error}`));
            return;
          }

          if (!code) {
            res.writeHead(400, OAUTH_RESPONSE_HEADERS);
            res.end(`
              <html>
                <body>
                  <h1>Invalid Request</h1>
                  <p>Missing or invalid parameters.</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
            server.close();
            reject(new Error('Invalid OAuth callback'));
            return;
          }

          res.writeHead(200, OAUTH_RESPONSE_HEADERS);
          res.end(`
            <html>
              <body>
                <h1>Authorization Successful!</h1>
                <p>You can close this window and return to the terminal.</p>
              </body>
            </html>
          `);
          server.close();
          resolve(code);
          return;
        }

        res.writeHead(404, OAUTH_RESPONSE_HEADERS);
        res.end('<html><body><h1>Not Found</h1></body></html>');
      });

      server.listen(CALLBACK_PORT, '127.0.0.1', () => {
        logger.step('Opening browser for authentication...');
        open(authUrl);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('Authorization timeout'));
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Load tokens from disk
   */
  loadTokens(): XTokens | null {
    if (!existsSync(this.tokensPath)) {
      return null;
    }

    try {
      this.assertTokenPathSafe();
      const data = readFileSync(this.tokensPath, 'utf-8');
      const parsed: unknown = JSON.parse(data);
      const tokens = this.parseTokenStore(parsed);
      if (tokens && !isEncryptedTokenStore(parsed)) {
        this.saveTokens(tokens);
      }
      return tokens;
    } catch (error) {
      throw new Error(`Failed to load OAuth tokens: ${(error as Error).message}`);
    }
  }

  /**
   * Save tokens to disk
   */
  private saveTokens(tokens: XTokens): void {
    const store = this.encryptTokenStore(tokens);
    this.writeTokenFile(JSON.stringify(store, null, 2));
  }

  private parseTokenStore(store: unknown): XTokens | null {
    if (isEncryptedTokenStore(store)) {
      return this.decryptTokenStore(store);
    }
    if (isPlainTokenStore(store)) {
      return store.x || null;
    }
    return null;
  }

  private encryptTokenStore(tokens: XTokens): EncryptedXTokensStore {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = this.deriveTokenKey(salt);
    const cipher = createCipheriv(TOKEN_STORE_ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify({ x: tokens }), 'utf8'),
      cipher.final(),
    ]);

    return {
      version: TOKEN_STORE_VERSION,
      encrypted: true,
      algorithm: TOKEN_STORE_ALGORITHM,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64'),
    };
  }

  private decryptTokenStore(store: EncryptedXTokensStore): XTokens | null {
    const salt = Buffer.from(store.salt, 'base64');
    const iv = Buffer.from(store.iv, 'base64');
    const key = this.deriveTokenKey(salt);
    const decipher = createDecipheriv(TOKEN_STORE_ALGORITHM, key, iv);
    decipher.setAuthTag(Buffer.from(store.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(store.data, 'base64')),
      decipher.final(),
    ]);
    const parsed: unknown = JSON.parse(decrypted.toString('utf8'));
    if (!isPlainTokenStore(parsed)) return null;
    return parsed.x || null;
  }

  private deriveTokenKey(salt: Buffer): Buffer {
    return scryptSync(getTokenSecret(), salt, 32);
  }

  private assertTokenPathSafe(): void {
    const stats = lstatSync(this.tokensPath);
    if (stats.isSymbolicLink()) {
      throw new Error('OAuth token file must not be a symbolic link');
    }

    if (process.platform !== 'win32') {
      const mode = statSync(this.tokensPath).mode & 0o777;
      if ((mode & 0o077) !== 0) {
        chmodSync(this.tokensPath, 0o600);
      }
    }
  }

  private writeTokenFile(contents: string): void {
    const tempPath = `${this.tokensPath}.tmp.${randomBytes(8).toString('hex')}`;
    try {
      if (existsSync(this.tokensPath)) {
        this.assertTokenPathSafe();
      }

      writeFileSync(tempPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      if (process.platform !== 'win32') {
        chmodSync(tempPath, 0o600);
      }

      renameSync(tempPath, this.tokensPath);

      if (process.platform !== 'win32') {
        chmodSync(this.tokensPath, 0o600);
        const mode = statSync(this.tokensPath).mode & 0o777;
        if (mode !== 0o600) {
          throw new Error(`OAuth token file has insecure permissions: ${mode.toString(8)}`);
        }
      }
    } catch (error) {
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath);
      } catch {
        // Best-effort cleanup.
      }
      throw error;
    }
  }

  /**
   * Check if tokens are expired
   */
  isTokenExpired(tokens: XTokens): boolean {
    return new Date(tokens.expiresAt).getTime() <= Date.now() + TOKEN_EXPIRY_BUFFER_MS;
  }

  /**
   * Refresh expired access token
   */
  async refreshTokens(tokens: XTokens): Promise<XTokens> {
    if (!tokens.refreshToken) {
      throw new Error('No refresh token available');
    }

    const clientConfig: { clientId: string; clientSecret?: string } = {
      clientId: this.clientId,
    };
    if (this.clientSecret) {
      clientConfig.clientSecret = this.clientSecret;
    }
    const client = new TwitterApi(clientConfig);

    const {
      accessToken,
      refreshToken,
      expiresIn,
    } = await client.refreshOAuth2Token(tokens.refreshToken);

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const newTokens: XTokens = {
      accessToken,
      refreshToken,
      expiresAt,
    };

    this.saveTokens(newTokens);

    return newTokens;
  }

  /**
   * Get valid access token (refresh if needed)
   */
  async getValidToken(): Promise<string> {
    let tokens = this.loadTokens();

    if (!tokens) {
      tokens = await this.authorize();
    } else if (this.isTokenExpired(tokens)) {
      tokens = await this.refreshTokens(tokens);
    }

    return tokens.accessToken;
  }
}

function isToken(value: unknown): value is XTokens {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const token = value as Record<string, unknown>;
  return (
    typeof token.accessToken === 'string' &&
    (token.refreshToken === undefined || typeof token.refreshToken === 'string') &&
    typeof token.expiresAt === 'string'
  );
}

function isPlainTokenStore(value: unknown): value is XTokensStore {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const store = value as Record<string, unknown>;
  return store.x === undefined || isToken(store.x);
}

function isEncryptedTokenStore(value: unknown): value is EncryptedXTokensStore {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const store = value as Record<string, unknown>;
  return (
    store.version === TOKEN_STORE_VERSION &&
    store.encrypted === true &&
    store.algorithm === TOKEN_STORE_ALGORITHM &&
    typeof store.salt === 'string' &&
    typeof store.iv === 'string' &&
    typeof store.tag === 'string' &&
    typeof store.data === 'string'
  );
}

function getTokenSecret(): string {
  if (process.env.SHIPPOST_TOKEN_KEY) {
    return process.env.SHIPPOST_TOKEN_KEY;
  }

  let username = process.env.USER || process.env.USERNAME || 'unknown-user';
  try {
    username = userInfo().username || username;
  } catch {
    // Keep the environment fallback.
  }

  return [
    'shippost-token-storage-v1',
    process.env.HOME || '',
    username,
    hostname(),
  ].join('|');
}
