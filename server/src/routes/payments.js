import express from 'express';
import { nanoid } from 'nanoid';
import { assertPermission } from './utils/authz.js';

const router = express.Router();

// NOTE: Placeholder data until Stripe integration is wired up.
const SAMPLE_PAYMENTS = [
  {
    id: 'TXN-2024-001',
    transactionId: 'TXN-2024-001',
    amount: 2500,
    fees: 75,
    netAmount: 2425,
    currency: 'usd',
    method: 'card',
    status: 'completed',
    bondNumber: 'BOND-27401',
    clientName: 'Maria Rodriguez',
    clientEmail: 'maria.rodriguez@example.com',
    processedAt: '2024-01-15T16:45:00.000Z',
    createdAt: '2024-01-15T15:30:00.000Z',
    updatedAt: '2024-01-15T16:45:00.000Z',
    processor: {
      provider: 'stripe',
      chargeId: 'ch_1P1234567890',
      payoutId: 'po_1P222222',
    },
    flags: ['bond-payment'],
  },
  {
    id: 'TXN-2024-002',
    transactionId: 'TXN-2024-002',
    amount: 1800,
    fees: 30,
    netAmount: 1770,
    currency: 'usd',
    method: 'ach_debit',
    status: 'completed',
    bondNumber: 'BOND-18273',
    clientName: 'James Wilson',
    clientEmail: 'james.wilson@example.com',
    processedAt: '2024-01-15T14:10:00.000Z',
    createdAt: '2024-01-15T13:50:00.000Z',
    updatedAt: '2024-01-15T14:10:00.000Z',
    processor: {
      provider: 'stripe',
      chargeId: 'py_1P888888',
      payoutId: 'po_1P222223',
    },
    flags: ['partial-payment'],
  },
  {
    id: 'TXN-2024-003',
    transactionId: 'TXN-2024-003',
    amount: 3200,
    fees: 64,
    netAmount: 3136,
    currency: 'usd',
    method: 'check',
    status: 'pending',
    bondNumber: 'BOND-90341',
    clientName: 'Sarah Johnson',
    clientEmail: 'sarah.johnson@example.com',
    createdAt: '2024-01-14T20:00:00.000Z',
    updatedAt: '2024-01-14T20:00:00.000Z',
    processor: {
      provider: 'manual',
    },
    flags: ['bond-payment'],
  },
  {
    id: 'TXN-2024-004',
    transactionId: 'TXN-2024-004',
    amount: 950,
    fees: 28.5,
    netAmount: 921.5,
    currency: 'usd',
    method: 'card',
    status: 'failed',
    bondNumber: 'BOND-55231',
    clientName: 'Michael Chen',
    clientEmail: 'michael.chen@example.com',
    createdAt: '2024-01-14T18:15:00.000Z',
    updatedAt: '2024-01-14T18:20:00.000Z',
    processor: {
      provider: 'stripe',
      chargeId: 'ch_1P999999',
    },
    failureReason: 'insufficient_funds',
    flags: ['fee-payment'],
  },
  {
    id: 'TXN-2024-005',
    transactionId: 'TXN-2024-005',
    amount: 4100,
    fees: 82,
    netAmount: 4018,
    currency: 'usd',
    method: 'wire',
    status: 'completed',
    bondNumber: 'BOND-66422',
    clientName: 'Jennifer Davis',
    clientEmail: 'jennifer.davis@example.com',
    processedAt: '2024-01-13T17:45:00.000Z',
    createdAt: '2024-01-13T16:30:00.000Z',
    updatedAt: '2024-01-13T17:45:00.000Z',
    processor: {
      provider: 'wire',
      reference: 'WIRE-239001A',
    },
    flags: ['bond-payment'],
  },
];

const SAMPLE_METHODS = [
  {
    id: 'pm_card_visa',
    type: 'card',
    brand: 'visa',
    last4: '4242',
    expiryMonth: 12,
    expiryYear: 2025,
    label: 'Business Account',
    isDefault: true,
    status: 'active',
  },
  {
    id: 'pm_card_mastercard',
    type: 'card',
    brand: 'mastercard',
    last4: '5555',
    expiryMonth: 8,
    expiryYear: 2026,
    label: 'Emergency Card',
    isDefault: false,
    status: 'active',
  },
  {
    id: 'ba_123456789',
    type: 'bank_account',
    bankName: 'First National Bank',
    last4: '7890',
    accountType: 'checking',
    label: 'Primary Business Account',
    isDefault: false,
    status: 'active',
  },
  {
    id: 'pm_card_amex',
    type: 'card',
    brand: 'amex',
    last4: '1001',
    expiryMonth: 3,
    expiryYear: 2024,
    label: 'Corporate Card',
    isDefault: false,
    status: 'expired',
  },
];

const SAMPLE_REFUND_ELIGIBLE = [
  {
    id: 'TXN-2024-006',
    caseNumber: 'CASE-2024-331',
    client: 'Olivia Martinez',
    originalAmount: 5200,
    refundableAmount: 1800,
    status: 'eligible',
    daysAgo: 6,
  },
  {
    id: 'TXN-2024-003',
    caseNumber: 'BOND-90341',
    client: 'Sarah Johnson',
    originalAmount: 3200,
    refundableAmount: 1200,
    status: 'partial_refund',
    daysAgo: 1,
  },
  {
    id: 'TXN-2024-001',
    caseNumber: 'BOND-27401',
    client: 'Maria Rodriguez',
    originalAmount: 2500,
    refundableAmount: 500,
    status: 'processing',
    daysAgo: 0,
  },
];

const SAMPLE_REFUND_REQUESTS = [
  {
    id: 'RR-2024-001',
    transactionId: 'TXN-2024-001',
    client: 'Maria Rodriguez',
    requestedAt: '2024-01-12T18:30:00.000Z',
    amount: 500,
    status: 'in_review',
    reason: 'Bond conditions met',
    requestedBy: 'Billing Team',
  },
  {
    id: 'RR-2024-002',
    transactionId: 'TXN-2024-007',
    client: 'Ethan Walker',
    requestedAt: '2024-01-10T14:20:00.000Z',
    amount: 1200,
    status: 'awaiting_docs',
    reason: 'Court adjustment',
    requestedBy: 'Finance',
  },
];

const SAMPLE_DISPUTES = [
  {
    id: 'DP-2024-001',
    transactionId: 'TXN-2024-004',
    amount: 950,
    openedAt: '2024-01-14T19:05:00.000Z',
    client: 'Michael Chen',
    reason: 'Cardholder reported unrecognized charge',
    status: 'needs_response',
    responseDeadline: '2024-01-20T23:59:59.000Z',
  },
  {
    id: 'DP-2024-002',
    transactionId: 'TXN-2024-010',
    amount: 1500,
    openedAt: '2024-01-11T17:10:00.000Z',
    client: 'Taylor Brooks',
    reason: 'Service dispute - partial bond release',
    status: 'under_review',
    responseDeadline: '2024-01-18T23:59:59.000Z',
  },
];

const SAMPLE_SETTINGS = {
  defaultMethodId: 'pm_card_visa',
  acceptedMethods: ['card', 'ach_debit', 'wire', 'check'],
  autoCapture: true,
  autoCaptureDelayMinutes: 15,
  receiptEmailEnabled: true,
  approvalThreshold: 5000,
  twoPersonApproval: true,
  notifyOnLargePayment: true,
  notifyRecipients: ['billing@asapbailbooks.com'],
  automationRules: [
    {
      id: 'auto-reminder',
      title: 'Send reminder 3 days before due date',
      enabled: true,
    },
    {
      id: 'auto-retry',
      title: 'Retry failed card payments twice',
      enabled: true,
    },
  ],
};

const SAMPLE_ALERTS = [
  {
    id: 'alert-001',
    severity: 'warning',
    title: 'ACH deposit delayed',
    description: 'Wire transfer for BOND-90341 pending for 5 business days.',
  },
  {
    id: 'alert-002',
    severity: 'info',
    title: 'Settlement notice',
    description: 'Stripe payout STRP-PO-1234 scheduled for Jan 18.',
  },
];

const SAMPLE_PAYOUTS = [
  {
    id: 'po_1P222222',
    arrivalDate: '2024-01-18T09:00:00.000Z',
    amount: 12450,
    status: 'scheduled',
    method: 'ach',
  },
  {
    id: 'po_1P111111',
    arrivalDate: '2024-01-12T09:00:00.000Z',
    amount: 10890,
    status: 'paid',
    method: 'ach',
  },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function filterPayments(payments, query = {}) {
  const { status, method, search } = query;
  return payments.filter((payment) => {
    if (status && status !== 'all' && payment.status !== status) return false;
    if (method && method !== 'all' && payment.method !== method) return false;
    if (search) {
      const needle = String(search).toLowerCase();
      const haystack = [payment.transactionId, payment.clientName, payment.bondNumber]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

function computeMetrics(payments) {
  const totalRevenue = payments
    .filter((p) => p.status === 'completed')
    .reduce((sum, payment) => sum + payment.amount, 0);
  const pendingCount = payments.filter((p) => p.status === 'pending' || p.status === 'processing').length;
  const successRateBase = payments.filter((p) => ['completed', 'failed'].includes(p.status)).length;
  const successRate = successRateBase === 0
    ? 1
    : payments.filter((p) => p.status === 'completed').length / successRateBase;

  return {
    summary: {
      totalRevenue: {
        value: totalRevenue,
        currency: 'usd',
        changeRatio: 0.125,
        label: 'This month',
      },
      activeBonds: {
        value: 24,
        change: 3,
        label: 'Currently processing',
      },
      successRate: {
        value: successRate,
        change: 0.008,
        label: 'Last 30 days',
      },
      pendingPayments: {
        value: pendingCount,
        change: -2,
        label: 'Awaiting processing',
      },
    },
    methodBreakdown: [
      { method: 'card', percentage: 0.62 },
      { method: 'ach_debit', percentage: 0.18 },
      { method: 'wire', percentage: 0.12 },
      { method: 'check', percentage: 0.08 },
    ],
    revenueTrend: [
      { month: '2023-10', amount: 98250 },
      { month: '2023-11', amount: 104200 },
      { month: '2023-12', amount: 112340 },
      { month: '2024-01', amount: 127450 },
    ],
    alerts: clone(SAMPLE_ALERTS),
    upcomingPayouts: clone(SAMPLE_PAYOUTS),
  };
}

router.get('/metrics', (req, res) => {
  assertPermission(req, 'billing:read');
  const payments = clone(SAMPLE_PAYMENTS);
  res.json(computeMetrics(payments));
});

router.get('/methods', (req, res) => {
  assertPermission(req, 'billing:read');
  res.json({ methods: clone(SAMPLE_METHODS) });
});

router.post('/methods', (req, res) => {
  assertPermission(req, 'billing:manage');
  const payload = req.body || {};
  const id = nanoid();
  const method = {
    id,
    type: payload.type || 'card',
    brand: payload.brand || 'unknown',
    last4: payload.last4 || '0000',
    expiryMonth: payload.expiryMonth || null,
    expiryYear: payload.expiryYear || null,
    label: payload.label || 'New Method',
    isDefault: Boolean(payload.isDefault),
    status: 'active',
  };
  // TODO: persist once Stripe integration is live.
  res.status(201).json({ method });
});

router.get('/settings', (req, res) => {
  assertPermission(req, 'billing:read');
  res.json({ settings: clone(SAMPLE_SETTINGS) });
});

router.put('/settings', (req, res) => {
  assertPermission(req, 'billing:manage');
  const payload = req.body || {};
  const updated = { ...clone(SAMPLE_SETTINGS), ...payload };
  // TODO: persist settings per-tenant.
  res.json({ settings: updated });
});

router.get('/refunds/eligible', (req, res) => {
  assertPermission(req, 'billing:read');
  res.json({ items: clone(SAMPLE_REFUND_ELIGIBLE) });
});

router.get('/refunds/requests', (req, res) => {
  assertPermission(req, 'billing:read');
  res.json({ items: clone(SAMPLE_REFUND_REQUESTS) });
});

router.post('/:id/refund', (req, res) => {
  assertPermission(req, 'billing:manage');
  const { id } = req.params;
  const payload = req.body || {};
  const amount = Number(payload.amount || 0);
  if (!amount || Number.isNaN(amount)) {
    return res.status(400).json({ error: 'Refund amount is required' });
  }
  const transaction = SAMPLE_PAYMENTS.find((payment) => payment.id === id);
  if (!transaction) {
    return res.status(404).json({ error: 'Transaction not found' });
  }
  const refund = {
    id: `rf_${nanoid(10)}`,
    transactionId: transaction.id,
    amount,
    currency: transaction.currency,
    status: 'processing',
    requestedAt: new Date().toISOString(),
  };
  res.status(202).json({ refund });
});

router.get('/disputes', (req, res) => {
  assertPermission(req, 'billing:read');
  res.json({ items: clone(SAMPLE_DISPUTES) });
});

router.post('/disputes/:id/resolve', (req, res) => {
  assertPermission(req, 'billing:manage');
  const { id } = req.params;
  const dispute = SAMPLE_DISPUTES.find((item) => item.id === id);
  if (!dispute) {
    return res.status(404).json({ error: 'Dispute not found' });
  }
  const resolution = {
    ...clone(dispute),
    status: 'submitted',
    resolvedAt: new Date().toISOString(),
    notes: req.body?.notes || '',
  };
  res.json({ dispute: resolution });
});

router.get('/', (req, res) => {
  assertPermission(req, 'billing:read');
  const payments = filterPayments(clone(SAMPLE_PAYMENTS), req.query);
  res.json({
    items: payments,
    total: payments.length,
  });
});

router.get('/:id', (req, res) => {
  assertPermission(req, 'billing:read');
  const payment = SAMPLE_PAYMENTS.find((item) => item.id === req.params.id);
  if (!payment) {
    return res.status(404).json({ error: 'Payment not found' });
  }
  res.json({ payment: clone(payment) });
});

router.post('/', (req, res) => {
  assertPermission(req, 'billing:manage');
  const payload = req.body || {};
  const id = `TXN-${new Date().getFullYear()}-${Math.floor(Math.random() * 900 + 100)}`;
  const payment = {
    id,
    transactionId: id,
    amount: Number(payload.amount || 0),
    currency: payload.currency || 'usd',
    method: payload.method || 'card',
    status: 'processing',
    clientName: payload.clientName || 'Pending Client',
    clientEmail: payload.clientEmail || '',
    bondNumber: payload.bondNumber || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: payload.metadata || {},
  };
  if (!payment.amount) {
    return res.status(400).json({ error: 'Amount is required' });
  }
  res.status(202).json({ payment });
});

export default router;
