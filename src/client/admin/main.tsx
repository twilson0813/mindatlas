import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from './AdminApp';

const container = document.getElementById('admin-root');
if (container) {
  const root = createRoot(container);
  root.render(<AdminApp />);
}
