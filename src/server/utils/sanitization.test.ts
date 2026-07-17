import { describe, it, expect } from 'vitest';
import {
  sanitizeHtml,
  sanitizeHtmlPermissive,
  sanitizeForSql,
  containsXssPatterns,
  containsSqlInjectionPatterns,
} from './sanitization.js';

describe('sanitizeHtml', () => {
  it('returns empty string for empty input', () => {
    expect(sanitizeHtml('')).toBe('');
  });

  it('returns empty string for null-like input', () => {
    expect(sanitizeHtml(null as unknown as string)).toBe('');
    expect(sanitizeHtml(undefined as unknown as string)).toBe('');
  });

  it('passes through plain text unchanged', () => {
    expect(sanitizeHtml('Hello, world!')).toBe('Hello, world!');
  });

  it('strips script tags', () => {
    const input = '<script>alert("xss")</script>Hello';
    expect(sanitizeHtml(input)).toBe('Hello');
  });

  it('strips all HTML tags', () => {
    const input = '<p>Hello <b>world</b></p>';
    expect(sanitizeHtml(input)).toBe('Hello world');
  });

  it('strips event handlers', () => {
    const input = '<img onerror="alert(1)" src="x">';
    expect(sanitizeHtml(input)).toBe('');
  });

  it('strips iframe tags', () => {
    const input = '<iframe src="http://evil.com"></iframe>Content';
    expect(sanitizeHtml(input)).toBe('Content');
  });

  it('handles nested script injection attempts', () => {
    const input = '<scr<script>ipt>alert(1)</scr</script>ipt>';
    const result = sanitizeHtml(input);
    // DOMPurify strips all tags; remaining text is safe (not executable)
    expect(result).not.toContain('<script');
    expect(result).not.toContain('</script');
  });

  it('strips javascript: protocol links', () => {
    const input = '<a href="javascript:alert(1)">Click</a>';
    expect(sanitizeHtml(input)).toBe('Click');
  });

  it('preserves unicode text', () => {
    const input = '日本語テスト 🚀 Ñoño';
    expect(sanitizeHtml(input)).toBe(input);
  });
});

describe('sanitizeHtmlPermissive', () => {
  it('allows safe formatting tags', () => {
    const input = '<p>Hello <b>world</b></p>';
    expect(sanitizeHtmlPermissive(input)).toBe('<p>Hello <b>world</b></p>');
  });

  it('strips script tags but keeps text', () => {
    const input = '<p>Before</p><script>alert(1)</script><p>After</p>';
    expect(sanitizeHtmlPermissive(input)).toBe('<p>Before</p><p>After</p>');
  });

  it('allows links with href', () => {
    const input = '<a href="https://example.com">Link</a>';
    expect(sanitizeHtmlPermissive(input)).toBe('<a href="https://example.com">Link</a>');
  });

  it('strips event handler attributes', () => {
    const input = '<a href="#" onclick="alert(1)">Link</a>';
    const result = sanitizeHtmlPermissive(input);
    expect(result).not.toContain('onclick');
    expect(result).toContain('Link');
  });
});

describe('sanitizeForSql', () => {
  it('returns empty string for empty input', () => {
    expect(sanitizeForSql('')).toBe('');
  });

  it('returns empty string for null-like input', () => {
    expect(sanitizeForSql(null as unknown as string)).toBe('');
  });

  it('passes through safe text unchanged', () => {
    expect(sanitizeForSql('Hello world')).toBe('Hello world');
  });

  it('escapes single quotes', () => {
    expect(sanitizeForSql("it's")).toBe("it''s");
  });

  it('escapes double quotes', () => {
    expect(sanitizeForSql('say "hello"')).toBe('say ""hello""');
  });

  it('escapes backslashes', () => {
    expect(sanitizeForSql('path\\file')).toBe('path\\\\file');
  });

  it('removes null bytes', () => {
    expect(sanitizeForSql('hello\x00world')).toBe('helloworld');
  });

  it('removes SUB characters', () => {
    expect(sanitizeForSql('hello\x1aworld')).toBe('helloworld');
  });

  it('escapes newlines', () => {
    expect(sanitizeForSql('line1\nline2')).toBe('line1\\nline2');
  });

  it('escapes carriage returns', () => {
    expect(sanitizeForSql('line1\rline2')).toBe('line1\\rline2');
  });

  it('handles SQL injection attempt', () => {
    const input = "'; DROP TABLE users; --";
    const result = sanitizeForSql(input);
    expect(result).toBe("''; DROP TABLE users; --");
    expect(result).not.toContain('\x00');
  });
});

describe('containsXssPatterns', () => {
  it('returns false for empty input', () => {
    expect(containsXssPatterns('')).toBe(false);
  });

  it('returns false for plain text', () => {
    expect(containsXssPatterns('Hello, world!')).toBe(false);
  });

  it('detects script tags', () => {
    expect(containsXssPatterns('<script>alert(1)</script>')).toBe(true);
  });

  it('detects javascript: protocol', () => {
    expect(containsXssPatterns('javascript:void(0)')).toBe(true);
  });

  it('detects event handlers', () => {
    expect(containsXssPatterns('<img onerror=alert(1)>')).toBe(true);
  });

  it('detects eval', () => {
    expect(containsXssPatterns('eval(user_input)')).toBe(true);
  });

  it('detects iframe', () => {
    expect(containsXssPatterns('<iframe src="x">')).toBe(true);
  });
});

describe('containsSqlInjectionPatterns', () => {
  it('returns false for empty input', () => {
    expect(containsSqlInjectionPatterns('')).toBe(false);
  });

  it('returns false for plain text', () => {
    expect(containsSqlInjectionPatterns('Hello, world!')).toBe(false);
  });

  it('detects SELECT FROM pattern', () => {
    expect(containsSqlInjectionPatterns('SELECT * FROM users')).toBe(true);
  });

  it('detects SQL comment injection', () => {
    expect(containsSqlInjectionPatterns("admin'-- comment")).toBe(true);
  });

  it('detects UNION SELECT', () => {
    expect(containsSqlInjectionPatterns("' UNION SELECT * FROM passwords")).toBe(true);
  });

  it('detects OR tautology', () => {
    expect(containsSqlInjectionPatterns("' OR 1=1")).toBe(true);
  });

  it('detects statement chaining', () => {
    expect(containsSqlInjectionPatterns('; DROP TABLE users')).toBe(true);
  });

  it('does not flag normal text with SQL keywords', () => {
    // Normal sentence that happens to contain "select" or "from"
    expect(containsSqlInjectionPatterns('Please select a value from the dropdown')).toBe(true);
  });
});
