import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface AdminLayoutProps {
  children: React.ReactNode;
}

type AdminSection = 'users' | 'metrics' | 'plans' | 'moderation' | 'audit' | 'credentials';

const NAV_ITEMS: { key: AdminSection; label: string; icon: string; path: string }[] = [
  { key: 'users', label: 'Users', icon: '👤', path: '/users' },
  { key: 'metrics', label: 'Metrics', icon: '📊', path: '/metrics' },
  { key: 'plans', label: 'Plans', icon: '💳', path: '/plans' },
  { key: 'credentials', label: 'Credentials', icon: '🔑', path: '/credentials' },
  { key: 'moderation', label: 'Moderation', icon: '🛡️', path: '/moderation' },
  { key: 'audit', label: 'Audit Log', icon: '📋', path: '/audit' },
];

/**
 * Admin console layout with sidebar navigation.
 * Provides consistent admin nav and content container.
 */
export function AdminLayout({ children }: AdminLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const currentSection =
    NAV_ITEMS.find((item) => location.pathname.startsWith(item.path))?.key || 'users';

  const handleNavClick = (path: string) => {
    navigate(path);
    setSidebarOpen(false);
  };

  return (
    <div className="admin-layout">
      {/* Mobile overlay */}
      <div
        className={`admin-sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="Admin navigation">
        <div className="admin-sidebar-header">
          <h1>Admin Console</h1>
        </div>

        <nav className="admin-sidebar-nav">
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.key}>
                <button
                  className={`admin-nav-item ${currentSection === item.key ? 'active' : ''}`}
                  onClick={() => handleNavClick(item.path)}
                  aria-current={currentSection === item.key ? 'page' : undefined}
                >
                  <span className="admin-nav-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="admin-sidebar-footer">
          <a href="/" className="admin-back-link">
            ← Back to Dashboard
          </a>
        </div>
      </aside>

      {/* Main content */}
      <main className="admin-main">
        <div className="admin-topbar">
          <button
            className="admin-sidebar-toggle"
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label="Toggle admin navigation"
            aria-expanded={sidebarOpen}
          >
            ☰
          </button>
          <h2>{NAV_ITEMS.find((item) => item.key === currentSection)?.label || 'Admin'}</h2>
        </div>

        <div className="admin-content">{children}</div>
      </main>
    </div>
  );
}
