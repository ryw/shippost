export interface T2pConfig {
  ollama: {
    host: string;
    model: string;
    timeout?: number;
  };
  generation: {
    postsPerTranscript?: number;
    temperature?: number;
    strategies?: {
      enabled?: boolean;
      autoSelect?: boolean;
      diversityWeight?: number;
      preferThreadFriendly?: boolean;
    };
  };
  x?: {
    clientId?: string;
  };
}

export const DEFAULT_CONFIG: T2pConfig = {
  ollama: {
    host: 'http://127.0.0.1:11434',
    model: 'llama3.1',
    timeout: 60000,
  },
  generation: {
    postsPerTranscript: 8,
    temperature: 0.7,
    strategies: {
      enabled: true,
      autoSelect: true,
      diversityWeight: 0.7,
      preferThreadFriendly: false,
    },
  },
};
