export interface XTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
}

export interface XTokensStore {
  x?: XTokens;
}
