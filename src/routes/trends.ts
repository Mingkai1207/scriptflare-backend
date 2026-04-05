import { Router, Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { searchTrendingByNiche, getMostPopularByCategory, mergeTrendingTopics } from '../services/youtube';

const router = Router();

// GET /api/trends?niche=personal+finance&region=US
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const niche = (req.query.niche as string) || 'personal finance';
  const region = (req.query.region as string) || 'US';

  try {
    const [searchTopics, popularTopics] = await Promise.all([
      searchTrendingByNiche(niche, region, 15),
      getMostPopularByCategory(niche, region, 20),
    ]);

    const topics = mergeTrendingTopics(searchTopics, popularTopics, 10);

    res.json({
      niche,
      region,
      topics,
      rawCounts: {
        fromSearch: searchTopics.length,
        fromPopular: popularTopics.length,
      },
    });
  } catch (err: any) {
    console.error('Trends error:', err.message);
    res.status(500).json({ error: 'Failed to fetch trending topics' });
  }
});

export default router;
