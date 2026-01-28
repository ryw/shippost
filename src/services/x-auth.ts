import { createServer, IncomingMessage, ServerResponse } from 'http';
import { TwitterApi } from 'twitter-api-v2';
import open from 'open';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
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
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'like.write', 'offline.access'];

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
    console.log(authUrl);
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

          if (error) {
            reject(new Error(`Authorization failed: ${error}`));
            return;
          }

          if (!code) {
            reject(new Error('No authorization code found in URL. Make sure you copied the full URL.'));
            return;
          }

          if (state !== expectedState) {
            reject(new Error('State mismatch. Please try again from the beginning.'));
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
        const url = new URL(req.url || '', `http://${req.headers.host}`);

        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
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

          if (!code || state !== expectedState) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
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

          res.writeHead(200, { 'Content-Type': 'text/html' });
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
        }
      });

      server.listen(CALLBACK_PORT, () => {
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
      const data = readFileSync(this.tokensPath, 'utf-8');
      const store: XTokensStore = JSON.parse(data);
      return store.x || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Save tokens to disk
   */
  private saveTokens(tokens: XTokens): void {
    let store: XTokensStore = {};

    if (existsSync(this.tokensPath)) {
      try {
        const data = readFileSync(this.tokensPath, 'utf-8');
        store = JSON.parse(data);
      } catch (error) {
        // Ignore parse errors, will overwrite
      }
    }

    store.x = tokens;
    // Write with restrictive permissions (owner read/write only) to protect OAuth tokens
    writeFileSync(this.tokensPath, JSON.stringify(store, null, 2), { mode: 0o600 });
  }

  /**
   * Check if tokens are expired
   */
  isTokenExpired(tokens: XTokens): boolean {
    return new Date(tokens.expiresAt) < new Date();
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
