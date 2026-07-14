import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ItemGrid } from './ItemGrid';
import { Item } from './ItemCard';

export interface DashboardStats {
  totalItems: number;
  activeMaps: number;
  totalTags: number;
  recentActivity: number;
}

export interface DashboardProps {
  items: Item[];
  stats: DashboardStats;
  onItemClick?: (item: Item) => void;
}

type NavSection = 'dashboard' | 'items' | 'maps' | 'upload' | 'integrations';

/**
 * Root dashboard layout with sidebar navigation and content area.
 * Displays summary statistics, recent items in masonry grid,
 * and provides navigation to all sections.
 */
export function Dashboard({ items, stats, onItemClick }: DashboardProps) {
  const { user, logout } = useAuth();
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = () => setSidebarOpen((prev) => !prev);
  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="dashboard-layout">
      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'sidebar-open' : ''}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside
        className={`dashboard-sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-header">
          <h1>MindAtlas</h1>
        </div>

        <nav className="sidebar-nav">
          <ul>
            <li>
              <button
                className={`nav-item ${activeSection === 'dashboard' ? 'active' : ''}`}
                onClick={() => {
                  setActiveSection('dashboard');
                  closeSidebar();
                }}
                aria-current={activeSection === 'dashboard' ? 'page' : undefined}
              >
                <span className="nav-item-icon" aria-hidden="true">
                  ◫
                </span>
                Dashboard
              </button>
            </li>
            <li>
              <button
                className={`nav-item ${activeSection === 'items' ? 'active' : ''}`}
                onClick={() => {
                  setActiveSection('items');
                  closeSidebar();
                }}
                aria-current={activeSection === 'items' ? 'page' : undefined}
              >
                <span className="nav-item-icon" aria-hidden="true">
                  ▦
                </span>
                Items
              </button>
            </li>
            <li>
              <button
                className={`nav-item ${activeSection === 'maps' ? 'active' : ''}`}
                onClick={() => {
                  setActiveSection('maps');
                  closeSidebar();
                }}
                aria-current={activeSection === 'maps' ? 'page' : undefined}
              >
                <span className="nav-item-icon" aria-hidden="true">
                  ◈
                </span>
                Maps
              </button>
            </li>
            <li>
              <button
                className={`nav-item ${activeSection === 'upload' ? 'active' : ''}`}
                onClick={() => {
                  setActiveSection('upload');
                  closeSidebar();
                }}
                aria-current={activeSection === 'upload' ? 'page' : undefined}
              >
                <span className="nav-item-icon" aria-hidden="true">
                  ⬆
                </span>
                Upload
              </button>
            </li>
            <li>
              <button
                className={`nav-item ${activeSection === 'integrations' ? 'active' : ''}`}
                onClick={() => {
                  setActiveSection('integrations');
                  closeSidebar();
                }}
                aria-current={activeSection === 'integrations' ? 'page' : undefined}
              >
                <span className="nav-item-icon" aria-hidden="true">
                  ⊞
                </span>
                Integrations
              </button>
            </li>
          </ul>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="sidebar-user-email">{user?.email}</span>
            <button className="sidebar-logout-btn" onClick={logout} aria-label="Sign out">
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="dashboard-main">
        <div className="dashboard-topbar">
          <button
            className="sidebar-toggle"
            onClick={toggleSidebar}
            aria-label="Toggle navigation menu"
            aria-expanded={sidebarOpen}
          >
            ☰
          </button>
          <h2>{getSectionTitle(activeSection)}</h2>
          <div />
        </div>

        <div className="dashboard-body">
          {activeSection === 'dashboard' && (
            <>
              {/* Summary statistics */}
              <div className="dashboard-stats" aria-label="Summary statistics">
                <div className="stat-card">
                  <div className="stat-card-label">Total Items</div>
                  <div className="stat-card-value">{stats.totalItems}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-label">Active Maps</div>
                  <div className="stat-card-value">{stats.activeMaps}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-label">Tags</div>
                  <div className="stat-card-value">{stats.totalTags}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-label">Recent Activity</div>
                  <div className="stat-card-value">{stats.recentActivity}</div>
                </div>
              </div>

              {/* Recent items */}
              <h3 className="dashboard-section-heading">Recent Items</h3>
              <ItemGrid items={items} onItemClick={onItemClick} />
            </>
          )}

          {activeSection === 'items' && (
            <>
              <h3 className="dashboard-section-heading">All Items</h3>
              <ItemGrid items={items} onItemClick={onItemClick} />
            </>
          )}

          {activeSection === 'maps' && (
            <p className="text-muted">Maps will be displayed here.</p>
          )}

          {activeSection === 'upload' && (
            <p className="text-muted">Upload form will be displayed here.</p>
          )}

          {activeSection === 'integrations' && (
            <p className="text-muted">Integrations will be displayed here.</p>
          )}
        </div>
      </main>
    </div>
  );
}

function getSectionTitle(section: NavSection): string {
  switch (section) {
    case 'dashboard':
      return 'Dashboard';
    case 'items':
      return 'Items';
    case 'maps':
      return 'Maps';
    case 'upload':
      return 'Upload';
    case 'integrations':
      return 'Integrations';
    default:
      return 'Dashboard';
  }
}
