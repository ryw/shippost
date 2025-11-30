export class T2pError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'T2pError';
  }
}

export class OllamaNotAvailableError extends T2pError {
  constructor() {
    super(
      'Ollama is not available. Please ensure Ollama is running.\n\nInstall: https://ollama.ai\nStart: ollama serve'
    );
    this.name = 'OllamaNotAvailableError';
  }
}

export class NotInitializedError extends T2pError {
  constructor() {
    super('Not a t2p project. Run: t2p init');
    this.name = 'NotInitializedError';
  }
}

export class ModelNotFoundError extends T2pError {
  constructor(model: string) {
    super(`Model '${model}' not found. Run: ollama pull ${model}`);
    this.name = 'ModelNotFoundError';
  }
}

export class ConfigError extends T2pError {
  constructor(message: string) {
    super(`Configuration error: ${message}`);
    this.name = 'ConfigError';
  }
}

export class FileSystemError extends T2pError {
  constructor(message: string) {
    super(`File system error: ${message}`);
    this.name = 'FileSystemError';
  }
}
