import { db } from '../services/supabase';
import { searchTrendingByNiche, getMostPopularByCategory, mergeTrendingTopics, scoreTopicsAgainstChannel } from '../services/youtube';
import { generateScript, pickBestTopics } from '../services/scriptgen';
import { deliverToNotion } from '../services/notion';
import { sendAutopilotSummary } from '../services/email';

export interface AutopilotRunResult {
  success: boolean;
  topicsGenerated: string[];
  scriptsCreated: number;
  deliveredTo: string | null;
  error?: string;
}

/**
 * Run the full autopilot pipeline for a single user
 */
export async function runAutopilotForUser(userId: string): Promise<AutopilotRunResult> {
  console.log(`[Autopilot] Starting run for user ${userId}`);

  try {
    // 1. Load user config
    const config = await db.selectOne('autopilot_configs', { user_id: userId });

    if (!config) {
      return { success: false, topicsGenerated: [], scriptsCreated: 0, deliveredTo: null, error: 'No autopilot config found' };
    }

    // 2. Load channel profile (if available)
    const channelProfile = await db.selectOne('channel_profiles', { user_id: userId });

    const channelKeywords: string[] = channelProfile?.top_keywords || [];
    const avoidTopics: string[] = channelProfile?.avoid_topics || [];
    const channelNiche = channelProfile?.channel_niche || config.niche;

    // 3. Fetch trending topics (both signals)
    console.log(`[Autopilot] Fetching trends for niche: ${config.niche}`);
    const [searchTopics, popularTopics] = await Promise.all([
      searchTrendingByNiche(config.niche, 'US', 15),
      getMostPopularByCategory(config.niche, 'US', 20),
    ]);

    let allTopics = mergeTrendingTopics(searchTopics, popularTopics, 20);

    // 4. Score against channel profile
    if (channelKeywords.length > 0) {
      allTopics = scoreTopicsAgainstChannel(allTopics, channelKeywords, avoidTopics);
    }

    // 5. Pick best 3 topics using GPT-4o
    const selectedTopics = channelKeywords.length > 0
      ? await pickBestTopics(allTopics, channelKeywords, channelNiche, 3)
      : allTopics.slice(0, 3);

    console.log(`[Autopilot] Selected topics:`, selectedTopics);

    if (selectedTopics.length === 0) {
      return { success: false, topicsGenerated: [], scriptsCreated: 0, deliveredTo: null, error: 'No suitable topics found' };
    }

    // 6. Generate scripts
    const generatedScripts: Array<{ id: string; topic: string; notionUrl?: string }> = [];

    for (const topic of selectedTopics) {
      try {
        console.log(`[Autopilot] Generating script for: ${topic}`);

        const { content, qualityScore } = await generateScript({
          topic,
          niche: config.niche,
          tone: config.tone,
          length: config.script_length,
        });

        // Save to database
        let savedScript: any;
        try {
          savedScript = await db.insert('generated_scripts', {
            user_id: userId,
            topic,
            niche: config.niche,
            script_content: content,
            quality_score: qualityScore,
            source: 'autopilot',
          });
        } catch (saveErr: any) {
          console.error(`[Autopilot] Failed to save script for "${topic}":`, saveErr.message);
          continue;
        }

        // 7. Deliver to Notion (if configured)
        let notionUrl: string | undefined;
        if (config.notion_token && config.notion_page_id) {
          try {
            notionUrl = await deliverToNotion({
              notionToken: config.notion_token,
              notionPageId: config.notion_page_id,
              topic,
              scriptContent: content,
              scriptId: savedScript.id,
            });

            await db.update('generated_scripts', { delivered_to: 'notion' }, { id: savedScript.id });

            console.log(`[Autopilot] Delivered "${topic}" to Notion: ${notionUrl}`);
          } catch (notionErr: any) {
            console.error(`[Autopilot] Notion delivery failed for "${topic}":`, notionErr.message);
          }
        }

        generatedScripts.push({ id: savedScript.id, topic, notionUrl });
      } catch (scriptErr: any) {
        console.error(`[Autopilot] Script generation failed for "${topic}":`, scriptErr.message);
      }
    }

    // 8. Update last_run_at
    await db.update('autopilot_configs', { last_run_at: new Date().toISOString() }, { user_id: userId });

    // 9. Send summary email
    if (generatedScripts.length > 0) {
      const user = await db.selectOne('users', { id: userId }, 'email');

      if (user?.email) {
        await sendAutopilotSummary({
          to: user.email,
          scripts: generatedScripts,
          date: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
        });
      }
    }

    const deliveredTo = config.notion_token ? 'notion' : null;

    return {
      success: true,
      topicsGenerated: generatedScripts.map(s => s.topic),
      scriptsCreated: generatedScripts.length,
      deliveredTo,
    };
  } catch (err: any) {
    console.error(`[Autopilot] Fatal error for user ${userId}:`, err.message);
    return {
      success: false,
      topicsGenerated: [],
      scriptsCreated: 0,
      deliveredTo: null,
      error: err.message,
    };
  }
}
