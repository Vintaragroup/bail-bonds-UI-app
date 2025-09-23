import { useMemo, useState } from 'react';
import { PageHeader, SummaryStat, PageToolbar, SectionCard } from '../components/PageToolkit';
import { useToast } from '../components/ToastContext';
import { useCheckins, useUpdateCheckinStatus, useLogCheckinContact } from '../hooks/checkins';

const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'overdue', label: 'Overdue', tone: 'warn' },
  { id: 'all', label: 'All' },
];

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

export default function CheckIns() {
  const [activeTab, setActiveTab] = useState('today');
  const { pushToast } = useToast();
  const { data, isLoading, isError, error, refetch } = useCheckins(activeTab);
  const updateStatus = useUpdateCheckinStatus({
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'Updated', message: 'Check-in status updated.' });
      refetch();
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Update failed', message: err?.message || 'Unable to update status.' });
    },
  });
  const logContact = useLogCheckinContact({
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'Contact logged', message: 'Contact recorded successfully.' });
      refetch();
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Log failed', message: err?.message || 'Unable to log contact.' });
    },
  });

  const stats = data?.stats || { totalToday: 0, overdue: 0, completed: 0 };
  const items = data?.items || [];

  const handleComplete = (id) => {
    updateStatus.mutate({ id, status: 'done' });
  };

  const handleLogContact = (id) => {
    logContact.mutate({ id, increment: 1 });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Check-ins"
        subtitle="Monitor today’s check-ins and quickly follow up on overdue clients."
        actions={(
          <button
            type="button"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:border-emerald-300"
          >
            Send batch reminder
          </button>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryStat label="Today" value={stats.totalToday} tone="info" />
        <SummaryStat label="Overdue" value={stats.overdue} tone="warn" />
        <SummaryStat label="Completed" value={stats.completed} tone="success" />
      </div>

      <PageToolbar>
        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 text-sm text-slate-600 sm:flex-row sm:items-center sm:gap-4">
          <span>Scope: <strong className="text-slate-800">{activeTab}</strong></span>
          <button type="button" className="text-blue-600 hover:text-blue-700">
            Configure reminders
          </button>
        </div>
      </PageToolbar>

      <SectionCard
        title={`${TABS.find((tab) => tab.id === activeTab)?.label || 'Results'} check-ins`}
        subtitle={items.length ? `${items.length} assignment${items.length === 1 ? '' : 's'} in queue` : 'All caught up!'}
      >
        {isError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Failed to load check-ins: {error?.message || 'Unknown error'}
          </div>
        ) : isLoading ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            Loading check-ins…
          </div>
        ) : (
          <div className="space-y-3">
            {items.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                Nothing to do right now.
              </div>
            ) : (
              items.map((item) => (
                <article
                  key={item.id}
                  className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-slate-900">{item.person}</div>
                    <div className="text-xs text-slate-500">
                      {item.county?.charAt(0).toUpperCase() + item.county?.slice(1)} • Due {formatDateTime(item.dueAt)} • via {item.method?.toUpperCase?.() || 'SMS'}
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                      <span>Contacted: {item.contactCount || 0}</span>
                      <span>Last contact: {item.lastContactAt ? formatDateTime(item.lastContactAt) : '—'}</span>
                      {item.location ? (
                        <span>
                          Location: {item.location.lat?.toFixed?.(3)}, {item.location.lng?.toFixed?.(3)}
                        </span>
                      ) : null}
                    </div>
                    {item.note ? <div className="text-xs text-slate-500">{item.note}</div> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                        item.status === 'done'
                          ? 'bg-emerald-50 text-emerald-700'
                          : item.status === 'overdue'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-blue-50 text-blue-700'
                      }`}
                    >
                      {item.status === 'done' ? 'Completed' : item.status === 'overdue' ? 'Overdue' : 'Pending'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleLogContact(item.id)}
                      disabled={logContact.isPending}
                      className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Log contact
                    </button>
                    {item.status !== 'done' ? (
                      <button
                        type="button"
                        onClick={() => handleComplete(item.id)}
                        disabled={updateStatus.isPending}
                        className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Mark done
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-400"
                        disabled
                      >
                        Done
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
