import { Client } from '@notionhq/client';
import {
  getUserIntegration,
  setUserIntegration,
  deleteUserIntegration,
  getPlatformCredentials,
} from '../credentials/index.js';
import { createItem, getItem } from '../items/index.js';
import { createChildLogger } from '../../logger.js';
import type { Item } from '../items/index.js';

const log = createChildLogger({ module: 'notion-integration' });

/**
 * Public representation of a Notion connection (no token exposed).
 */
export interface NotionConnection {
  workspace_id: string;
  workspace_name: string | null;
  connected_at: string | null;
}

/**
 * Result from the Notion OAuth token exchange.
 */
export interface NotionOAuthTokenResponse {
  access_token: string;
  workspace_id: string;
  workspace_name: string;
  bot_id: string;
  token_type: string;
}

/**
 * Notion OAuth platform credentials shape.
 * Stored in platform_credentials with provider "notion_oauth".
 */
export interface NotionOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Result of importing Notion pages.
 */
export interface NotionImportResult {
  items_imported: number;
  items: Item[];
}

/**
 * Result of exporting items to Notion.
 */
export interface NotionExportResult {
  pages_created: number;
  page_ids: string[];
}

/**
 * Exchange an OAuth authorization code with Notion for an access token.
 * Stores the connection via the credential store service.
 *
 * Requirements: 9.3, 5.3
 *
 * @param userId - The authenticated user establishing the connection
 * @param code - The OAuth authorization code from Notion
 */
export async function connectNotion(userId: string, code: string): Promise<NotionConnection> {
  if (!code || typeof code !== 'string' || code.trim() === '') {
    const error = new Error('Authorization code is required') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  // Exchange the authorization code for an access token
  const tokenResponse = await exchangeCodeForToken(code);

  // Store credentials and metadata via the credential store
  await setUserIntegration(
    userId,
    'notion',
    { accessToken: tokenResponse.access_token },
    { workspace_id: tokenResponse.workspace_id, workspace_name: tokenResponse.workspace_name },
  );

  log.info({ userId, workspaceId: tokenResponse.workspace_id }, 'Notion workspace connected');

  return {
    workspace_id: tokenResponse.workspace_id,
    workspace_name: tokenResponse.workspace_name,
    connected_at: new Date().toISOString(),
  };
}

/**
 * Import selected Notion pages as Items.
 * Fetches page content from Notion and creates items in MindAtlas.
 *
 * Requirements: 9.4
 *
 * @param userId - The authenticated user
 * @param pageIds - Array of Notion page IDs to import
 * @returns Import result with created items
 */
export async function importFromNotion(
  userId: string,
  pageIds: string[],
): Promise<NotionImportResult> {
  if (!pageIds || !Array.isArray(pageIds) || pageIds.length === 0) {
    const error = new Error('At least one page ID is required') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  const client = await getNotionClient(userId);
  const importedItems: Item[] = [];

  for (const pageId of pageIds) {
    try {
      // Retrieve the page metadata
      const page = await client.pages.retrieve({ page_id: pageId });

      // Extract title from page properties
      const title = extractPageTitle(page);

      // Retrieve page content blocks
      const blocks = await client.blocks.children.list({ block_id: pageId });
      const content = extractBlocksContent(blocks.results);

      // Create an item from the imported page
      const item = await createItem(userId, {
        content: content || title || 'Imported from Notion',
        content_type: 'note',
        title: title || `Notion Page ${pageId}`,
        metadata: {
          notion_page_id: pageId,
          import_source: 'notion',
        },
        source_channel: 'notion',
        source_domain: 'notion.so',
      });

      importedItems.push(item);
      log.info({ userId, pageId, itemId: item.id }, 'Notion page imported');
    } catch (err) {
      log.warn({ userId, pageId, error: (err as Error).message }, 'Failed to import Notion page');
      // Continue importing other pages even if one fails
    }
  }

  return {
    items_imported: importedItems.length,
    items: importedItems,
  };
}

/**
 * Export items to a connected Notion workspace.
 * Creates Notion pages from selected MindAtlas items.
 *
 * Requirements: 9.5
 *
 * @param userId - The authenticated user
 * @param itemIds - Array of item IDs to export
 * @returns Export result with created page IDs
 */
export async function exportToNotion(
  userId: string,
  itemIds: string[],
): Promise<NotionExportResult> {
  if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
    const error = new Error('At least one item ID is required') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  const client = await getNotionClient(userId);

  const createdPageIds: string[] = [];

  for (const itemId of itemIds) {
    try {
      // Fetch the item (with ownership check via the items service)
      const item = await getItem(userId, itemId);

      // Create a page in Notion
      const response = await client.pages.create({
        parent: { workspace: true } as any,
        properties: {
          title: {
            title: [
              {
                text: {
                  content: item.title || 'MindAtlas Item',
                },
              },
            ],
          },
        },
        children: [
          {
            object: 'block' as const,
            type: 'paragraph' as const,
            paragraph: {
              rich_text: [
                {
                  type: 'text' as const,
                  text: {
                    content: item.content,
                  },
                },
              ],
            },
          },
        ],
      });

      createdPageIds.push(response.id);
      log.info({ userId, itemId, notionPageId: response.id }, 'Item exported to Notion');
    } catch (err) {
      log.warn(
        { userId, itemId, error: (err as Error).message },
        'Failed to export item to Notion',
      );
      // Continue exporting other items even if one fails
    }
  }

  return {
    pages_created: createdPageIds.length,
    page_ids: createdPageIds,
  };
}

/**
 * Get the Notion connection for a user, or throw if not connected.
 */
export async function getConnection(userId: string): Promise<NotionConnection> {
  const integration = await getUserIntegration(userId, 'notion');

  if (!integration) {
    const error = new Error('No Notion workspace connected. Please connect first.') as Error & {
      statusCode?: number;
    };
    error.statusCode = 404;
    throw error;
  }

  const { metadata } = integration;

  return {
    workspace_id: (metadata?.workspace_id as string) || '',
    workspace_name: (metadata?.workspace_name as string) || null,
    connected_at: (metadata?.connected_at as string) || null,
  };
}

/**
 * Disconnect Notion by removing the stored connection.
 */
export async function disconnectNotion(userId: string): Promise<void> {
  const integration = await getUserIntegration(userId, 'notion');

  if (!integration) {
    const error = new Error('No Notion connection found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  await deleteUserIntegration(userId, 'notion');
  log.info({ userId }, 'Notion workspace disconnected');
}

// --- Internal helpers ---

/**
 * Exchange an OAuth authorization code for an access token with Notion's API.
 * Retrieves Notion OAuth client credentials from platform_credentials table.
 */
async function exchangeCodeForToken(code: string): Promise<NotionOAuthTokenResponse> {
  let notionOAuth: NotionOAuthConfig;
  try {
    notionOAuth = (await getPlatformCredentials(
      'notion_oauth' as any,
    )) as unknown as NotionOAuthConfig;
  } catch {
    const error = new Error('Notion integration is not configured') as Error & {
      statusCode?: number;
    };
    error.statusCode = 503;
    throw error;
  }

  const credentials = Buffer.from(`${notionOAuth.clientId}:${notionOAuth.clientSecret}`).toString(
    'base64',
  );

  const response = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: notionOAuth.redirectUri,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    log.error({ status: response.status, body: errorBody }, 'Notion OAuth token exchange failed');
    const error = new Error('Failed to exchange authorization code with Notion') as Error & {
      statusCode?: number;
    };
    error.statusCode = 502;
    throw error;
  }

  const data = (await response.json()) as NotionOAuthTokenResponse;
  return data;
}

/**
 * Get an authenticated Notion client for a user.
 * Retrieves decrypted access token from the credential store.
 */
async function getNotionClient(userId: string): Promise<Client> {
  const integration = await getUserIntegration(userId, 'notion');

  if (!integration) {
    const error = new Error('No Notion workspace connected. Please connect first.') as Error & {
      statusCode?: number;
    };
    error.statusCode = 404;
    throw error;
  }

  const { credentials } = integration;

  return new Client({ auth: credentials.accessToken });
}

/**
 * Extract the title from a Notion page object.
 */
function extractPageTitle(page: any): string {
  try {
    const properties = page.properties || {};
    // Try common title property names
    for (const key of ['title', 'Title', 'Name', 'name']) {
      const prop = properties[key];
      if (prop?.title && Array.isArray(prop.title)) {
        return prop.title.map((t: any) => t.plain_text || '').join('');
      }
    }
    // Fallback: iterate all properties looking for a title type
    for (const prop of Object.values(properties)) {
      if ((prop as any)?.type === 'title' && Array.isArray((prop as any).title)) {
        return (prop as any).title.map((t: any) => t.plain_text || '').join('');
      }
    }
  } catch {
    // Ignore extraction errors
  }
  return '';
}

/**
 * Extract text content from Notion blocks.
 * Supports paragraph, heading, bulleted_list_item, numbered_list_item, and to_do blocks.
 */
function extractBlocksContent(blocks: any[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    const type = block.type;
    const blockData = block[type];

    if (!blockData) continue;

    if (blockData.rich_text && Array.isArray(blockData.rich_text)) {
      const text = blockData.rich_text.map((rt: any) => rt.plain_text || '').join('');
      if (text) {
        switch (type) {
          case 'heading_1':
            lines.push(`# ${text}`);
            break;
          case 'heading_2':
            lines.push(`## ${text}`);
            break;
          case 'heading_3':
            lines.push(`### ${text}`);
            break;
          case 'bulleted_list_item':
            lines.push(`• ${text}`);
            break;
          case 'numbered_list_item':
            lines.push(`- ${text}`);
            break;
          case 'to_do':
            const checked = blockData.checked ? '✓' : '○';
            lines.push(`${checked} ${text}`);
            break;
          default:
            lines.push(text);
        }
      }
    }
  }

  return lines.join('\n');
}
