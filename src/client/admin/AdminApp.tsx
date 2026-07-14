import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AdminMfaGate } from './components/AdminMfaGate';
import { AdminLayout } from './components/AdminLayout';
import { UserManagement } from './pages/UserManagement';
import { MetricsDashboard } from './pages/MetricsDashboard';
import { PlanManagement } from './pages/PlanManagement';
import { ModerationPanel } from './pages/ModerationPanel';
import { AuditTrail } from './pages/AuditTrail';
import './styles/admin.css';

/**
 * Root component for the Admin Console SPA.
 * Requires MFA verification before granting access to admin features.
 * Served at the /admin route, separate from the main Dashboard.
 */
export function AdminApp() {
  return (
    <BrowserRouter basename="/admin">
      <AdminMfaGate>
        <AdminLayout>
          <Routes>
            <Route path="/" element={<Navigate to="/users" replace />} />
            <Route path="/users" element={<UserManagement />} />
            <Route path="/metrics" element={<MetricsDashboard />} />
            <Route path="/plans" element={<PlanManagement />} />
            <Route path="/moderation" element={<ModerationPanel />} />
            <Route path="/audit" element={<AuditTrail />} />
            <Route path="*" element={<Navigate to="/users" replace />} />
          </Routes>
        </AdminLayout>
      </AdminMfaGate>
    </BrowserRouter>
  );
}
