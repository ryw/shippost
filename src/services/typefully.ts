const TYPEFULLY_API_URL = 'https://api.typefully.com/v1';

export interface TypefullyDraftResponse {
  id: string;
  share_url?: string;
}

export class TypefullyService {
  private apiKey: string;

  constructor() {
    const apiKey = process.env.TYPEFULLY_API_KEY;
    if (!apiKey) {
      throw new Error(
        'TYPEFULLY_API_KEY environment variable is required.\n' +
          'Get your API key from Typefully Settings > Integrations'
      );
    }
    this.apiKey = apiKey;
  }

  /**
   * Create a draft in Typefully
   */
  async createDraft(content: string): Promise<TypefullyDraftResponse> {
    const response = await fetch(`${TYPEFULLY_API_URL}/drafts/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        content,
        share: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Typefully API error (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<TypefullyDraftResponse>;
  }
}
