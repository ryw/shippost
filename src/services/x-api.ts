import { TwitterApi, TweetV2, UserV2 } from 'twitter-api-v2';

export interface Tweet {
  id: string;
  text: string;
  createdAt: string;
}

export class XApiService {
  private client: TwitterApi;

  constructor(accessToken: string) {
    this.client = new TwitterApi(accessToken);
  }

  /**
   * Get authenticated user's information
   */
  async getMe(): Promise<UserV2> {
    const { data } = await this.client.v2.me();
    return data;
  }

  /**
   * Fetch user's tweets
   */
  async getUserTweets(userId: string, maxResults: number = 100): Promise<Tweet[]> {
    const tweets: Tweet[] = [];

    // X API v2 limits to 100 results per request
    const limit = Math.min(maxResults, 100);

    try {
      const timeline = await this.client.v2.userTimeline(userId, {
        max_results: limit,
        'tweet.fields': ['created_at', 'text'],
        exclude: ['retweets', 'replies'], // Only get original tweets
      });

      for await (const tweet of timeline) {
        tweets.push({
          id: tweet.id,
          text: tweet.text,
          createdAt: tweet.created_at || new Date().toISOString(),
        });

        if (tweets.length >= maxResults) {
          break;
        }
      }

      return tweets;
    } catch (error: any) {
      throw new Error(`Failed to fetch tweets: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Fetch authenticated user's own tweets
   */
  async getMyTweets(maxResults: number = 100): Promise<Tweet[]> {
    const user = await this.getMe();
    return this.getUserTweets(user.id, maxResults);
  }
}
