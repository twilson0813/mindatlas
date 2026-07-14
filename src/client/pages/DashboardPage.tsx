import React, { useState, useEffect } from 'react';
import { Dashboard, DashboardStats } from '../components/Dashboard';
import { Item } from '../components/ItemCard';

/**
 * Dashboard page that fetches and displays user's items, maps, and statistics.
 * On load it retrieves recent items, active maps count, and summary stats.
 */
export function DashboardPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalItems: 0,
    activeMaps: 0,
    totalTags: 0,
    recentActivity: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const token = localStorage.getItem('mindatlas_access_token');
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        // Fetch items and stats in parallel
        const [itemsRes, mapsRes] = await Promise.allSettled([
          fetch('/api/items?limit=20&sort=created_at:desc', { headers }),
          fetch('/api/maps', { headers }),
        ]);

        let fetchedItems: Item[] = [];
        let activeMaps = 0;

        if (itemsRes.status === 'fulfilled' && itemsRes.value.ok) {
          const data = await itemsRes.value.json();
          fetchedItems = (data.items || []).map(mapApiItemToItem);
        }

        if (mapsRes.status === 'fulfilled' && mapsRes.value.ok) {
          const data = await mapsRes.value.json();
          activeMaps = Array.isArray(data.maps) ? data.maps.length : 0;
        }

        // Compute stats from fetched data
        const allTags = new Set<string>();
        fetchedItems.forEach((item) => {
          item.tags.forEach((tag) => allTags.add(tag.id));
        });

        setItems(fetchedItems);
        setStats({
          totalItems: fetchedItems.length,
          activeMaps,
          totalTags: allTags.size,
          recentActivity: fetchedItems.filter((item) => isRecentItem(item.createdAt)).length,
        });
      } catch {
        // Silently handle fetch errors; dashboard will show empty state
      } finally {
        setIsLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  const handleItemClick = (item: Item) => {
    // Item detail navigation will be implemented in task 16.4
    console.log('Item clicked:', item.id);
  };

  if (isLoading) {
    return (
      <div className="loading-screen" aria-label="Loading dashboard">
        <p>Loading your dashboard...</p>
      </div>
    );
  }

  return <Dashboard items={items} stats={stats} onItemClick={handleItemClick} />;
}

interface ApiItem {
  id: string;
  title?: string;
  content?: string;
  content_type?: string;
  source_domain?: string;
  source_channel?: string;
  thumbnail_url?: string;
  file_path?: string;
  created_at?: string;
  tags?: Array<{
    id: string;
    name: string;
    color?: string;
    confidence_score?: number;
  }>;
}

function mapApiItemToItem(apiItem: ApiItem): Item {
  return {
    id: apiItem.id,
    title: apiItem.title || generateTitle(apiItem.content || '', apiItem.content_type),
    snippet: generateSnippet(apiItem.content || ''),
    sourceDomain: apiItem.source_domain || undefined,
    thumbnailUrl: apiItem.thumbnail_url || undefined,
    createdAt: apiItem.created_at || new Date().toISOString(),
    contentType: apiItem.content_type || 'plain_text',
    tags: (apiItem.tags || []).map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color || '#6366f1',
      confidence: tag.confidence_score,
    })),
  };
}

function generateTitle(content: string, contentType?: string): string {
  if (contentType === 'link' && content.startsWith('http')) {
    try {
      return new URL(content).hostname;
    } catch {
      // fall through
    }
  }
  // Use first line of content as title, truncated
  const firstLine = content.split('\n')[0] || 'Untitled';
  return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
}

function generateSnippet(content: string): string {
  const snippet = content.replace(/\n+/g, ' ').trim();
  return snippet.length > 200 ? snippet.slice(0, 197) + '...' : snippet;
}

function isRecentItem(createdAt: string): boolean {
  const date = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  // Consider items from last 7 days as recent
  return diffMs < 7 * 24 * 60 * 60 * 1000;
}
