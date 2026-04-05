import { Router, Request, Response } from 'express';
import { requireAuth, requireTier, AuthRequest } from '../middleware/auth';
import { getChannelVideos } from '../services/youtube';
import { analyzeChannelProfile } from '../services/scriptgen';
import { supabaseAdmin } from '../services/supabase';

const router = Router();

// POST /api/channel/analyze
router.post('/analyze', requireAuth, requireTier('autopilot'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { youtube_channel_url } = req.body;
  if (!youtube_channel_url) {
    res.status(400).json({ error: 'youtube_channel_url is required' });
    return;
  }

  try {
    // Fetch channel videos from YouTube API
    const { titles, tags } = await getChannelVideos(youtube_channel_url);

    if (titles.length === 0) {
      res.status(400).json({ error: 'Could not find any videos for this channel. Please check the URL.' });
      return;
    }

    // Analyze with GPT-4o
    const profile = await analyzeChannelProfile(titles, tags);

    // Save to database (upsert)
    const { data, error } = await supabaseAdmin
      .from('channel_profiles')
      .upsert({
        user_id: req.userId,
        youtube_channel_url,
        channel_niche: profile.niche,
        channel_summary: profile.channel_summary,
        top_keywords: profile.top_keywords,
        style_notes: profile.style_notes,
        avoid_topics: profile.avoid_topics,
        last_analyzed_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      console.error('Channel profile save error:', error);
      res.status(500).json({ error: 'Failed to save channel profile' });
      return;
    }

    res.json({
      channel_profile: data,
      videos_analyzed: titles.length,
    });
  } catch (err: any) {
    console.error('Channel analyze error:', err.message);
    res.status(500).json({ error: 'Failed to analyze channel' });
  }
});

// GET /api/channel/profile
router.get('/profile', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('channel_profiles')
    .select('*')
    .eq('user_id', req.userId)
    .single();

  if (error) {
    res.json({ channel_profile: null });
    return;
  }

  res.json({ channel_profile: data });
});

export default router;
