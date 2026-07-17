import React, { useState, useCallback } from 'react';
import '../styles/search.css';

export interface SearchFilters {
  keyword: string;
  category: string;
  tag: string;
  dateFrom: string;
  dateTo: string;
}

interface SearchBarProps {
  onSearch: (filters: SearchFilters) => void;
  categories?: string[];
  tags?: string[];
}

const EMPTY_FILTERS: SearchFilters = {
  keyword: '',
  category: '',
  tag: '',
  dateFrom: '',
  dateTo: '',
};

export function SearchBar({ onSearch, categories = [], tags = [] }: SearchBarProps) {
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleChange = useCallback(
    (field: keyof SearchFilters) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFilters((prev) => ({ ...prev, [field]: e.target.value }));
      },
    [],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSearch(filters);
    },
    [filters, onSearch],
  );

  const handleClear = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    onSearch(EMPTY_FILTERS);
  }, [onSearch]);

  const hasActiveFilters =
    filters.keyword || filters.category || filters.tag || filters.dateFrom || filters.dateTo;

  return (
    <form className="search-bar" onSubmit={handleSubmit} role="search" aria-label="Search items">
      <div className="search-bar__main">
        <input
          type="text"
          className="search-bar__input"
          placeholder="Search items by keyword..."
          value={filters.keyword}
          onChange={handleChange('keyword')}
          aria-label="Search keyword"
        />
        <button type="submit" className="btn-primary search-bar__submit">
          Search
        </button>
        <button
          type="button"
          className="btn-secondary search-bar__toggle"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          aria-controls="search-filters"
        >
          Filters {hasActiveFilters && <span className="search-bar__active-dot" />}
        </button>
      </div>

      {isExpanded && (
        <div
          className="search-bar__filters"
          id="search-filters"
          role="group"
          aria-label="Filter options"
        >
          <div className="search-bar__filter-group">
            <label htmlFor="filter-category">Category</label>
            <select
              id="filter-category"
              value={filters.category}
              onChange={handleChange('category')}
            >
              <option value="">All categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="search-bar__filter-group">
            <label htmlFor="filter-tag">Tag</label>
            <select id="filter-tag" value={filters.tag} onChange={handleChange('tag')}>
              <option value="">All tags</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </div>

          <div className="search-bar__filter-group">
            <label htmlFor="filter-date-from">From</label>
            <input
              id="filter-date-from"
              type="date"
              value={filters.dateFrom}
              onChange={handleChange('dateFrom')}
            />
          </div>

          <div className="search-bar__filter-group">
            <label htmlFor="filter-date-to">To</label>
            <input
              id="filter-date-to"
              type="date"
              value={filters.dateTo}
              onChange={handleChange('dateTo')}
            />
          </div>

          <button type="button" className="btn-secondary search-bar__clear" onClick={handleClear}>
            Clear filters
          </button>
        </div>
      )}
    </form>
  );
}
