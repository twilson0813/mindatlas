import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SearchBar } from './SearchBar';

describe('SearchBar', () => {
  it('renders search input and buttons', () => {
    render(<SearchBar onSearch={vi.fn()} />);

    expect(screen.getByLabelText(/search keyword/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /filters/i })).toBeInTheDocument();
  });

  it('calls onSearch with keyword when form is submitted', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchBar onSearch={onSearch} />);

    const input = screen.getByLabelText(/search keyword/i);
    await user.type(input, 'test query');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'test query' })
    );
  });

  it('expands filter panel when Filters button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <SearchBar
        onSearch={vi.fn()}
        categories={['Tech', 'Science']}
        tags={['important', 'review']}
      />
    );

    // Filters should not be visible initially
    expect(screen.queryByLabelText(/filter options/i)).not.toBeInTheDocument();

    // Click Filters button
    await user.click(screen.getByRole('button', { name: /filters/i }));

    // Filters should now be visible
    expect(screen.getByLabelText(/filter options/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tag/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/from/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/to/i)).toBeInTheDocument();
  });

  it('renders category options from props', async () => {
    const user = userEvent.setup();
    render(
      <SearchBar onSearch={vi.fn()} categories={['Tech', 'Science', 'Art']} />
    );

    await user.click(screen.getByRole('button', { name: /filters/i }));

    const categorySelect = screen.getByLabelText(/category/i);
    expect(categorySelect).toBeInTheDocument();
    expect(screen.getByText('Tech')).toBeInTheDocument();
    expect(screen.getByText('Science')).toBeInTheDocument();
    expect(screen.getByText('Art')).toBeInTheDocument();
  });

  it('renders tag options from props', async () => {
    const user = userEvent.setup();
    render(
      <SearchBar onSearch={vi.fn()} tags={['important', 'review']} />
    );

    await user.click(screen.getByRole('button', { name: /filters/i }));

    expect(screen.getByText('important')).toBeInTheDocument();
    expect(screen.getByText('review')).toBeInTheDocument();
  });

  it('calls onSearch with all filters on submit', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(
      <SearchBar
        onSearch={onSearch}
        categories={['Tech']}
        tags={['important']}
      />
    );

    // Type keyword
    await user.type(screen.getByLabelText(/search keyword/i), 'hello');

    // Expand filters
    await user.click(screen.getByRole('button', { name: /filters/i }));

    // Select category
    await user.selectOptions(screen.getByLabelText(/category/i), 'Tech');

    // Select tag
    await user.selectOptions(screen.getByLabelText(/tag/i), 'important');

    // Submit
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    expect(onSearch).toHaveBeenCalledWith({
      keyword: 'hello',
      category: 'Tech',
      tag: 'important',
      dateFrom: '',
      dateTo: '',
    });
  });

  it('clears all filters when Clear button is clicked', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(
      <SearchBar
        onSearch={onSearch}
        categories={['Tech']}
        tags={['important']}
      />
    );

    // Type keyword
    await user.type(screen.getByLabelText(/search keyword/i), 'test');

    // Expand filters and clear
    await user.click(screen.getByRole('button', { name: /filters/i }));
    await user.selectOptions(screen.getByLabelText(/category/i), 'Tech');
    await user.click(screen.getByRole('button', { name: /clear filters/i }));

    expect(onSearch).toHaveBeenCalledWith({
      keyword: '',
      category: '',
      tag: '',
      dateFrom: '',
      dateTo: '',
    });
  });

  it('has appropriate ARIA attributes for accessibility', () => {
    render(<SearchBar onSearch={vi.fn()} />);

    const form = screen.getByRole('search');
    expect(form).toHaveAttribute('aria-label', 'Search items');

    const toggleBtn = screen.getByRole('button', { name: /filters/i });
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles aria-expanded on filter button', async () => {
    const user = userEvent.setup();
    render(<SearchBar onSearch={vi.fn()} />);

    const toggleBtn = screen.getByRole('button', { name: /filters/i });
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
  });
});
