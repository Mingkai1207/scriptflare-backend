import axios from 'axios';

const API_URL = process.env.VECTORENGINE_API_URL!;
const API_KEY = process.env.VECTORENGINE_API_KEY!;
const MODEL = process.env.VECTORENGINE_MODEL || 'gpt-4o';

const NICHE_GUIDANCE: Record<string, string> = {
  'personal finance': 'Use relatable money stress, specific dollar amounts, actionable advice. Reference real platforms (Vanguard, Fidelity, YNAB).',
  'investing': 'Balance aspiration with risk reality. Use historical return data. Speak to beginners with zero jargon, then reward patient viewers with depth.',
  'health and fitness': 'Lead with pain (tired, overweight, weak), show transformation is achievable, debunk 1–2 myths per video.',
  'mindset and motivation': 'Open with a universal failure moment. Build toward reframe. Quote real people, not platitudes. End with one concrete action.',
  'technology': 'Lead with what the viewer can DO with this technology. Skip specs — focus on impact. Use before/after comparisons.',
  'business and entrepreneurship': 'Real numbers, real mistakes. Viewers are skeptical of hype — ground every claim with evidence or personal experience.',
  'true crime': 'Chronological pacing with suspense. Drop unanswered questions early. Use present-tense storytelling for urgency.',
  'history and education': 'Find the modern parallel. Make history feel urgent and relevant. One surprising fact per section to reward attention.',
};

export interface ScriptParams {
  topic: string;
  niche: string;
  tone?: string;
  length?: number; // minutes
  audience?: string;
}

export interface GeneratedScript {
  content: string;
  wordCount: number;
  qualityScore: number;
}

/**
 * Generate a full YouTube script using the vectorengine.ai API
 */
export async function generateScript(params: ScriptParams): Promise<GeneratedScript> {
  const { topic, niche, tone = 'educational and engaging', length = 8, audience = 'general audience' } = params;
  const wordCount = Math.round(length * 130); // ~130 words/min

  const nicheNote = NICHE_GUIDANCE[niche.toLowerCase()]
    ? `\nNiche writing guidance: ${NICHE_GUIDANCE[niche.toLowerCase()]}`
    : '';

  const systemPrompt = `You are ScriptFlare, an expert YouTube script writer specializing in faceless YouTube channels. You deeply understand YouTube retention psychology, the algorithm, and what makes viewers watch all the way through.

Your scripts always:
- Open with a psychologically powerful hook in the FIRST 15-30 seconds (curiosity gap, bold claim, or surprising statistic)
- Follow a proven emotional arc: open with a relatable pain or curiosity → build tension through revelation → resolve with empowerment or insight
- Follow proven retention structure: Hook → Intro → Main Content (with open loops) → Resolution → CTA
- Include [VISUAL: description] cues throughout for B-roll footage guidance
- Use natural, spoken language — conversational, not formal or essay-style
- Plant and resolve at least one "open loop" (hint at a revelation, deliver it in the final third)
- End each section with a forward-pull transition that makes the viewer lean into the next — never end cold
- Echo a specific phrase or image from the HOOK in the final section to create satisfying, memorable closure
- End with a specific CTA that feels earned, not tacked on

Format EVERY script with these exact headers (plain text — no markdown bold, no asterisks):
[HOOK]
[INTRO]
[SECTION 1: Title]
[SECTION 2: Title]
[SECTION 3: Title]
(add more [SECTION N: Title] headers as needed to hit the target length)
[CALL TO ACTION]

CRITICAL FORMATTING RULES:
- Write headers exactly as shown: [HOOK] not **[HOOK]**, [SECTION 1: Title] not **SECTION 1**
- Every [VISUAL: ...] cue must be on its own line
- Do not use asterisks, hashes, or any markdown formatting in the spoken text`;

  const userPrompt = `Create a complete ${length}-minute faceless YouTube script.

Topic: "${topic}"
Niche: ${niche}
Target audience: ${audience}
Tone/Style: ${tone}
Target word count: approximately ${wordCount} words${nicheNote}

Script requirements:
- Hook must grip attention in the first 3 seconds — curiosity, bold claim, or a stat that stops scrolling
- Include 6–10 [VISUAL: ...] cues spread throughout for B-roll pacing
- Plant an open loop early ("By the end of this video, you'll know exactly why...") and resolve it in the second half
- Close each section with a one-sentence forward-pull that gives the viewer a reason to keep watching
- Use mid-video retention phrases at least 3 times to prevent click-off
- Use specific numbers, names, dates, and concrete details — never vague terms like "many", "some", or "a lot"
- Language must sound natural when read aloud — short sentences, active voice, no corporate jargon

Write the complete, production-ready script now:`;

  const response = await axios.post(API_URL, {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 4000,
    temperature: 0.82,
  }, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  });

  const content = response.data.choices[0].message.content as string;
  const wordCount2 = content.split(/\s+/).length;
  const qualityScore = scoreScript(content);

  return { content, wordCount: wordCount2, qualityScore };
}

/**
 * Score a script on quality (0-100)
 */
function scoreScript(script: string): number {
  let score = 50; // base
  const lower = script.toLowerCase();

  if (/\[hook\]/i.test(script)) score += 10;
  if (/\[intro\]/i.test(script)) score += 5;
  if (/\[call to action\]/i.test(script)) score += 10;

  const brollCount = (script.match(/\[VISUAL:/gi) || []).length;
  score += Math.min(brollCount * 2, 10);

  const openLoopPhrases = ['by the end of this video', 'stay with me', 'here\'s where it gets', 'but wait'];
  if (openLoopPhrases.some(p => lower.includes(p))) score += 5;

  const retentionPhrases = ['but here\'s the thing', 'now here\'s what most people miss', 'stay tuned', 'coming up'];
  const retentionCount = retentionPhrases.filter(p => lower.includes(p)).length;
  score += Math.min(retentionCount * 2, 10);

  return Math.min(score, 100);
}

/**
 * Analyze a YouTube channel and return a structured profile using GPT-4o
 */
export async function analyzeChannelProfile(titles: string[], tags: string[]): Promise<{
  niche: string;
  top_keywords: string[];
  style_notes: string;
  avoid_topics: string[];
  channel_summary: string;
}> {
  const systemPrompt = `You are a YouTube channel analyst. Given a list of video titles and tags from a channel, identify the channel's content strategy and voice.`;

  const userPrompt = `Analyze these video titles and tags from a YouTube channel.

Video titles (top 50 by views):
${titles.slice(0, 50).map((t, i) => `${i + 1}. ${t}`).join('\n')}

Tags used across videos:
${tags.slice(0, 100).join(', ')}

Return a JSON object with these exact fields:
{
  "niche": "one-line description of the channel's primary content niche",
  "top_keywords": ["keyword1", "keyword2", ...up to 15 keywords that define this channel's content"],
  "style_notes": "2-3 sentences describing the channel's tone, style, and what makes their content work",
  "avoid_topics": ["topic1", "topic2", ...topics this channel clearly avoids or that would be off-brand],
  "channel_summary": "one paragraph summary of the channel's brand, audience, and content pillars"
}

Return ONLY the JSON object, no other text.`;

  const response = await axios.post(API_URL, {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 1000,
    temperature: 0.3,
  }, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });

  const raw = response.data.choices[0].message.content as string;

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    return JSON.parse(jsonMatch[0]);
  } catch {
    return {
      niche: 'general content',
      top_keywords: [],
      style_notes: 'Could not analyze channel profile.',
      avoid_topics: [],
      channel_summary: 'Channel profile analysis failed.',
    };
  }
}

/**
 * Pick the best topic from a list, tailored to a channel's profile
 */
export async function pickBestTopics(
  trendingTopics: string[],
  channelKeywords: string[],
  channelNiche: string,
  count = 3,
): Promise<string[]> {
  if (trendingTopics.length === 0) return [];

  const systemPrompt = `You are a YouTube content strategist. Given trending topics and a channel's profile, select the best topics to cover.`;

  const userPrompt = `Channel niche: ${channelNiche}
Channel keywords: ${channelKeywords.join(', ')}

Trending topics this week:
${trendingTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Select the ${count} best topics for this channel to cover. Return ONLY a JSON array of the selected topic titles, in order of recommendation (best first). Example: ["Topic A", "Topic B", "Topic C"]`;

  const response = await axios.post(API_URL, {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 300,
    temperature: 0.4,
  }, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  const raw = response.data.choices[0].message.content as string;

  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array found');
    const topics = JSON.parse(jsonMatch[0]) as string[];
    return topics.slice(0, count);
  } catch {
    // Fall back to first N topics
    return trendingTopics.slice(0, count);
  }
}
