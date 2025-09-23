import { useMemo } from 'react';
import { PageHeader, SectionCard, SummaryStat, DataTable } from '../components/PageToolkit';

const JOBS = [
  { id: 'scrape:harris', description: 'Harris booking scrape', lastRun: '2025-02-18 05:10', status: 'success', durationMs: 182000 },
  { id: 'scrape:galveston', description: 'Galveston booking scrape', lastRun: '2025-02-18 04:55', status: 'success', durationMs: 121000 },
  { id: 'normalizer', description: 'Normalize simple_* collections', lastRun: '2025-02-18 05:20', status: 'running', durationMs: 0 },
  { id: 'alerts:bond', description: 'High bond alert email', lastRun: '2025-02-17 18:00', status: 'failed', durationMs: 3000 },
];

const INTEGRATIONS = [
  { id: 'telnyx', name: 'Telnyx Messaging', status: 'connected', updated: '2025-02-17 12:05' },
  { id: 'slack', name: 'Slack Alerts', status: 'connected', updated: '2025-02-17 12:10' },
  { id: 'clio', name: 'Clio Sync', status: 'disconnected', updated: '2025-02-16 09:40' },
];

const USERS = [
  { id: 'U-01', name: 'Ryan Morrow', role: 'Owner', email: 'ryan@example.com', lastSeen: '2025-02-18 09:12' },
  { id: 'U-02', name: 'Lauren Vega', role: 'Manager', email: 'lauren@example.com', lastSeen: '2025-02-18 08:45' },
  { id: 'U-03', name: 'Marco Chen', role: 'Agent', email: 'marco@example.com', lastSeen: '2025-02-17 19:23' },
];

export default function Admin() {
  const jobStats = useMemo(() => {
    const successes = JOBS.filter((job) => job.status === 'success').length;
    const running = JOBS.filter((job) => job.status === 'running').length;
    const failures = JOBS.filter((job) => job.status === 'failed').length;
    return { total: JOBS.length, successes, running, failures };
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin"
        subtitle="Monitor scrapers, integrations, and manage user access."
        actions={(
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:border-blue-300"
            >
              Run health check
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-400"
            >
              Invite user
            </button>
          </div>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <SummaryStat label="Scheduled jobs" value={jobStats.total} />
        <SummaryStat label="Healthy" value={jobStats.successes} tone="success" />
        <SummaryStat label="Running" value={jobStats.running} tone="info" />
        <SummaryStat label="Needs attention" value={jobStats.failures} tone="warn" />
      </div>

      <SectionCard title="Automation jobs" subtitle="Review scraper cadence and rerun stuck jobs">
        <DataTable
          columns={[
            { key: 'id', header: 'Job' },
            { key: 'description', header: 'Description' },
            { key: 'lastRun', header: 'Last run' },
            {
              key: 'status',
              header: 'Status',
              render: (value) => (
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                  value === 'success'
                    ? 'bg-emerald-50 text-emerald-700'
                    : value === 'running'
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-rose-50 text-rose-700'
                }`}>
                  {value}
                </span>
              ),
            },
            {
              key: 'durationMs',
              header: 'Duration',
              render: (value) => (value ? `${Math.round(value / 1000)}s` : '—'),
            },
          ]}
          rows={JOBS}
          renderActions={(row) => (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-blue-300 hover:text-blue-600"
              >
                View logs
              </button>
              <button
                type="button"
                className="rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
              >
                Run now
              </button>
            </div>
          )}
        />
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Integrations" subtitle="Keep external systems connected">
          <div className="space-y-3">
            {INTEGRATIONS.map((integration) => (
              <article key={integration.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{integration.name}</div>
                  <div className="text-xs text-slate-500">Updated {integration.updated}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                    integration.status === 'connected'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-rose-50 text-rose-700'
                  }`}>
                    {integration.status}
                  </span>
                  <button type="button" className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-blue-300 hover:text-blue-600">
                    Configure
                  </button>
                </div>
              </article>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Users & roles" subtitle="Manage access control">
          <DataTable
            columns={[
              { key: 'name', header: 'Name' },
              { key: 'role', header: 'Role' },
              { key: 'email', header: 'Email' },
              { key: 'lastSeen', header: 'Last seen' },
            ]}
            rows={USERS}
            renderActions={(row) => (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-blue-300 hover:text-blue-600"
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:bg-rose-100"
                >
                  Disable
                </button>
              </div>
            )}
          />
        </SectionCard>
      </div>
    </div>
  );
}
