import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

describe('GET /docs', () => {
  const app = createApp();

  it('should return 200 with HTML content', async () => {
    const response = await request(app).get('/docs');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('should contain the user manual title', async () => {
    const response = await request(app).get('/docs');

    expect(response.text).toContain('MindAtlas - User Manual');
  });

  it('should contain rendered markdown content', async () => {
    const response = await request(app).get('/docs');

    // The markdown h1 should be rendered as an HTML heading
    expect(response.text).toContain('<h1');
    expect(response.text).toContain('MindAtlas User Manual');
  });

  it('should include dark theme styles', async () => {
    const response = await request(app).get('/docs');

    expect(response.text).toContain('background-color: #1a1a2e');
  });
});
