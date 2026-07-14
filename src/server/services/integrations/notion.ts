import { Client } from '@notionhq/client';
import { query, queryOne } from '../../db/db.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { createItem, getItem } from '../items/index.js';
import { config } from '../../config.js';
import { createChildLogger } from '../../logger.js';
import type { Item } from '../items/index.js';

const log = createChildLogger({ module: 'notion-integration' });

/**
 * Notion connection row stored in the database.
 */
export interface NotionConnectionRow {
  id: string;
  user_id: string;
  access_token_encrypted: string;
  workspace_id: string;
  workspace_name: string | null;
  connected_at: Date;
}

/**
 * Public representation of a Notion connection (no token exposed).
 */
export interface NotionConnection {
  id: string;
  workspace_id: string;
  workspace_name: string | null;
  connected_at: Date;
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
 * Encrypts the access token and stores the connection in the database.
 *
 * Requirements: 9.3
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

  if (!config.notionClientId || !config.notionClientSecret) {
    const error = new Error('Notion integration is not configured') as Error & { statusCode?: number };
    error.statusCode = 503;
    throw error;
  }

  // Exchange the authorization code for an access token
  const tokenResponse = await exchangeCodeForToken(code);

  // Encrypt the access token before storing
  const accessTokenEncrypted = encrypt(tokenResponse.access_token);

  // Upsert the connection (one connection per user)
  const row = await queryOne<NotionConnectionRow>(
    `INSERT INTO notion_connections (user_id, access_token_encrypted, workspace_id, workspace_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id)
     DO UPDATE SET
       access_token_encrypted = EXCLUDED.access_token_encrypted,
       workspace_id = EXCLUDED.workspace_id,
       workspace_name = EXCLUDED.workspace_name,
       connected_at = NOW()
     RETURNING id, user_id, access_token_encrypted, workspace_id, workspace_name, connected_at`,
    [userId, accessTokenEncrypted, tokenResponse.workspace_id, tokenResponse.workspace_name]
  );

  if (!row) {
    throw new Error('Failed to store Notion connection');
  }

  log.info(
    { userId, workspaceId: tokenResponse.workspace_id },
    'Notion workspace connected'
  );

  return {
    id: row.id,
    workspace_id: row.workspace_id,
    workspace_name: row.workspace_name,
    connected_at: row.connected_at,
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
  pageIds: string[]
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
  itemIds: string[]
): Promise<NotionExportResult> {
  if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
    const error = new Error('At least one item ID is required') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  const client = await getNotionClient(userId);
  const connection = await getConnection(userId);

  // Get the connected workspace's root page (use workspace_id as parent)
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
      log.warn({ userId, itemId, error: (err as Error).message }, 'Failed to export item to Notion');
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
  const row = await queryOne<NotionConnectionRow>(
    `SELECT id, user_id, access_token_encrypted, workspace_id, workspace_name, connected_at
     FROM notion_connections
     WHERE user_id = $1`,
    [userId]
  );

  if (!row) {
    const error = new Error('No Notion workspace connected. Please connect first.') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return {
    id: row.id,
    workspace_id: row.workspace_id,
    workspace_name: row.workspace_name,
    connected_at: row.connected_at,
  };
}

/**
 * Disconnect Notion by removing the stored connection.
 */
export async function disconnectNotion(userId: string): Promise<void> {
  const result = await query(
    `DELETE FROM notion_connections WHERE user_id = $1`,
    [userId]
  );

  if (result.rowCount === 0) {
    const error = new Error('No Notion connection found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  log.info({ userId }, 'Notion workspace disconnected');
}

// --- Internal helpers ---

/**
 * Exchange an OAuth authorization code for an access token with Notion's API.
 * Uses Basic auth with client_id:client_secret.
 */
async function exchangeCodeForToken(code: string): Promise<NotionOAuthTokenResponse> {
  const credentials = Buffer.from(
    `${config.notionClientId}:${config.notionClientSecret}`
  ).toString('base64');

  const response = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.notionRedirectUri,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    log.error({ status: response.status, body: errorBody }, 'Notion OAuth token exchange failed');
    const error = new Error('Failed to exchange authorization code with Notion') as Error & { statusCode?: number };
    error.statusCode = 502;
    throw error;
  }

  const data = (await response.json()) as NotionOAuthTokenResponse;
  return data;
}

/**
 * Get an authenticated Notion client for a user.
 * Decrypts the stored access token and creates a client instance.
 */
async function getNotionClient(userId: string): Promise<Client> {
  const row = await queryOne<NotionConnectionRow>(
    `SELECT id, user_id, access_token_encrypted, workspace_id, workspace_name, connected_at
     FROM notion_connections
     WHERE user_id = $1`,
    [userId]
  );

  if (!row) {
    const error = new Error('No Notion workspace connected. Please connect first.') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const accessToken = decrypt(row.access_token_encrypted);

  return new Client({ auth: accessToken });
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
