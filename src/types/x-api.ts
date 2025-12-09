/**
 * TypeScript interfaces for X (Twitter) API v2 responses.
 * These extend the base types from twitter-api-v2 to provide
 * better type safety for metrics and other fields.
 */

/**
 * Public metrics available on tweets.
 */
export interface TweetPublicMetrics {
  like_count?: number;
  reply_count?: number;
  retweet_count?: number;
  quote_count?: number;
  bookmark_count?: number;
  impression_count?: number;
}

/**
 * Organic metrics (available to tweet author with Basic tier).
 */
export interface TweetOrganicMetrics {
  impression_count?: number;
  reply_count?: number;
  retweet_count?: number;
  like_count?: number;
}

/**
 * Non-public metrics (available to tweet author with Basic tier).
 */
export interface TweetNonPublicMetrics {
  impression_count?: number;
  user_profile_clicks?: number;
  url_link_clicks?: number;
  bookmark_count?: number;
}

/**
 * Public metrics available on user profiles.
 */
export interface UserPublicMetrics {
  followers_count?: number;
  following_count?: number;
  tweet_count?: number;
  listed_count?: number;
}

/**
 * Extended tweet data with metrics fields.
 */
export interface TweetWithMetrics {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: TweetPublicMetrics;
  organic_metrics?: TweetOrganicMetrics;
  non_public_metrics?: TweetNonPublicMetrics;
  note_tweet?: {
    text?: string;
  };
  referenced_tweets?: Array<{
    type: 'replied_to' | 'quoted' | 'retweeted';
    id: string;
  }>;
}

/**
 * Extended user data with metrics fields.
 */
export interface UserWithMetrics {
  id: string;
  username: string;
  name: string;
  public_metrics?: UserPublicMetrics;
}

/**
 * Rate limit information from API responses.
 */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

/**
 * API response with rate limit information.
 */
export interface ApiResponseWithRateLimit<T> {
  data: T;
  rateLimit?: RateLimitInfo;
}

/**
 * Timeline response with includes for expanded data.
 */
export interface TimelineResponse {
  data?: {
    data?: TweetWithMetrics[];
    meta?: {
      next_token?: string;
      result_count?: number;
    };
  };
  includes?: {
    users?: UserWithMetrics[];
  };
  rateLimit?: RateLimitInfo;
}

/**
 * Error response from Twitter API.
 */
export interface TwitterApiErrorResponse {
  code?: number;
  message?: string;
  rateLimitError?: boolean;
  rateLimit?: RateLimitInfo;
  data?: unknown;
  errors?: unknown;
}
