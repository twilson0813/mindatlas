import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { UsageMeter, UsageData } from './UsageMeter';

describe('UsageMeter', () => {
  const defaultUsage: UsageData = {
    storageUsedBytes: 250 * 1024 * 1024, // 250 MB
    storageLimitBytes: 500 * 1024 * 1024, // 500 MB
    aiQueriesUsed: 5,
    aiQueriesLimit: 10,
  };

  it('renders storage usage bar with correct percentage', () => {
    render(<UsageMeter usage={defaultUsage} />);

    const storageBar = screen.getByLabelText('Storage usage: 50%');
    expect(storageBar).toBeInTheDocument();
    // Both storage and AI query show 50% used with this test data
    expect(screen.getAllByText('50% used').length).toBeGreaterThanOrEqual(1);
  });

  it('renders AI query usage bar with correct percentage', () => {
    render(<UsageMeter usage={defaultUsage} />);

    const aiBar = screen.getByLabelText('AI query usage: 50%');
    expect(aiBar).toBeInTheDocument();
  });

  it('displays formatted byte values for storage', () => {
    render(<UsageMeter usage={defaultUsage} />);

    expect(screen.getByText('250.0 MB / 500.0 MB')).toBeInTheDocument();
  });

  it('displays AI query counts', () => {
    render(<UsageMeter usage={defaultUsage} />);

    expect(screen.getByText('5 / 10')).toBeInTheDocument();
  });

  it('shows unlimited label when AI queries limit is -1', () => {
    const unlimitedUsage: UsageData = {
      ...defaultUsage,
      aiQueriesLimit: -1,
      aiQueriesUsed: 42,
    };
    render(<UsageMeter usage={unlimitedUsage} />);

    expect(screen.getByText('42 / Unlimited')).toBeInTheDocument();
    expect(screen.getByText('Unlimited')).toBeInTheDocument();
  });

  it('caps percentage at 100% when usage exceeds limit', () => {
    const overUsage: UsageData = {
      storageUsedBytes: 600 * 1024 * 1024,
      storageLimitBytes: 500 * 1024 * 1024,
      aiQueriesUsed: 15,
      aiQueriesLimit: 10,
    };
    render(<UsageMeter usage={overUsage} />);

    expect(screen.getByLabelText('Storage usage: 100%')).toBeInTheDocument();
    expect(screen.getByLabelText('AI query usage: 100%')).toBeInTheDocument();
  });

  it('has accessible usage meters section', () => {
    render(<UsageMeter usage={defaultUsage} />);

    expect(screen.getByLabelText('Usage meters')).toBeInTheDocument();
  });

  it('renders the title', () => {
    render(<UsageMeter usage={defaultUsage} />);

    expect(screen.getByText('Current Usage')).toBeInTheDocument();
  });
});
