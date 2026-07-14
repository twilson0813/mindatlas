import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@notionhq/client';

// Create shared mock methods using vi.hoisted so they're available when vi.mock factory runs
const { mockPagesRetrieve, mockPagesCreate, mockBlocksChildrenList } = vi.hoisted(() => ({
  mockPagesRetrieve: vi.fn(),
  mockPagesCreate: vi.fn(),
  mockBlocksChildrenList: vi.fn(),
}));

// Mock dependencies before importing the module under test
vi.mock('@notionhq/client', () => ({
  Client: vi.fn().mockImplementation(() => ({
    pages: {
      retrieve: mockPagesRetrieve,
      create: mockPagesCreate,
    },
    blocks: {
      children: {
        list: mockBlocksChildrenList,
      },
    },
  })),
}));

vi.mock('../../db/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

vi.mock('../../utils/encryption.js', () => ({
  encrypt: vi.fn((val: string) => `encrypted_${val}`),
  decrypt: vi.fn((val: string) => val.replace('encrypted_', '')),
}));

vi.mock('../items/index.js', () => ({
  createItem: vi.fn(),
  getItem: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  config: {
    notionClientId: 'test-client-id',
    notionClientSecret: 'test-client-secret',
    notionRedirectUri: 'http://localhost:3000/api/integrations/notion/callback',
    encryptionMasterKey: 'dev-encryption-key-32-bytes-long!',
  },
}));

vi.mock('../../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { queryOne, query } from '../../db/db.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { createItem, getItem } from '../items/index.js';
import {
  connectNotion,
  importFromNotion,
  exportToNotion,
  getConnection,
  disconnectNotion,
} from './notion.js';

describe('Notion Integration Service', () => {
  beforeEach(() => {
    // Reset specific mocks but preserve the Client factory
    mockPagesRetrieve.mockReset();
    mockPagesCreate.mockReset();
    mockBlocksChildrenList.mockReset();
    (queryOne as ReturnType<typeof vi.fn>).mockReset();
    (query as ReturnType<typeof vi.fn>).mockReset();
    (createItem as ReturnType<typeof vi.fn>).mockReset();
    (getItem as ReturnType<typeof vi.fn>).mockReset();
    // Re-establish encrypt/decrypt implementations
    (encrypt as ReturnType<typeof vi.fn>).mockImplementation((val: string) => `encrypted_${val}`);
    (decrypt as ReturnType<typeof vi.fn>).mockImplementation((val: string) => val.replace('encrypted_', ''));
    // Restore Client mock implementation
    (Client as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      pages: {
        retrieve: mockPagesRetrieve,
        create: mockPagesCreate,
      },
      blocks: {
        children: {
          list: mockBlocksChildrenList,
        },
      },
    }));
    // Mock global fetch for OAuth token exchange
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('connectNotion', () => {
    it('should reject empty authorization code', async () => {
      await expect(connectNotion('user-1', '')).rejects.toMatchObject({
        message: 'Authorization code is required',
        statusCode: 400,
      });
    });

    it('should reject null/undefined authorization code', async () => {
      await expect(connectNotion('user-1', null as any)).rejects.toMatchObject({
        message: 'Authorization code is required',
        statusCode: 400,
      });
    });

    it('should exchange code for token and store encrypted connection', async () => {
      const mockTokenResponse = {
        access_token: 'ntn_test_token_123',
        workspace_id: 'ws-123',
        workspace_name: 'Test Workspace',
        bot_id: 'bot-1',
        token_type: 'bearer',
      };

      // Mock fetch for OAuth token exchange
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse,
      });

      // Mock database upsert
      const mockRow = {
        id: 'conn-1',
        user_id: 'user-1',
        access_token_encrypted: 'encrypted_ntn_test_token_123',
        workspace_id: 'ws-123',
        workspace_name: 'Test Workspace',
        connected_at: new Date('2024-01-01'),
      };
      (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRow);

      const result = await connectNotion('user-1', 'oauth_code_abc');

      // Verify token exchange was called
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/oauth/token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28',
          }),
        })
      );

      // Verify encryption was called on the token
      expect(encrypt).toHaveBeenCalledWith('ntn_test_token_123');

      // Verify the DB insert was called with encrypted token
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notion_connections'),
        ['user-1', 'encrypted_ntn_test_token_123', 'ws-123', 'Test Workspace']
      );

      // Verify response
      expect(result).toEqual({
        id: 'conn-1',
        workspace_id: 'ws-123',
        workspace_name: 'Test Workspace',
        connected_at: new Date('2024-01-01'),
      });
    });

    it('should throw 502 when Notion API rejects the code', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid code',
      });

      await expect(connectNotion('user-1', 'invalid_code')).rejects.toMatchObject({
        message: 'Failed to exchange authorization code with Notion',
        statusCode: 502,
      });
    });
  });

  describe('importFromNotion', () => {
    it('should reject empty page_ids array', async () => {
      await expect(importFromNotion('user-1', [])).rejects.toMatchObject({
        message: 'At least one page ID is required',
        statusCode: 400,
      });
    });

    it('should reject missing page_ids', async () => {
      await expect(importFromNotion('user-1', null as any)).rejects.toMatchObject({
        message: 'At least one page ID is required',
        statusCode: 400,
      });
    });

    it('should throw 404 when no Notion connection exists', async () => {
      (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await expect(importFromNotion('user-1', ['page-1'])).rejects.toMatchObject({
        message: 'No Notion workspace connected. Please connect first.',
        statusCode: 404,
      });
    });

    it('should import pages and create items', async () => {
      // Mock getNotionClient (queryOne for connection lookup)
      (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'conn-1',
        user_id: 'user-1',
        access_token_encrypted: 'encrypted_token123',
        workspace_id: 'ws-1',
        workspace_name: 'Workspace',
        connected_at: new Date(),
      });

      // Mock pages.retrieve
      mockPagesRetrieve.mockResolvedValueOnce({
        id: 'page-1',
        properties: {
          title: {
            type: 'title',
            title: [{ plain_text: 'Test Page' }],
          },
        },
      });

      // Mock blocks.children.list
      mockBlocksChildrenList.mockResolvedValueOnce({
        results: [
          {
            type: 'paragraph',
            paragraph: {
              rich_text: [{ plain_text: 'Hello from Notion' }],
            },
          },
        ],
      });

      // Mock createItem
      const mockItem = {
        id: 'item-1',
        user_id: 'user-1',
        title: 'Test Page',
        content: 'Hello from Notion',
        content_type: 'note',
        metadata: { notion_page_id: 'page-1', import_source: 'notion' },
        source_channel: 'notion',
        source_domain: 'notion.so',
        file_path: null,
        file_size: null,
        is_deleted: false,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      (createItem as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockItem);

      const result = await importFromNotion('user-1', ['page-1']);

      expect(result.items_imported).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Test Page');
      expect(createItem).toHaveBeenCalledWith('user-1', expect.objectContaining({
        content: 'Hello from Notion',
        content_type: 'note',
        title: 'Test Page',
        source_channel: 'notion',
      }));
    });

    it('should continue importing other pages when one fails', async () => {
      // Mock connection
      (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'conn-1',
        user_id: 'user-1',
        access_token_encrypted: 'encrypted_token',
        workspace_id: 'ws-1',
        workspace_name: 'Workspace',
        connected_at: new Date(),
      });

      // First page fails
      mockPagesRetrieve
        .mockRejectedValueOnce(new Error('Not found'))
        .mockResolvedValueOnce({
          id: 'page-2',
          properties: {
            Name: { type: 'title', title: [{ plain_text: 'Page 2' }] },
          },
        });

      mockBlocksChildrenList
        .mockResolvedValueOnce({
          results: [
            {
              type: 'paragraph',
              paragraph: { rich_text: [{ plain_text: 'Content 2' }] },
            },
          ],
        });

      const mockItem = {
        id: 'item-2',
        user_id: 'user-1',
        title: 'Page 2',
        content: 'Content 2',
        content_type: 'note',
        metadata: {},
        source_channel: 'notion',
        source_domain: 'notion.so',
        file_path: null,
        file_size: null,
        is_deleted: false,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      (createItem as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockItem);

      const result = await importFromNotion('user-1', ['page-1', 'page-2']);

      // Only the second page should be imported successfully
      expect(result.items_imported).toBe(1);
      expect(result.items[0].title).toBe('Page 2');
    });
  });

  describe('exportToNotion', () => {
    it('should reject empty item_ids array', async () => {
      await expect(exportToNotion('user-1', [])).rejects.toMatchObject({
        message: 'At least one item ID is required',
        statusCode: 400,
      });
    });

    it('should reject missing item_ids', async () => {
      await expect(exportToNotion('user-1', undefined as any)).rejects.toMatchObject({
        message: 'At least one item ID is required',
        statusCode: 400,
      });
    });

    it('should throw 404 when no Notion connection exists', async () => {
      (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await expect(exportToNotion('user-1', ['item-1'])).rejects.toMatchObject({
        message: 'No Notion workspace connected. Please connect first.',
        statusCode: 404,
      });
    });

    it('should export items as Notion pages', async () => {
      // Mock getNotionClient
      (queryOne as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          id: 'conn-1',
          user_id: 'user-1',
          access_token_encrypted: 'encrypted_token',
          workspace_id: 'ws-1',
          workspace_name: 'Workspace',
          connected_at: new Date(),
        })
        // Mock getConnection
        .mockResolvedValueOnce({
          id: 'conn-1',
          user_id: 'user-1',
          access_token_encrypted: 'encrypted_token',
          workspace_id: 'ws-1',
          workspace_name: 'Workspace',
          connected_at: new Date(),
        });

      // Mock getItem
      (getItem as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'item-1',
        user_id: 'user-1',
        title: 'My Item',
        content: 'Some content here',
        content_type: 'note',
        metadata: null,
        source_channel: 'web',
        source_domain: null,
        file_path: null,
        file_size: null,
        is_deleted: false,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Mock pages.create
      mockPagesCreate.mockResolvedValueOnce({
        id: 'notion-page-id-1',
      });

      const result = await exportToNotion('user-1', ['item-1']);

      expect(result.pages_created).toBe(1);
      expect(result.page_ids).toEqual(['notion-page-id-1']);
    });
  });

  describe('getConnection', () => {
    it('should return connection when it exists', async () => {
      (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'conn-1',
        user_id: 'user-1',
        access_token_encrypted: 'encrypted_token',
        workspace_id: 'ws-1',
        workspace_name: 'My Workspace',
        connected_at: new Date('2024-06-01'),
      });

      const result = await getConnection('user-1');
      expect(result).toEqual({
        id: 'conn-1',
        workspace_id: 'ws-1',
        workspace_name: 'My Workspace',
        connected_at: new Date('2024-06-01'),
      });
    });

    it('should throw 404 when no connection exists', async () => {
      (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await expect(getConnection('user-1')).rejects.toMatchObject({
        message: 'No Notion workspace connected. Please connect first.',
        statusCode: 404,
      });
    });
  });

  describe('disconnectNotion', () => {
    it('should delete connection when it exists', async () => {
      (query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rowCount: 1 });

      await expect(disconnectNotion('user-1')).resolves.toBeUndefined();
      expect(query).toHaveBeenCalledWith(
        'DELETE FROM notion_connections WHERE user_id = $1',
        ['user-1']
      );
    });

    it('should throw 404 when no connection to disconnect', async () => {
      (query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rowCount: 0 });

      await expect(disconnectNotion('user-1')).rejects.toMatchObject({
        message: 'No Notion connection found',
        statusCode: 404,
      });
    });
  });
});
