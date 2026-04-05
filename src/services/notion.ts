import { Client } from '@notionhq/client';

export interface NotionDeliveryParams {
  notionToken: string;
  notionPageId: string;
  topic: string;
  scriptContent: string;
  scriptId: string;
}

/**
 * Deliver a script to Notion as a new page under the user's chosen parent page
 */
export async function deliverToNotion(params: NotionDeliveryParams): Promise<string> {
  const { notionToken, notionPageId, topic, scriptContent, scriptId } = params;

  const notion = new Client({ auth: notionToken });
  const date = new Date().toISOString().split('T')[0];
  const pageTitle = `[ScriptFlare] ${topic} — ${date}`;

  // Convert script content to Notion blocks
  const blocks = scriptToNotionBlocks(scriptContent);

  const response = await notion.pages.create({
    parent: { page_id: notionPageId },
    properties: {
      title: {
        title: [{ text: { content: pageTitle } }],
      },
    },
    children: blocks,
  });

  return (response as any).url || `https://notion.so/${response.id}`;
}

/**
 * Convert a ScriptFlare script (with [HOOK], [SECTION N: Title] headers) into Notion blocks
 */
function scriptToNotionBlocks(script: string): any[] {
  const blocks: any[] = [];
  const lines = script.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      // Empty line → spacer (paragraph with empty text)
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [] },
      });
      continue;
    }

    // Section headers like [HOOK], [INTRO], [CALL TO ACTION], [SECTION N: Title]
    if (/^\[(HOOK|INTRO|CALL TO ACTION|SECTION \d+:.+)\]$/i.test(trimmed)) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: trimmed } }],
        },
      });
      continue;
    }

    // B-roll cues [VISUAL: ...]
    if (/^\[VISUAL:/i.test(trimmed)) {
      blocks.push({
        object: 'block',
        type: 'callout',
        callout: {
          icon: { emoji: '🎬' },
          rich_text: [{ type: 'text', text: { content: trimmed } }],
        },
      });
      continue;
    }

    // Regular paragraph (split long lines into ≤2000 char chunks — Notion limit)
    const chunks = chunkString(trimmed, 2000);
    for (const chunk of chunks) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: chunk } }],
        },
      });
    }
  }

  // Notion API limit: 100 blocks per request (append rest separately if needed)
  return blocks.slice(0, 100);
}

function chunkString(str: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.substring(i, i + size));
  }
  return chunks;
}

/**
 * Verify a Notion token and page ID are valid
 */
export async function verifyNotionAccess(notionToken: string, notionPageId: string): Promise<boolean> {
  try {
    const notion = new Client({ auth: notionToken });
    await notion.pages.retrieve({ page_id: notionPageId });
    return true;
  } catch {
    return false;
  }
}
