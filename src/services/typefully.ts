import { logger } from '../utils/logger.js';

const TYPEFULLY_API_URL = 'https://api.typefully.com/v2';

export interface TypefullyDraftResponse {
  id: string;
  share_url?: string;
}

export class TypefullyService {
  private apiKey: string;
  private socialSetId: string;

  constructor(socialSetId?: string) {
    const apiKey = process.env.TYPEFULLY_API_KEY;
    if (!apiKey) {
      throw new Error(
        'TYPEFULLY_API_KEY environment variable is required.\n' +
          'Get your API key from Typefully Settings > Integrations'
      );
    }
    this.apiKey = apiKey;
    this.socialSetId = socialSetId || '1';
    if (!/^[A-Za-z0-9_-]+$/.test(this.socialSetId)) {
      throw new Error('Invalid Typefully social set id');
    }
  }

  /**
   * Create a draft in Typefully for the given platform
   */
  async createDraft(content: string, platform: 'x' | 'linkedin' = 'x'): Promise<TypefullyDraftResponse> {
    const platforms: Record<string, unknown> = {};

    if (platform === 'linkedin') {
      platforms.linkedin = {
        enabled: true,
        posts: [{ text: content }],
        settings: {},
      };
    } else {
      platforms.x = {
        enabled: true,
        posts: [{ text: content }],
        settings: {},
      };
    }

    const response = await fetch(`${TYPEFULLY_API_URL}/social-sets/${this.socialSetId}/drafts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        platforms,
        share: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(`Typefully API error (${response.status}): ${errorText.slice(0, 500)}`);
      if (response.status === 401 || response.status === 403) {
        throw new Error('Typefully authentication failed');
      }
      if (response.status === 429) {
        throw new Error('Typefully rate limit reached. Please try again later.');
      }
      throw new Error(`Failed to create Typefully draft (status: ${response.status})`);
    }

    return response.json() as Promise<TypefullyDraftResponse>;
  }
}
