import React from 'react';

export interface UsageData {
  storageUsedBytes: number;
  storageLimitBytes: number;
  aiQueriesUsed: number;
  aiQueriesLimit: number;
}

export interface UsageMeterProps {
  usage: UsageData;
}

/**
 * Visual meters showing storage and AI query usage vs plan limits.
 * Displays progress bars with percentage and absolute values.
 */
export function UsageMeter({ usage }: UsageMeterProps) {
  const storagePercent = usage.storageLimitBytes > 0
    ? Math.min((usage.storageUsedBytes / usage.storageLimitBytes) * 100, 100)
    : 0;

  const aiPercent = usage.aiQueriesLimit > 0
    ? Math.min((usage.aiQueriesUsed / usage.aiQueriesLimit) * 100, 100)
    : 0;

  const isUnlimitedAi = usage.aiQueriesLimit === -1;

  return (
    <div className="usage-meter" aria-label="Usage meters">
      <h3 className="usage-meter__title">Current Usage</h3>

      <div className="usage-meter__item">
        <div className="usage-meter__header">
          <span className="usage-meter__label">Storage</span>
          <span className="usage-meter__values">
            {formatBytes(usage.storageUsedBytes)} / {formatBytes(usage.storageLimitBytes)}
          </span>
        </div>
        <div
          className="usage-meter__bar"
          role="progressbar"
          aria-valuenow={Math.round(storagePercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Storage usage: ${Math.round(storagePercent)}%`}
        >
          <div
            className={`usage-meter__fill ${getBarClass(storagePercent)}`}
            style={{ width: `${storagePercent}%` }}
          />
        </div>
        <span className="usage-meter__percent">{Math.round(storagePercent)}% used</span>
      </div>

      <div className="usage-meter__item">
        <div className="usage-meter__header">
          <span className="usage-meter__label">AI Queries (today)</span>
          <span className="usage-meter__values">
            {isUnlimitedAi
              ? `${usage.aiQueriesUsed} / Unlimited`
              : `${usage.aiQueriesUsed} / ${usage.aiQueriesLimit}`}
          </span>
        </div>
        <div
          className="usage-meter__bar"
          role="progressbar"
          aria-valuenow={isUnlimitedAi ? 0 : Math.round(aiPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={
            isUnlimitedAi
              ? `AI queries used: ${usage.aiQueriesUsed} (unlimited)`
              : `AI query usage: ${Math.round(aiPercent)}%`
          }
        >
          <div
            className={`usage-meter__fill ${isUnlimitedAi ? '' : getBarClass(aiPercent)}`}
            style={{ width: isUnlimitedAi ? '0%' : `${aiPercent}%` }}
          />
        </div>
        <span className="usage-meter__percent">
          {isUnlimitedAi ? 'Unlimited' : `${Math.round(aiPercent)}% used`}
        </span>
      </div>
    </div>
  );
}

function getBarClass(percent: number): string {
  if (percent >= 90) return 'usage-meter__fill--critical';
  if (percent >= 70) return 'usage-meter__fill--warning';
  return '';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
