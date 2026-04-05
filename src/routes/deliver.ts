import { Router, Response } from 'express';
import { requireAuth, requireTier, AuthRequest } from '../middleware/auth';
import { db } from '../services/supabase';
import { deliverToNotion, verifyNotionAccess } from '../services/notion';

const router = Router();

// POST /api/deliver/notion
router.post('/notion', requireAuth, requireTier('autopilot'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { script_id, notion_token, notion_page_id } = req.body;

  if (!script_id || !notion_token || !notion_page_id) {
    res.status(400).json({ error: 'script_id, notion_token, and notion_page_id are required' });
    return;
  }

  try {
    // Get script
    const script = await db.selectOne('generated_scripts', { id: script_id, user_id: req.userId });

    if (!script) {
      res.status(404).json({ error: 'Script not found' });
      return;
    }

    // Deliver to Notion
    const notionUrl = await deliverToNotion({
      notionToken: notion_token,
      notionPageId: notion_page_id,
      topic: script.topic,
      scriptContent: script.script_content,
      scriptId: script.id,
    });

    // Update delivered_to
    await db.update('generated_scripts', { delivered_to: 'notion' }, { id: script_id });

    res.json({
      success: true,
      notion_url: notionUrl,
      message: `Script "${script.topic}" delivered to Notion`,
    });
  } catch (err: any) {
    console.error('Notion delivery error:', err.message);
    res.status(500).json({ error: `Notion delivery failed: ${err.message}` });
  }
});

// POST /api/deliver/verify-notion
router.post('/verify-notion', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { notion_token, notion_page_id } = req.body;

  if (!notion_token || !notion_page_id) {
    res.status(400).json({ error: 'notion_token and notion_page_id are required' });
    return;
  }

  const valid = await verifyNotionAccess(notion_token, notion_page_id);
  res.json({ valid, message: valid ? 'Notion connection verified' : 'Could not access Notion page. Check token and page ID.' });
});

export default router;
