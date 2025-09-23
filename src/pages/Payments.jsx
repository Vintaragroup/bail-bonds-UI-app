import { useMemo, useState } from 'react';
import { PageHeader, PageToolbar, SummaryStat, SectionCard, DataTable } from '../components/PageToolkit';

const MOCK_PAYMENTS = {
  due: [
    { id: 'PM-901', person: 'Alicia Ramirez', amount: 450, dueDate: '2025-02-21', status: 'due', plan: 'Weekly', method: 'ACH', lastPaid: '2025-02-14' },
    { id: 'PM-902', person: 'Imani Woods', amount: 250, dueDate: '2025-02-22', status: 'due', plan: 'Bi-weekly', method: 'Card', lastPaid: '2025-02-09' },
  ],
  late: [
    { id: 'PM-870', person: 'Jeff Martin', amount: 600, dueDate: '2025-02-10', status: 'late', plan: 'Weekly', method: 'ACH', lastPaid: '2025-01-26' },
  ],
  paid: [
    { id: 'PM-820', person: 'Cory Nguyen', amount: 500, dueDate: '2025-02-12', status: 'paid', plan: 'Monthly', method: 'Cash', lastPaid: '2025-02-12' },
  ],
};

const STATUSES = [
  { id: 'due', label: 'Due (7 days)' },
  { id: 'late', label: 'Late' },
  { id: 'paid', label: 'Paid' },
];

export default function Payments() {
  const [status, setStatus] = useState('due');
  const [range, setRange] = useState('7');

  const stats = useMemo(() => {
    const dueTotal = MOCK_PAYMENTS.due.reduce((sum, item) => sum + item.amount, 0);
    const lateTotal = MOCK_PAYMENTS.late.reduce((sum, item) => sum + item.amount, 0);
    const collectedThisMonth = MOCK_PAYMENTS.paid.reduce((sum, item) => sum + item.amount, 0);
    return { dueTotal, lateTotal, collectedThisMonth };
  }, []);

  const current = MOCK_PAYMENTS[status] || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        subtitle="Stay on top of payment plans and surface delinquencies early."
        actions={(
          <button
            type="button"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:border-emerald-300"
          >
            Record payment
          </button>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryStat label="Due (7d)" value={`$${stats.dueTotal.toLocaleString()}`} tone="info" />
        <SummaryStat label="Late" value={`$${stats.lateTotal.toLocaleString()}`} tone="warn" />
        <SummaryStat label="Collected (MTD)" value={`$${stats.collectedThisMonth.toLocaleString()}`} tone="success" />
      </div>

      <PageToolbar>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setStatus(opt.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                status === opt.id ? 'bg-blue-600 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {status === 'due' ? (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span>Range</span>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="7">7 days</option>
              <option value="30">30 days</option>
            </select>
          </div>
        ) : (
          <div className="text-sm text-slate-500">{status === 'late' ? 'Showing past-due plans.' : 'Recently completed payments.'}</div>
        )}
      </PageToolbar>

      <SectionCard
        title={STATUSES.find((opt) => opt.id === status)?.label || 'Payments'}
        subtitle={`${current.length} plan${current.length === 1 ? '' : 's'} in this view`}
      >
        <DataTable
          columns={[
            { key: 'person', header: 'Client' },
            { key: 'amount', header: 'Amount', render: (value) => `$${value.toLocaleString()}` },
            { key: 'dueDate', header: status === 'paid' ? 'Paid on' : 'Due date' },
            { key: 'plan', header: 'Plan' },
            { key: 'method', header: 'Method' },
            {
              key: 'lastPaid',
              header: 'Last payment',
              render: (value) => value || '—',
            },
          ]}
          rows={current}
          renderActions={(row) => (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-blue-300 hover:text-blue-600"
              >
                View plan
              </button>
              {status !== 'paid' ? (
                <button
                  type="button"
                  className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100"
                >
                  Send reminder
                </button>
              ) : null}
            </div>
          )}
        />
      </SectionCard>
    </div>
  );
}
