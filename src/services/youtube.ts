import axios from 'axios';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY!;
const YOUTUBE_BASE = 'https://www.googleapis.com/youtube/v3';

// Map niche names to YouTube category IDs for mostPopular chart
const NICHE_CATEGORY_MAP: Record<string, string> = {
  'personal finance': '27',       // Education
  'investing': '27',
  'health and fitness': '26',     // How-to & Style
  'mindset and motivation': '26',
  'technology': '28',             // Science & Technology
  'travel': '19',                 // Travel & Events
  'food and cooking': '26',
  'business and entrepreneurship': '27',
  'relationships': '22',          // People & Blogs
  'history and education': '27',
  'true crime': '22',
  'gaming': '20',                 // Gaming
  'beauty and fashion': '26',
  'parenting': '26',
  'spirituality and self help': '22',
};

export interface TrendingTopic {
  title: string;
  viewCount: number;
  channelTitle: string;
  publishedAt: string;
}

/**
 * Search for trending videos in a niche using search.list
 */
export async function searchTrendingByNiche(
  niche: string,
  regionCode = 'US',
  maxResults = 15,
): Promise<TrendingTopic[]> {
  const publishedAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const searchRes = await axios.get(`${YOUTUBE_BASE}/search`, {
      params: {
        key: YOUTUBE_API_KEY,
        q: niche,
        part: 'snippet',
        type: 'video',
        order: 'viewCount',
        publishedAfter,
        regionCode,
        maxResults,
        relevanceLanguage: 'en',
      },
    });

    const items = searchRes.data.items || [];
    const videoIds = items.map((i: any) => i.id.videoId).filter(Boolean).join(',');

    if (!videoIds) return [];

    // Fetch statistics for view counts
    const statsRes = await axios.get(`${YOUTUBE_BASE}/videos`, {
      params: {
        key: YOUTUBE_API_KEY,
        id: videoIds,
        part: 'statistics,snippet',
      },
    });

    return (statsRes.data.items || []).map((v: any) => ({
      title: v.snippet.title,
      viewCount: parseInt(v.statistics.viewCount || '0'),
      channelTitle: v.snippet.channelTitle,
      publishedAt: v.snippet.publishedAt,
    }));
  } catch (err: any) {
    console.error('YouTube search error:', err?.response?.data || err.message);
    return [];
  }
}

/**
 * Fetch most popular videos by category (second trend signal)
 */
export async function getMostPopularByCategory(
  niche: string,
  regionCode = 'US',
  maxResults = 20,
): Promise<TrendingTopic[]> {
  const categoryId = NICHE_CATEGORY_MAP[niche.toLowerCase()] || '27';

  try {
    const res = await axios.get(`${YOUTUBE_BASE}/videos`, {
      params: {
        key: YOUTUBE_API_KEY,
        part: 'snippet,statistics',
        chart: 'mostPopular',
        regionCode,
        videoCategoryId: categoryId,
        maxResults,
      },
    });

    return (res.data.items || []).map((v: any) => ({
      title: v.snippet.title,
      viewCount: parseInt(v.statistics.viewCount || '0'),
      channelTitle: v.snippet.channelTitle,
      publishedAt: v.snippet.publishedAt,
    }));
  } catch (err: any) {
    console.error('YouTube popular error:', err?.response?.data || err.message);
    return [];
  }
}

/**
 * Merge, deduplicate, and rank trending topics by view velocity
 */
export function mergeTrendingTopics(
  searchTopics: TrendingTopic[],
  popularTopics: TrendingTopic[],
  limit = 10,
): string[] {
  const all = [...searchTopics, ...popularTopics];

  // Deduplicate by title similarity
  const seen = new Set<string>();
  const unique: TrendingTopic[] = [];
  for (const t of all) {
    const normalized = t.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').substring(0, 40);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(t);
    }
  }

  // Sort by view count (descending)
  unique.sort((a, b) => b.viewCount - a.viewCount);

  return unique.slice(0, limit).map(t => t.title);
}

/**
 * Get all video titles and tags from a YouTube channel
 */
export async function getChannelVideos(channelUrl: string): Promise<{ titles: string[]; tags: string[] }> {
  try {
    // Extract channel handle or ID from URL
    let channelIdentifier = '';
    const handleMatch = channelUrl.match(/@([^/]+)/);
    const idMatch = channelUrl.match(/channel\/([^/]+)/);

    if (handleMatch) {
      channelIdentifier = handleMatch[1];
    } else if (idMatch) {
      channelIdentifier = idMatch[1];
    } else {
      // Assume it's a username
      channelIdentifier = channelUrl.split('/').pop() || '';
    }

    // Resolve channel ID
    const searchRes = await axios.get(`${YOUTUBE_BASE}/search`, {
      params: {
        key: YOUTUBE_API_KEY,
        part: 'snippet',
        q: channelIdentifier,
        type: 'channel',
        maxResults: 1,
      },
    });

    const channelId = searchRes.data.items?.[0]?.id?.channelId;
    if (!channelId) return { titles: [], tags: [] };

    // Get top videos from channel
    const videosRes = await axios.get(`${YOUTUBE_BASE}/search`, {
      params: {
        key: YOUTUBE_API_KEY,
        part: 'snippet',
        channelId,
        type: 'video',
        order: 'viewCount',
        maxResults: 50,
      },
    });

    const videoIds = (videosRes.data.items || [])
      .map((i: any) => i.id.videoId)
      .filter(Boolean)
      .join(',');

    if (!videoIds) return { titles: [], tags: [] };

    // Get tags for those videos
    const detailsRes = await axios.get(`${YOUTUBE_BASE}/videos`, {
      params: {
        key: YOUTUBE_API_KEY,
        id: videoIds,
        part: 'snippet',
      },
    });

    const titles: string[] = [];
    const tags: string[] = [];

    for (const v of detailsRes.data.items || []) {
      titles.push(v.snippet.title);
      if (v.snippet.tags) {
        tags.push(...v.snippet.tags);
      }
    }

    return { titles, tags: [...new Set(tags)] }; // deduplicate tags
  } catch (err: any) {
    console.error('Channel analysis error:', err?.response?.data || err.message);
    return { titles: [], tags: [] };
  }
}

/**
 * Score a list of trending topics against channel keywords
 * Returns topics sorted by relevance score (desc)
 */
export function scoreTopicsAgainstChannel(
  trendingTopics: string[],
  channelKeywords: string[],
  avoidTopics: string[],
): string[] {
  const keywords = channelKeywords.map(k => k.toLowerCase());
  const avoids = avoidTopics.map(k => k.toLowerCase());

  const scored = trendingTopics.map(topic => {
    const topicLower = topic.toLowerCase();

    // Skip if topic matches avoid list
    if (avoids.some(a => topicLower.includes(a))) {
      return { topic, score: -1 };
    }

    // Score based on keyword overlap
    const score = keywords.reduce((s, kw) => s + (topicLower.includes(kw) ? 2 : 0), 0);
    return { topic, score };
  });

  return scored
    .filter(s => s.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.topic);
}
