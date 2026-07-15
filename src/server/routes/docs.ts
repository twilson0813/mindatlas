import { Router } from 'express';
import fs from 'fs';
import path from 'path';
// @ts-ignore -- marked is ESM-only but works at runtime via bundler
import { marked } from 'marked';

const router = Router();

router.get('/', (_req, res) => {
  const manualPath = path.resolve(process.cwd(), 'docs/user-manual.md');

  let markdown: string;
  try {
    markdown = fs.readFileSync(manualPath, 'utf-8');
  } catch {
    res.status(404).send('User manual not found.');
    return;
  }

  const htmlContent = marked(markdown);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MindAtlas - User Manual</title>
  <style>
    body {
      background-color: #1a1a2e;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
      line-height: 1.6;
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem;
    }
    h1, h2, h3, h4, h5, h6 {
      color: #ffffff;
      border-bottom: 1px solid #333;
      padding-bottom: 0.3rem;
    }
    a {
      color: #64b5f6;
    }
    a:hover {
      color: #90caf9;
    }
    code {
      background-color: #2d2d44;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      font-size: 0.9em;
    }
    pre {
      background-color: #2d2d44;
      padding: 1rem;
      border-radius: 8px;
      overflow-x: auto;
    }
    pre code {
      background: none;
      padding: 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
    }
    th, td {
      border: 1px solid #444;
      padding: 0.6rem 0.8rem;
      text-align: left;
    }
    th {
      background-color: #2d2d44;
      color: #ffffff;
    }
    tr:nth-child(even) {
      background-color: #1f1f35;
    }
    blockquote {
      border-left: 4px solid #64b5f6;
      margin-left: 0;
      padding-left: 1rem;
      color: #b0b0b0;
    }
    hr {
      border: none;
      border-top: 1px solid #333;
      margin: 2rem 0;
    }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

export default router;
