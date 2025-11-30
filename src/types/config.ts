export interface T2pConfig {
  ollama: {
    host: string;
    model: string;
    timeout?: number;
  };
  generation: {
    postsPerTranscript?: number;
    temperature?: number;
  };
}

export const DEFAULT_CONFIG: T2pConfig = {
  ollama: {
    host: 'http://127.0.0.1:11434',
    model: 'llama3.1',
    timeout: 60000,
  },
  generation: {
    postsPerTranscript: 5,
    temperature: 0.7,
  },
};
