import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { createItem, listItems } from '../items/index.js';
import { createChildLogger } from '../../logger.js';
import { queryMany } from '../../db/db.js';
import type { ItemInput, Item, Relationship } from '../items/index.js';

const log = createChildLogger({ module: 'csv-service' });

/**
 * Maximum CSV file size: 10 MB
 * Requirements: 13.5
 */
export const MAX_CSV_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Maximum number of data rows (excluding header)
 * Requirements: 13.5
 */
export const MAX_CSV_ROWS = 5000;

/**
 * Required header column
 * Requirements: 13.2
 */
export const REQUIRED_HEADER = 'content';

/**
 * Optional recognized header columns
 * Requirements: 13.2
 */
export const OPTIONAL_HEADERS = ['content_type', 'tags', 'metadata'];

/**
 * All recognized header columns
 */
export const RECOGNIZED_HEADERS = [REQUIRED_HEADER, ...OPTIONAL_HEADERS];

/**
 * Result of a CSV import operation.
 * Requirements: 13.10
 */
export interface CsvImportResult {
  itemsCreated: number;
  rowsSkipped: number;
  skippedRowNumbers: number[];
  errors: Array<{ row: number; reason: string }>;
}

/**
 * Validation result for CSV operations
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Parsed row result — either valid data or a skip marker
 */
export interface ParsedRow {
  type: 'parsed';
  data: ItemInput;
}

export interface SkippedRow {
  type: 'skipped';
  rowNumber: number;
  reason: string;
}

/**
 * Validates the CSV header row contains the required "content" column.
 * Requirements: 13.2
 *
 * @param headers - Array of header column names from the CSV
 * @returns ValidationResult indicating if headers are valid
 */
export function validateCsvStructure(headers: string[]): ValidationResult {
  if (!headers || headers.length === 0) {
    return { valid: false, error: 'CSV file has no header row' };
  }

  // Normalize headers to lowercase and trim
  const normalizedHeaders = headers.map((h) => h.toLowerCase().trim());

  if (!normalizedHeaders.includes(REQUIRED_HEADER)) {
    return {
      valid: false,
      error:
        'CSV file must contain a "content" column in the header row',
    };
  }

  return { valid: true };
}

/**
 * Validates the CSV file size and row count against limits.
 * Requirements: 13.5, 13.6
 *
 * @param fileSize - Size of the CSV file in bytes
 * @param rowCount - Number of data rows (excluding header)
 * @returns ValidationResult indicating if size/rows are within limits
 */
export function validateCsvSize(
  fileSize: number,
  rowCount: number
): ValidationResult {
  if (fileSize > MAX_CSV_FILE_SIZE) {
    return {
      valid: false,
      error: `CSV file exceeds the maximum size of 10 MB (file is ${(fileSize / (1024 * 1024)).toFixed(2)} MB)`,
    };
  }

  if (rowCount > MAX_CSV_ROWS) {
    return {
      valid: false,
      error: `CSV file exceeds the maximum of 5000 rows (file has ${rowCount} rows)`,
    };
  }

  return { valid: true };
}

/**
 * Parses an individual CSV row into item data or marks it as skipped.
 * Rows with missing or empty "content" values are skipped.
 * Requirements: 13.3
 *
 * @param row - Key-value object representing a CSV row
 * @param rowIndex - 1-based row number (relative to data rows, not header)
 * @returns ParsedRow with item data, or SkippedRow with reason
 */
export function parseRow(
  row: Record<string, string>,
  rowIndex: number
): ParsedRow | SkippedRow {
  // Normalize keys to lowercase
  const normalizedRow: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    normalizedRow[key.toLowerCase().trim()] = value;
  }

  const content = normalizedRow['content'];

  // Skip rows with missing or empty content
  if (!content || content.trim().length === 0) {
    return {
      type: 'skipped',
      rowNumber: rowIndex,
      reason: 'Missing or empty content value',
    };
  }

  // Build items input
  const itemInput: ItemInput = {
    content: content.trim(),
    source_channel: 'csv_import',
  };

  // Optional: content_type
  if (normalizedRow['content_type'] && normalizedRow['content_type'].trim()) {
    itemInput.content_type = normalizedRow['content_type'].trim() as ItemInput['content_type'];
  }

  // Optional: metadata (expect JSON string)
  if (normalizedRow['metadata'] && normalizedRow['metadata'].trim()) {
    try {
      const parsed = JSON.parse(normalizedRow['metadata'].trim());
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        itemInput.metadata = parsed;
      }
    } catch {
      // Invalid metadata JSON — still create item, just ignore metadata
    }
  }

  // Optional: tags stored in metadata
  if (normalizedRow['tags'] && normalizedRow['tags'].trim()) {
    const tags = normalizedRow['tags']
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (tags.length > 0) {
      itemInput.metadata = {
        ...(itemInput.metadata || {}),
        tags,
      };
    }
  }

  return { type: 'parsed', data: itemInput };
}

/**
 * Orchestrates the full CSV import process:
 * 1. Validates file size
 * 2. Parses CSV content
 * 3. Validates header structure
 * 4. Validates row count
 * 5. Parses each row, skipping empty content
 * 6. Creates items in bulk
 * 7. Returns summary result
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.10
 *
 * @param userId - Authenticated user ID
 * @param fileBuffer - Raw CSV file buffer
 * @returns CsvImportResult with creation/skip counts
 */
export async function importCsv(
  userId: string,
  fileBuffer: Buffer
): Promise<CsvImportResult> {
  const fileSize = fileBuffer.length;

  // Step 1: Validate file size upfront
  const sizeCheck = validateCsvSize(fileSize, 0);
  if (!sizeCheck.valid) {
    const error = new Error(sizeCheck.error!);
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  // Step 2: Parse CSV content
  let records: Record<string, string>[];
  let headers: string[];

  try {
    const csvContent = fileBuffer.toString('utf-8');
    records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Record<string, string>[];

    // Extract headers from the first parse
    const headerLine = csvContent.split(/\r?\n/)[0];
    headers = headerLine
      ? headerLine.split(',').map((h) => h.trim().replace(/^"|"$/g, ''))
      : [];
  } catch (parseError: unknown) {
    const err = parseError as Error & { lines?: number };
    // Extract line number info from csv-parse errors if available
    const lineMatch = err.message.match(/line\s+(\d+)/i);
    const lineInfo = lineMatch ? `line ${lineMatch[1]}` : 'unknown location';
    const error = new Error(
      `Malformed CSV: ${err.message} (at ${lineInfo})`
    );
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  // Step 3: Validate header structure
  const structureCheck = validateCsvStructure(headers);
  if (!structureCheck.valid) {
    const error = new Error(structureCheck.error!);
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  // Step 4: Validate row count
  const rowCountCheck = validateCsvSize(fileSize, records.length);
  if (!rowCountCheck.valid) {
    const error = new Error(rowCountCheck.error!);
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  // Step 5: Parse rows and create items
  const result: CsvImportResult = {
    itemsCreated: 0,
    rowsSkipped: 0,
    skippedRowNumbers: [],
    errors: [],
  };

  for (let i = 0; i < records.length; i++) {
    const rowNumber = i + 2; // +2 because row 1 is header, data starts at row 2
    const parsed = parseRow(records[i], rowNumber);

    if (parsed.type === 'skipped') {
      result.rowsSkipped++;
      result.skippedRowNumbers.push(parsed.rowNumber);
      continue;
    }

    // Step 6: Create item
    try {
      await createItem(userId, parsed.data);
      result.itemsCreated++;
    } catch (itemError: unknown) {
      const err = itemError as Error;
      result.errors.push({
        row: rowNumber,
        reason: `Failed to create item: ${err.message}`,
      });
      result.rowsSkipped++;
      result.skippedRowNumbers.push(rowNumber);
    }
  }

  log.info(
    {
      userId,
      itemsCreated: result.itemsCreated,
      rowsSkipped: result.rowsSkipped,
    },
    'CSV import completed'
  );

  return result;
}


/**
 * Exports all of a user's items as a CSV buffer.
 * Columns: content, content_type, tags, creation_date, metadata
 *
 * Requirements: 13.7, 13.9
 *
 * @param userId - Authenticated user ID
 * @returns Buffer containing the CSV file content
 */
export async function exportItems(userId: string): Promise<Buffer> {
  // Fetch all user items (paginate internally to get them all)
  const allItems: Item[] = [];
  let page = 1;
  const pageSize = 100;
  let hasMore = true;

  while (hasMore) {
    const result = await listItems(userId, { page, page_size: pageSize });
    allItems.push(...result.items);
    hasMore = result.page < result.total_pages;
    page++;
  }

  // Build CSV rows
  const rows = allItems.map((item) => {
    // Extract tags from metadata if available
    const tags = item.metadata && Array.isArray(item.metadata.tags)
      ? (item.metadata.tags as string[]).join(',')
      : '';

    // Serialize metadata (excluding tags since they have their own column)
    let metadataStr = '';
    if (item.metadata) {
      const { tags: _tags, ...rest } = item.metadata;
      if (Object.keys(rest).length > 0) {
        metadataStr = JSON.stringify(rest);
      }
    }

    return {
      content: item.content,
      content_type: item.content_type,
      tags,
      creation_date: item.created_at.toISOString ? item.created_at.toISOString() : String(item.created_at),
      metadata: metadataStr,
    };
  });

  const csv = stringify(rows, {
    header: true,
    columns: ['content', 'content_type', 'tags', 'creation_date', 'metadata'],
  });

  log.info({ userId, itemCount: allItems.length }, 'CSV items export completed');

  return Buffer.from(csv, 'utf-8');
}

/**
 * Exports all relationships (maps) for a user's items as a CSV buffer.
 * Columns: source_item_id, target_item_id, relationship_type, confidence_score
 *
 * Requirements: 13.8, 13.9
 *
 * @param userId - Authenticated user ID
 * @returns Buffer containing the CSV file content
 */
export async function exportMaps(userId: string): Promise<Buffer> {
  // Query all relationships where both source and target items belong to this user
  const relationships = await queryMany<Relationship>(
    `SELECT r.id, r.source_item_id, r.target_item_id, r.relationship_type, r.strength, r.created_at
     FROM relationships r
     JOIN items src ON r.source_item_id = src.id AND src.user_id = $1 AND src.is_deleted = false
     JOIN items tgt ON r.target_item_id = tgt.id AND tgt.user_id = $1 AND tgt.is_deleted = false`,
    [userId]
  );

  // Build CSV rows
  const rows = relationships.map((rel) => ({
    source_item_id: rel.source_item_id,
    target_item_id: rel.target_item_id,
    relationship_type: rel.relationship_type,
    confidence_score: String(rel.strength),
  }));

  const csv = stringify(rows, {
    header: true,
    columns: ['source_item_id', 'target_item_id', 'relationship_type', 'confidence_score'],
  });

  log.info({ userId, relationshipCount: relationships.length }, 'CSV maps export completed');

  return Buffer.from(csv, 'utf-8');
}

/**
 * Returns a CSV template file with headers and 2 example rows.
 * This helps users understand the expected format for CSV imports.
 *
 * Requirements: 13.12, 13.13
 *
 * @returns Buffer containing the CSV template content
 */
export function getTemplate(): Buffer {
  const exampleRows = [
    {
      content: 'Example note about project ideas',
      content_type: 'note',
      tags: 'project,ideas,brainstorm',
      metadata: '{"priority":"high","source":"meeting"}',
    },
    {
      content: 'https://example.com/interesting-article',
      content_type: 'link',
      tags: 'reading,research',
      metadata: '{"author":"Jane Doe"}',
    },
  ];

  const csv = stringify(exampleRows, {
    header: true,
    columns: ['content', 'content_type', 'tags', 'metadata'],
  });

  return Buffer.from(csv, 'utf-8');
}
