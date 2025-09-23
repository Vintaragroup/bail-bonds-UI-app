import { useMemo, useState } from 'react';
import { PageHeader, PageToolbar, SectionCard, DataTable, FilterPills } from '../components/PageToolkit';

const MOCK_MESSAGES = [
  { id: 'MSG-1', direction: 'out', channel: 'sms', person: 'Alicia Ramirez', caseId: 'C-1001', sentAt: '2025-02-18 09:32', status: 'delivered', preview: 'Reminder: court tomorrow at 9am.' },
  { id: 'MSG-2', direction: 'in', channel: 'sms', person: 'Alicia Ramirez', caseId: 'C-1001', sentAt: '2025-02-18 09:40', status: 'received', preview: 'Thanks, see you there.' },
  { id: 'MSG-3', direction: 'out', channel: 'voice', person: 'Jeff Martin', caseId: 'C-1002', sentAt: '2025-02-17 14:11', status: 'queued', preview: 'Voicemail drop scheduled.' },
  { id: 'MSG-4', direction: 'out', channel: 'sms', person: 'Imani Woods', caseId: 'C-1003', sentAt: '2025-02-16 10:05', status: 'failed', preview: 'Payment reminder: $250 due.' },
];

const FILTERS = {
  direction: [
    { id: 'all', label: 'All' },
    { id: 'out', label: 'Outbox' },
    { id: 'in', label: 'Inbox' },
  ],
  channel: [
    { id: 'all', label: 'All channels' },
    { id: 'sms', label: 'SMS' },
    { id: 'voice', label: 'Voice' },
  ],
  status: [
    { id: 'all', label: 'Any status' },
    { id: 'delivered', label: 'Delivered' },
    { id: 'queued', label: 'Queued' },
    { id: 'failed', label: 'Failed' },
  ],
};

const MOCK_TEMPLATES = [
  { id: 'TPL-01', name: 'Court Reminder', channel: 'sms', body: 'Reminder: ${name}, be at ${location} on ${date} at ${time}.' },
  { id: 'TPL-02', name: 'Payment Due', channel: 'sms', body: 'Hi ${name}, your payment of ${amount} is due on ${date}.' },
  { id: 'TPL-03', name: 'Missed Check-in', channel: 'sms', body: 'Hi ${name}, we missed you at today\'s check-in. Reply or call us.' },
];

export default function Messages() {
  const [direction, setDirection] = useState('all');
  const [channel, setChannel] = useState('all');
  const [status, setStatus] = useState('all');

  const filteredMessages = useMemo(() => {
    return MOCK_MESSAGES.filter((msg) => {
      const matchesDirection = direction === 'all' || msg.direction === direction;
      const matchesChannel = channel === 'all' || msg.channel === channel;
      const matchesStatus = status === 'all' || msg.status === status;
      return matchesDirection && matchesChannel && matchesStatus;
    });
  }, [direction, channel, status]);

  const activeFilters = [
    direction !== 'all' ? `Direction: ${direction}` : null,
    channel !== 'all' ? `Channel: ${channel}` : null,
    status !== 'all' ? `Status: ${status}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messages"
        subtitle="Search the communications log and work with reusable templates."
        actions={(
          <button
            type="button"
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:border-blue-300"
          >
            Compose message
          </button>
        )}
      />

      <PageToolbar>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Direction</span>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              {FILTERS.direction.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Channel</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              {FILTERS.channel.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              {FILTERS.status.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button type="button" className="text-sm text-slate-500 hover:text-slate-700">
          Export log
        </button>
      </PageToolbar>

      <FilterPills items={activeFilters} onClear={activeFilters.length ? () => {
        setDirection('all');
        setChannel('all');
        setStatus('all');
      } : undefined} />

      <SectionCard title="Activity" subtitle={`${filteredMessages.length} message${filteredMessages.length === 1 ? '' : 's'} found`}>
        <DataTable
          columns={[
            { key: 'sentAt', header: 'Timestamp' },
            { key: 'direction', header: 'Dir', render: (value) => value.toUpperCase() },
            { key: 'channel', header: 'Channel', render: (value) => value.toUpperCase() },
            { key: 'person', header: 'Person' },
            { key: 'caseId', header: 'Case' },
            {
              key: 'preview',
              header: 'Preview',
              render: (value) => <span className="max-w-sm truncate text-slate-600">{value}</span>,
            },
            {
              key: 'status',
              header: 'Status',
              render: (value) => (
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                  value === 'failed'
                    ? 'bg-rose-50 text-rose-700'
                    : value === 'queued'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-emerald-50 text-emerald-700'
                }`}>
                  {value}
                </span>
              ),
            },
          ]}
          rows={filteredMessages}
          renderActions={(row) => (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-blue-300 hover:text-blue-600"
              >
                View thread
              </button>
              {row.direction === 'out' && row.status === 'failed' ? (
                <button
                  type="button"
                  className="rounded-lg border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:bg-rose-100"
                >
                  Retry
                </button>
              ) : null}
            </div>
          )}
        />
      </SectionCard>

      <SectionCard title="Templates" subtitle="Quickly reuse messaging patterns">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {MOCK_TEMPLATES.map((tpl) => (
            <article key={tpl.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">{tpl.name}</h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{tpl.channel.toUpperCase()}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">{tpl.body}</p>
              <div className="mt-3 flex gap-2 text-xs">
                <button className="rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:border-blue-300 hover:text-blue-600" type="button">
                  Use template
                </button>
                <button className="rounded-lg border border-slate-200 px-2 py-1 text-slate-500 hover:border-slate-300" type="button">
                  Edit
                </button>
              </div>
            </article>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
