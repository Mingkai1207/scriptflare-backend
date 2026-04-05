import { Router, Response } from 'express';
import { requireAuth, requireTier, AuthRequest } from '../middleware/auth';
import { supabaseAdmin } from '../services/supabase';
import { generateScript } from '../services/scriptgen';
import { registerUserJob, unregisterUserJob } from '../scheduler';

const router = Router();

// GET /api/autopilot/config
router.get('/config', requireAuth, requireTier('autopilot'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('autopilot_configs')
    .select('*')
    .eq('user_id', req.userId)
    .single();

  res.json({ config: error ? null : data });
});

// PUT /api/autopilot/config
router.put('/config', requireAuth, requireTier('autopilot'), async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    schedule_time,
    schedule_days,
    niche,
    tone,
    script_length,
    notion_token,
    notion_page_id,
    gdrive_token,
    gdrive_folder_id,
    enabled,
  } = req.body;

  try {
    const { data, error } = await supabaseAdmin
      .from('autopilot_configs')
      .upsert({
        user_id: req.userId,
        schedule_time: schedule_time || '08:00',
        schedule_days: schedule_days || [1, 3, 5],
        niche: niche || 'personal finance',
        tone: tone || 'educational and engaging',
        script_length: script_length || 8,
        notion_token: notion_token || null,
        notion_page_id: notion_page_id || null,
        gdrive_token: gdrive_token || null,
        gdrive_folder_id: gdrive_folder_id || null,
        enabled: enabled ?? false,
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Update cron scheduler
    if (data.enabled) {
      registerUserJob(data);
    } else {
      unregisterUserJob(req.userId!);
    }

    res.json({ config: data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/autopilot/run — manual trigger
router.post('/run', requireAuth, requireTier('autopilot'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Import here to avoid circular deps
    const { runAutopilotForUser } = await import('../scheduler/autopilotRun');
    const result = await runAutopilotForUser(req.userId!);
    res.json(result);
  } catch (err: any) {
    console.error('Manual autopilot run error:', err.message);
    res.status(500).json({ error: err.message || 'Autopilot run failed' });
  }
});

// GET /api/autopilot/scripts
router.get('/scripts', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const limit = parseInt(req.query.limit as string) || 20;
  const source = req.query.source as string; // 'manual' | 'autopilot' | undefined

  let query = supabaseAdmin
    .from('generated_scripts')
    .select('*')
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (source) {
    query = query.eq('source', source);
  }

  const { data, error } = await query;

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ scripts: data });
});

// POST /api/autopilot/generate — generate and save a single script
router.post('/generate', requireAuth, requireTier('pro'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { topic, niche, tone, length } = req.body;

  if (!topic || !niche) {
    res.status(400).json({ error: 'topic and niche are required' });
    return;
  }

  try {
    const { content, wordCount, qualityScore } = await generateScript({
      topic,
      niche,
      tone: tone || 'educational and engaging',
      length: length || 8,
    });

    const { data, error } = await supabaseAdmin
      .from('generated_scripts')
      .insert({
        user_id: req.userId,
        topic,
        niche,
        script_content: content,
        quality_score: qualityScore,
        source: 'manual',
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ script: data, wordCount });
  } catch (err: any) {
    console.error('Script generation error:', err.message);
    res.status(500).json({ error: 'Script generation failed' });
  }
});

export default router;
