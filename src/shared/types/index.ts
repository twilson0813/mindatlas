/**
 * Shared type definitions used across server and client.
 */

export interface HealthCheckResponse {
  status: 'ok' | 'error';
  timestamp: string;
  uptime: number;
  environment: string;
}

export type ContentType =
  | 'plain_text'
  | 'link'
  | 'code_snippet'
  | 'note'
  | 'task'
  | 'idea'
  | 'file'
  | 'custom';

export interface ItemInput {
  content: string;
  contentType: ContentType;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface Item {
  id: string;
  userId: string;
  title: string;
  content: string;
  contentType: ContentType;
  metadata: Record<string, unknown>;
  sourceChannel: string;
  sourceDomain?: string;
  filePath?: string;
  fileSize?: number;
  createdAt: string;
  updatedAt: string;
}
