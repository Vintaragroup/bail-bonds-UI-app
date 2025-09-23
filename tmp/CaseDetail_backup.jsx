import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader, SectionCard, SummaryStat } from '../components/PageToolkit';
import {
  useCase,
  useCaseMeta,
  useCaseMessages,
  useCaseActivity,
  useResendMessage,
  useUpdateCaseCrm,
  useUploadCaseDocument,
  useCreateCaseActivity,
  useUpdateCaseStage,
} from '../hooks/cases';
import { useToast } from '../components/ToastContext';
import CrmStageSelect from '../components/CrmStageSelect';
import { stageLabel } from '../lib/stage';

const formatMoney = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '—';
  return `$${num.toLocaleString()}`;
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const formatRelative = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatFileSize = (bytes) => {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return '—';
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export default function CaseDetail() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { caseId } = useParams();
  const caseQueryKey = ['case', caseId];
  const activityQueryKey = ['caseActivity', caseId];
  const { data, isLoading, isError, error, refetch } = useCase(caseId);
  const { data: meta } = useCaseMeta();
  const { data: messagesData, isLoading: messagesLoading, isError: messagesError } = useCaseMessages(caseId);
  const { data: activityData, isLoading: activityLoading, isError: activityError } = useCaseActivity(caseId);
  const { pushToast } = useToast();

  const stageOptions = useMemo(
    () => (Array.isArray(meta?.stages) && meta.stages.length ? meta.stages : ['new', 'contacted', 'qualifying', 'accepted', 'denied']),
    [meta]
  );

  const updateCrm = useUpdateCaseCrm({
    onMutate: async ({ caseId: mutateId, payload }) => {
      if (!mutateId) return undefined;
      await queryClient.cancelQueries({ queryKey: ['case', mutateId] });
      const previous = queryClient.getQueryData(['case', mutateId]);
      if (previous) {
        const next = {
          ...previous,
          crm_details: {
            ...previous.crm_details,
          },
        };

        if (payload?.qualificationNotes !== undefined) next.crm_details.qualificationNotes = payload.qualificationNotes;
        if (payload?.followUpAt !== undefined) next.crm_details.followUpAt = payload.followUpAt ? new Date(payload.followUpAt).toISOString() : null;
        if (payload?.assignedTo !== undefined) next.crm_details.assignedTo = payload.assignedTo || '';
        if (payload?.acceptance) next.crm_details.acceptance = { ...next.crm_details.acceptance, ...payload.acceptance };
        if (payload?.denial) next.crm_details.denial = { ...next.crm_details.denial, ...payload.denial };
        if (payload?.documents) next.crm_details.documents = payload.documents;
        if (payload?.attachments) next.crm_details.attachments = payload.attachments;

        queryClient.setQueryData(['case', mutateId], next);
      }

      return { previous };
    },
    onError: (err, vars, ctx) => {
      if (ctx?.previous && vars?.caseId) {
        queryClient.setQueryData(['case', vars.caseId], ctx.previous);
      }
      pushToast({ variant: 'error', title: 'Save failed', message: err?.message || 'Unable to save CRM details.' });
    },
    onSuccess: (response, vars) => {
      if (vars?.caseId) {
        queryClient.setQueryData(['case', vars.caseId], (old) => (
          !old
            ? old
            : {
                ...old,
                crm_details: response?.crm_details || old.crm_details,
                crm_stage: response?.crm_stage || old.crm_stage,
              }
        ));
        queryClient.invalidateQueries({ queryKey: ['cases'] });
        queryClient.invalidateQueries({ queryKey: activityQueryKey });
      }
      pushToast({ variant: 'success', title: 'CRM updated', message: 'Case CRM details saved.' });
    },
  });

  const updateStage = useUpdateCaseStage({
    onMutate: async ({ caseId: mutateId, stage }) => {
      if (!mutateId) return undefined;
      await queryClient.cancelQueries({ queryKey: ['case', mutateId] });
      const previous = queryClient.getQueryData(['case', mutateId]);
      if (previous) {
        const history = Array.isArray(previous.crm_stage_history) ? previous.crm_stage_history.slice() : [];
        history.push({ stage, changedAt: new Date().toISOString(), actor: 'pending' });
        queryClient.setQueryData(['case', mutateId], {
          ...previous,
          crm_stage: stage,
          crm_stage_history: history,
        });
      }
      return { previous };
    },
    onError: (err, vars, ctx) => {
      if (ctx?.previous && vars?.caseId) {
        queryClient.setQueryData(['case', vars.caseId], ctx.previous);
      }
      pushToast({ variant: 'error', title: 'Stage update failed', message: err?.message || 'Unable to update stage.' });
    },
    onSuccess: (_response, vars) => {
      pushToast({ variant: 'success', title: 'Stage updated', message: 'Stage saved successfully.' });
      setStageChangeNote('');
      if (vars?.caseId) {
        queryClient.invalidateQueries({ queryKey: ['cases'] });
        queryClient.invalidateQueries({ queryKey: activityQueryKey });
      }
    },
  });

  const uploadDocument = useUploadCaseDocument({
    onSuccess: (response) => {
      if (caseId && response?.attachment) {
        queryClient.setQueryData(caseQueryKey, (old) => {
          if (!old) return old;
          const attachments = Array.isArray(old.crm_details?.attachments) ? old.crm_details.attachments.slice() : [];
          attachments.push(response.attachment);
          return {
            ...old,
            crm_details: {
              ...old.crm_details,
              attachments,
            },
          };
        });
        queryClient.invalidateQueries({ queryKey: activityQueryKey });
      }
      setUploadLabel('');
      setUploadNote('');
      setUploadChecklistKey('');
      setUploadFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      pushToast({ variant: 'success', title: 'Document uploaded', message: 'Attachment added to CRM.' });
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Upload failed', message: err?.message || 'Unable to upload document.' });
    },
  });

  const createActivity = useCreateCaseActivity({
    onMutate: async ({ caseId: mutateId, payload }) => {
      if (!mutateId) return undefined;
      await queryClient.cancelQueries({ queryKey: ['caseActivity', mutateId] });
      const previous = queryClient.getQueryData(['caseActivity', mutateId]);
      const optimisticId = `optimistic-${Date.now()}`;
      const optimisticEvent = {
        type: 'crm_note',
        title: payload?.outcome ? `Outcome: ${payload.outcome}` : 'CRM note added',
        occurredAt: new Date().toISOString(),
        details: payload?.note,
        actor: 'pending',
        __optimisticId: optimisticId,
      };
      queryClient.setQueryData(['caseActivity', mutateId], (old) => {
        if (!old) return { events: [optimisticEvent] };
        return { ...old, events: [optimisticEvent, ...(old.events || [])] };
      });
      return { previous, optimisticId };
    },
    onError: (err, vars, ctx) => {
      if (ctx?.previous && vars?.caseId) {
        queryClient.setQueryData(['caseActivity', vars.caseId], ctx.previous);
      }
      pushToast({ variant: 'error', title: 'Save failed', message: err?.message || 'Unable to log activity.' });
    },
    onSuccess: (response, vars, ctx) => {
      const event = response?.event;
      if (vars?.caseId && event) {
        queryClient.setQueryData(['caseActivity', vars.caseId], (old) => {
          if (!old) return { events: [event] };
          let events = (old.events || []).map((item) =>
            item.__optimisticId && item.__optimisticId === ctx?.optimisticId ? event : item
          );
          const hasEvent = events.some((item) => item === event || (!item.__optimisticId && item.occurredAt === event.occurredAt && item.type === event.type));
          if (!hasEvent) {
            events = [event, ...events];
          }
          return { ...old, events };
        });
      }
      if (vars?.payload?.followUpAt && caseId) {
        const iso = new Date(vars.payload.followUpAt).toISOString();
        queryClient.setQueryData(caseQueryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            crm_details: {
              ...old.crm_details,
              followUpAt: iso,
            },
          };
        });
      }
      setActivityNote('');
      setActivityOutcome('');
      setActivityFollowUp('');
      pushToast({ variant: 'success', title: 'Activity logged', message: 'Interaction saved to timeline.' });
    },
    onSettled: (_res, _err, vars) => {
      if (vars?.caseId) {
        queryClient.invalidateQueries({ queryKey: ['caseActivity', vars.caseId] });
      }
    },
  });

  const resendMessage = useResendMessage({
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'Message queued', message: 'A retry was queued successfully.' });
      if (caseId) {
        queryClient.invalidateQueries({ queryKey: ['caseMessages', caseId] });
        queryClient.invalidateQueries({ queryKey: activityQueryKey });
      }
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Retry failed', message: err?.message || 'Unable to queue retry.' });
    },
  });

const manualTags = useMemo(() => (
  Array.isArray(data?.manual_tags) ? Array.from(new Set(data.manual_tags)).sort() : []
), [data]);

const systemFlags = useMemo(() => {
  if (!data) return [];
  const out = new Set();
  (data.tags || []).forEach((tag) => out.add(tag));
  if (data.needs_attention) out.add('needs_attention');
  (data.attention_reasons || []).forEach((tag) => out.add(tag));
  return Array.from(out).sort();
}, [data]);

  const crmDetails = useMemo(() => (
    data?.crm_details || {
      qualificationNotes: '',
      documents: [],
      followUpAt: null,
      assignedTo: '',
      acceptance: { accepted: false, acceptedAt: null, notes: '' },
      denial: { denied: false, deniedAt: null, reason: '', notes: '' },
    }
  ), [data]);

  const attachments = useMemo(
    () => (Array.isArray(crmDetails.attachments) ? crmDetails.attachments : []),
    [crmDetails]
  );

  const checklistItems = useMemo(
    () => (Array.isArray(crmDetails.documents) ? crmDetails.documents : []),
    [crmDetails]
  );

  const missingRequiredDocs = useMemo(
    () => checklistItems.filter((item) => item.required && item.status !== 'completed'),
    [checklistItems]
  );

  const followUpDisplay = crmDetails.followUpAt ? formatRelative(crmDetails.followUpAt) : '—';
  const lastContactDisplay = data?.last_contact_at ? formatRelative(data.last_contact_at) : '—';
  const totalChecklist = checklistItems.length;
  const completedChecklist = checklistItems.filter((item) => item.status === 'completed').length;
  const requiredTotal = checklistItems.filter((item) => item.required).length;
  const requiredCompleted = requiredTotal - missingRequiredDocs.length;
  const checklistProgress = totalChecklist ? Math.round((completedChecklist / totalChecklist) * 100) : 0;
  const stageDisplay = stageLabel(data?.crm_stage || 'new');

  const [qualificationNotes, setQualificationNotes] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [decision, setDecision] = useState('pending');
  const [acceptanceNotes, setAcceptanceNotes] = useState('');
  const [denialReason, setDenialReason] = useState('');
  const [denialNotes, setDenialNotes] = useState('');
  const [stageDraft, setStageDraft] = useState('new');
  const [stageChangeNote, setStageChangeNote] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploadNote, setUploadNote] = useState('');
  const [uploadChecklistKey, setUploadChecklistKey] = useState('');
  const [activityNote, setActivityNote] = useState('');
  const [activityOutcome, setActivityOutcome] = useState('');
  const [activityFollowUp, setActivityFollowUp] = useState('');
  const [activePanel, setActivePanel] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    setQualificationNotes(crmDetails.qualificationNotes || '');
    setAssignedTo(crmDetails.assignedTo || '');
    setAcceptanceNotes(crmDetails.acceptance?.notes || '');
    setDenialReason(crmDetails.denial?.reason || '');
    setDenialNotes(crmDetails.denial?.notes || '');
    if (crmDetails.followUpAt) {
      const dt = new Date(crmDetails.followUpAt);
      setFollowUpAt(Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 16));
    } else {
      setFollowUpAt('');
    }
    if (crmDetails.acceptance?.accepted) {
      setDecision('accepted');
    } else if (crmDetails.denial?.denied) {
      setDecision('denied');
    } else {
      setDecision('pending');
    }
    setStageDraft(data?.crm_stage || 'new');
  }, [crmDetails, data?.crm_stage]);

  const messageCount = Array.isArray(messagesData?.items) ? messagesData.items.length : 0;
  const latestMessage = messageCount ? messagesData.items[0] : null;
  const activityCount = Array.isArray(activityData?.events) ? activityData.events.length : 0;
  const lastActivity = activityCount ? activityData.events[0] : null;

    const panelCards = useMemo(
    () => [
      {
        id: 'crm',
        title: 'CRM workspace',
        description: 'Update stage, qualifications, and decisions.',
        metric: stageDisplay,
        meta:
          requiredTotal > 0
            ? `${requiredCompleted}/${requiredTotal} required docs`
            : totalChecklist
              ? `${completedChecklist}/${totalChecklist} tasks complete`
              : 'No checklist configured',
      },
      {
        id: 'documents',
        title: 'Documents',
        description: 'Upload evidence and link checklist items.',
        metric: `${attachments.length} document${attachments.length === 1 ? '' : 's'}`,
        meta: missingRequiredDocs.length
          ? `${missingRequiredDocs.length} required pending`
          : 'All required docs collected',
      },
      {
        id: 'communications',
        title: 'Communications',
        description: 'Review inbound and outbound outreach.',
        metric: `${messageCount} message${messageCount === 1 ? '' : 's'}`,
        meta: latestMessage
          ? `Last ${formatRelative(latestMessage.sentAt || latestMessage.deliveredAt || latestMessage.createdAt)}`
          : 'No messages yet',
      },
      {
        id: 'activity',
        title: 'Activity log',
        description: 'Trace notes, automations, and stage changes.',
        metric: `${activityCount} event${activityCount === 1 ? '' : 's'}`,
        meta: lastActivity ? `Last ${formatRelative(lastActivity.occurredAt)}` : 'No activity logged',
      },
    ],
    [
      stageDisplay,
      requiredTotal,
      requiredCompleted,
      totalChecklist,
      completedChecklist,
      attachments.length,
      missingRequiredDocs.length,
      messageCount,
      latestMessage,
      activityCount,
      lastActivity,
    ]
  );

  const renderChecklist = () => {
    if (!totalChecklist) {
      return (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
          No checklist items configured yet.
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {checklistItems.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <div>
              <div className="font-medium text-slate-800">{item.label}</div>
              <div className="text-xs text-slate-500">
                {item.required ? 'Required' : 'Optional'}
                {item.status === 'completed' && item.completedAt
                  ? ` • Completed ${formatRelative(item.completedAt)}`
                  : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => toggleChecklistItem(item)}
              disabled={updateCrm.isPending}
              className={`rounded-full border px-3 py-1 text-xs ${
                item.status === 'completed'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-slate-300 text-slate-600 hover:border-blue-300 hover:text-blue-600'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {item.status === 'completed' ? 'Completed' : 'Mark complete'}
            </button>
          </div>
        ))}
      </div>
    );
  };

  const renderCrmWorkspace = () => (
    <div className="space-y-6">
      <SectionCard title="Stage & ownership" subtitle="Advance the client through the onboarding flow">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="workspace-stage-select">
                Stage
              </label>
              <CrmStageSelect
                id="workspace-stage-select"
                value={stageDraft}
                onChange={(e) => setStageDraft(e.target.value)}
                stageOptions={stageOptions}
                disabled={updateStage.isPending}
                className="mt-1"
              />
            </div>
            <textarea
              value={stageChangeNote}
              onChange={(e) => setStageChangeNote(e.target.value)}
              rows={3}
              placeholder="Add stage note (optional)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={updateStage.isPending}
            />
            {missingRequiredDocs.length ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Complete required checklist items before accepting: {missingRequiredDocs.map((item) => item.label).join(', ')}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleStageSave}
                disabled={updateStage.isPending}
                className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {updateStage.isPending ? 'Updating…' : 'Update stage'}
              </button>
              <button
                type="button"
                onClick={scrollToChecklist}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              >
                View checklist
              </button>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Checklist progress</div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span>{completedChecklist}/{totalChecklist || 0} items</span>
              <span>{checklistProgress}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${checklistProgress}%` }} />
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {missingRequiredDocs.length
                ? `${missingRequiredDocs.length} required item${missingRequiredDocs.length === 1 ? '' : 's'} outstanding.`
                : 'All required documents collected.'}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Qualification & decision" subtitle="Capture intake notes, assignments, and outcomes">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Qualification notes</label>
            <textarea
              value={qualificationNotes}
              onChange={(e) => setQualificationNotes(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Follow-up</label>
            <input
              type="datetime-local"
              value={followUpAt}
              onChange={(e) => setFollowUpAt(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned to</label>
            <input
              type="text"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              placeholder="user@company.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Decision</label>
            <div className="flex gap-3 text-sm">
              {['pending', 'accepted', 'denied'].map((opt) => (
                <label key={opt} className="inline-flex items-center gap-1">
                  <input
                    type="radio"
                    value={opt}
                    checked={decision === opt}
                    onChange={(e) => setDecision(e.target.value)}
                  />
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </label>
              ))}
            </div>
            {decision === 'accepted' ? (
              <textarea
                value={acceptanceNotes}
                onChange={(e) => setAcceptanceNotes(e.target.value)}
                placeholder="Acceptance notes"
                rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            ) : null}
            {decision === 'denied' ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={denialReason}
                  onChange={(e) => setDenialReason(e.target.value)}
                  placeholder="Denial reason"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
                <textarea
                  value={denialNotes}
                  onChange={(e) => setDenialNotes(e.target.value)}
                  placeholder="Additional notes"
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
            ) : null}
          </div>

          <div className="space-y-2 text-sm text-slate-500">
            <div>
              <span className="font-semibold text-slate-700">Current acceptance</span>: {crmDetails.acceptance?.accepted ? 'Accepted' : 'Not accepted'}
            </div>
            <div>
              <span className="font-semibold text-slate-700">Current denial</span>: {crmDetails.denial?.denied ? crmDetails.denial.reason || 'Denied' : 'Not denied'}
            </div>
            {crmDetails.documents?.length ? (
              <div>
                <span className="font-semibold text-slate-700">Documents</span>
                <ul className="mt-1 list-disc pl-4 text-xs">
                  {crmDetails.documents.map((doc, idx) => (
                    <li key={idx}>
                      {doc.label} — {doc.status === 'completed' ? 'completed' : 'pending'}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleCrmSave}
            disabled={updateCrm.isPending}
            className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updateCrm.isPending ? 'Saving…' : 'Save CRM details'}
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Stage history" subtitle="Track recent transitions and notes">
        <div className="space-y-3">
          <ul className="space-y-2 text-sm text-slate-600">
            {(Array.isArray(data.crm_stage_history) ? data.crm_stage_history : []).slice().reverse().map((entry, idx) => (
              <li key={idx} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{entry.actor || 'system'}</span>
                  <span>{formatRelative(entry.changedAt)}</span>
                </div>
                <div className="text-sm font-medium text-slate-800">{stageLabel(entry.stage || '')}</div>
                {entry.note ? <div className="text-xs text-slate-500">{entry.note}</div> : null}
              </li>
            ))}
            {(Array.isArray(data.crm_stage_history) ? data.crm_stage_history : []).length === 0 ? (
              <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                No stage changes recorded yet.
              </li>
            ) : null}
          </ul>
        </div>
      </SectionCard>
    </div>
  );

  const renderDocumentsWorkspace = () => (
    <SectionCard title="Documents" subtitle="Upload and manage supporting files">
      {attachments.length ? (
        <ul className="space-y-2">
          {attachments.map((file, idx) => (
            <li
              key={`${file.filename || file.url || idx}`}
              className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 md:flex-row md:items-center md:justify-between"
            >
              <div>
                <div className="font-medium text-slate-800">{file.label || file.originalName || file.filename || `Attachment ${idx + 1}`}</div>
                <div className="text-xs text-slate-500">
                  {formatRelative(file.uploadedAt)} • {formatFileSize(file.size)} • {file.mimeType || 'unknown type'}
                </div>
                {file.note ? <div className="text-xs text-slate-500">{file.note}</div> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {file.checklistKey ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                    Linked: {file.checklistKey.replace(/_/g, ' ')}
                  </span>
                ) : null}
                {file.url ? (
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-blue-700 hover:bg-blue-100"
                  >
                    View
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
          No documents attached yet.
        </div>
      )}

      <form
        onSubmit={handleDocumentUpload}
        className="mt-4 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
      >
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            className="w-full text-sm"
            disabled={uploadDocument.isPending}
          />
          <input
            type="text"
            value={uploadLabel}
            onChange={(e) => setUploadLabel(e.target.value)}
            placeholder="Label (optional)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={uploadDocument.isPending}
          />
          <textarea
            value={uploadNote}
            onChange={(e) => setUploadNote(e.target.value)}
            rows={2}
            placeholder="Internal note (optional)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={uploadDocument.isPending}
          />
        </div>
        <div className="space-y-2">
          <select
            value={uploadChecklistKey}
            onChange={(e) => setUploadChecklistKey(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={uploadDocument.isPending}
          >
            <option value="">Link to checklist (optional)</option>
            {checklistItems.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={uploadDocument.isPending}
            className="w-full rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploadDocument.isPending ? 'Uploading…' : 'Upload document'}
          </button>
        </div>
      </form>
    </SectionCard>
  );

  const renderCommunicationsWorkspace = () => (
    <SectionCard
      title="Communications"
      subtitle={messagesLoading ? 'Loading messages…' : `${messageCount} message${messageCount === 1 ? '' : 's'}`}
    >
      {messagesError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Failed to load messages.
        </div>
      ) : messagesLoading ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
          Loading communications…
        </div>
      ) : messageCount === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
          No messages logged for this case yet.
        </div>
      ) : (
        <div className="space-y-3">
          {messagesData?.items?.map((msg) => (
            <article key={msg._id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{msg.direction?.toUpperCase() || '—'}</span>
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{msg.channel?.toUpperCase() || '—'}</span>
                  <span className={`inline-flex rounded-full px-2 py-0.5 ${
                    msg.status === 'failed'
                      ? 'bg-rose-50 text-rose-700'
                      : msg.status === 'queued'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-emerald-50 text-emerald-700'
                  }`}>
                    {msg.status || 'unknown'}
                  </span>
                </div>
                <div className="text-xs text-slate-500">{formatRelative(msg.sentAt || msg.deliveredAt || msg.createdAt)}</div>
              </div>
              {msg.body ? <p className="mt-2 text-sm text-slate-700 whitespace-pre-line">{msg.body}</p> : null}
              {msg.status === 'failed' && (msg.errorMessage || msg.errorCode) ? (
                <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {(msg.errorMessage || '').trim() || 'Delivery failed.'}
                  {msg.errorCode ? <span className="ml-2 font-mono">[{msg.errorCode}]</span> : null}
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!caseId || !msg.id) return;
                        resendMessage.mutate({ caseId, messageId: msg.id });
                      }}
                      disabled={resendMessage.isPending}
                      className="rounded-lg border border-rose-300 bg-white px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {resendMessage.isPending ? 'Retrying…' : 'Retry message'}
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/messages?compose=retry&case=${caseId}&message=${msg.id || ''}`)}
                      className="ml-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                    >
                      Edit & resend
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </SectionCard>
  );

  const renderActivityWorkspace = () => (
    <SectionCard
      title="Activity"
      subtitle={activityLoading
        ? 'Loading activity…'
        : createActivity.isPending
          ? 'Logging activity…'
          : `${activityCount} event${activityCount === 1 ? '' : 's'}`}
    >
      <form
        onSubmit={handleActivitySubmit}
        className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
      >
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="activity-note">
            Note
          </label>
          <textarea
            id="activity-note"
            value={activityNote}
            onChange={(e) => setActivityNote(e.target.value)}
            rows={3}
            placeholder="Log a call, meeting, or internal observation"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={createActivity.isPending}
          />
        </div>
        <div className="grid gap-2">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="activity-outcome">
              Outcome (optional)
            </label>
            <input
              id="activity-outcome"
              type="text"
              value={activityOutcome}
              onChange={(e) => setActivityOutcome(e.target.value)}
              placeholder="e.g., Left voicemail, Completed intake"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={createActivity.isPending}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="activity-followup">
              Follow-up (optional)
            </label>
            <input
              id="activity-followup"
              type="datetime-local"
              value={activityFollowUp}
              onChange={(e) => setActivityFollowUp(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={createActivity.isPending}
            />
          </div>
          <button
            type="submit"
            disabled={createActivity.isPending}
            className="mt-auto rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {createActivity.isPending ? 'Saving…' : 'Log activity'}
          </button>
        </div>
      </form>

      {activityError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Failed to load activity.
        </div>
      ) : activityLoading ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
          Loading activity…
        </div>
      ) : activityCount === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
          No recent activity to display.
        </div>
      ) : (
        <ul className="space-y-3">
          {(activityData?.events || []).map((event, idx) => (
            <li key={`${event.type}-${idx}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{event.title}</div>
                  {event.details ? <div className="text-xs text-slate-500">{event.details}</div> : null}
                  {event.actor ? <div className="text-[11px] text-slate-400">By {event.actor}</div> : null}
                </div>
                <div className="text-xs text-slate-500">{formatRelative(event.occurredAt)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DetailItem label="Created" value={formatDateTime(data.createdAt)} />
        <DetailItem label="Updated" value={formatDateTime(data.updatedAt)} />
        <DetailItem label="Time bucket" value={data.time_bucket || '—'} />
        <DetailItem label="Anchor" value={data._upsert_key?.anchor || '—'} />
      </div>
    </SectionCard>
  );

  const renderWorkspaceContent = () => {
    if (!activePanel) {
      return (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
          Select a workspace tile above to open detailed tools.
        </div>
      );
    }

    if (activePanel === 'crm') return renderCrmWorkspace();
    if (activePanel === 'documents') return renderDocumentsWorkspace();
    if (activePanel === 'communications') return renderCommunicationsWorkspace();
    if (activePanel === 'activity') return renderActivityWorkspace();

    return null;
  };

  const handleCrmSave = () => {
    if (!caseId) return;
    const payload = {
      qualificationNotes,
      followUpAt: followUpAt ? new Date(followUpAt).toISOString() : null,
      assignedTo,
    };

    if (decision === 'accepted') {
      payload.acceptance = {
        accepted: true,
        acceptedAt: new Date().toISOString(),
        notes: acceptanceNotes,
      };
      payload.denial = { denied: false, reason: '', notes: '', deniedAt: null };
    } else if (decision === 'denied') {
      payload.denial = {
        denied: true,
        deniedAt: new Date().toISOString(),
        reason: denialReason,
        notes: denialNotes,
      };
      payload.acceptance = { accepted: false, notes: '', acceptedAt: null };
    } else {
      payload.acceptance = { accepted: false, notes: acceptanceNotes, acceptedAt: null };
      payload.denial = { denied: false, reason: denialReason, notes: denialNotes, deniedAt: null };
    }

    updateCrm.mutate({ caseId, payload });
  };

    if (!caseId) return;
    const payload = {
      qualificationNotes,
      followUpAt: followUpAt ? new Date(followUpAt).toISOString() : null,
      assignedTo,
    };

    if (decision === 'accepted') {
      payload.acceptance = {
        accepted: true,
        acceptedAt: new Date().toISOString(),
      };
      payload.acceptance.notes = acceptanceNotes;
      payload.denial = { denied: false, reason: '', notes: '', deniedAt: null };
    } else if (decision === 'denied') {
      payload.denial = {
        denied: true,
        deniedAt: new Date().toISOString(),
        reason: denialReason,
        notes: denialNotes,
      };
      payload.acceptance = { accepted: false, notes: '', acceptedAt: null };
    } else {
      payload.acceptance = { accepted: false, notes: acceptanceNotes, acceptedAt: null };
      payload.denial = { denied: false, reason: denialReason, notes: denialNotes, deniedAt: null };
    }

    updateCrm.mutate({ caseId, payload });
  };

  const toggleChecklistItem = (item) => {
    if (!caseId) return;
    const docs = crmDetails.documents || [];
    const updatedDocs = docs.map((doc) => {
      if (doc.key !== item.key) return doc;
      if (doc.status === 'completed') {
        return { ...doc, status: 'pending', completedAt: null };
      }
      return { ...doc, status: 'completed', completedAt: new Date().toISOString() };
    });
    updateCrm.mutate({ caseId, payload: { documents: updatedDocs } });
  };

  const handlePanelSelect = (id) => {
    setActivePanel((prev) => (prev === id ? '' : id));
  };

  const scrollToChecklist = () => {
    if (typeof window === 'undefined') return;
    const el = document.getElementById('case-checklist');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleStageSave = () => {
    if (!caseId) return;
    if (!stageDraft) {
      pushToast({ variant: 'warn', title: 'Select stage', message: 'Choose a stage before saving.' });
      return;
    }
    if (stageDraft === (data?.crm_stage || 'new') && !stageChangeNote.trim()) {
      pushToast({ variant: 'info', title: 'No changes', message: 'Select a different stage or include a note.' });
      return;
    }
    if (stageDraft === 'accepted' && missingRequiredDocs.length) {
      pushToast({
        variant: 'warn',
        title: 'Checklist incomplete',
        message: 'Complete all required checklist items before marking the case as accepted.',
      });
      return;
    }
    updateStage.mutate({ caseId, stage: stageDraft, note: stageChangeNote.trim() || undefined });
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    setUploadFile(file || null);
  };

  const handleDocumentUpload = (event) => {
    event.preventDefault();
    if (!caseId || !uploadFile) {
      pushToast({ variant: 'warn', title: 'Select a file', message: 'Choose a document to upload.' });
      return;
    }
    uploadDocument.mutate({
      caseId,
      file: uploadFile,
      label: uploadLabel.trim() || undefined,
      note: uploadNote.trim() || undefined,
      checklistKey: uploadChecklistKey || undefined,
    });
  };

  const handleActivitySubmit = (event) => {
    event.preventDefault();
    if (!caseId) return;
    if (!activityNote.trim()) {
      pushToast({ variant: 'warn', title: 'Note required', message: 'Add a quick note before logging activity.' });
      return;
    }

    const payload = { note: activityNote.trim() };
    if (activityOutcome.trim()) payload.outcome = activityOutcome.trim();
    if (activityFollowUp) {
      const dt = new Date(activityFollowUp);
      if (Number.isNaN(dt.getTime())) {
        pushToast({ variant: 'warn', title: 'Invalid follow-up', message: 'Select a valid follow-up date and time.' });
        return;
      }
      payload.followUpAt = dt.toISOString();
    }

    createActivity.mutate({ caseId, payload });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={data?.full_name || 'Case detail'}
        subtitle={data?.case_number ? `Case #${data.case_number}` : 'Full record overview'}
        actions={(
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:border-blue-300"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-400"
            >
              Back
            </button>
          </div>
        )}
      />

      {isLoading ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
          Loading case details…
        </div>
      ) : null}

      {isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Failed to load case: {error?.message || 'Unknown error'}
        </div>
      ) : null}

      {!isLoading && !isError && !data ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Case not found.
        </div>
      ) : null}

      {data ? (
        <>
          <SectionCard title="Case overview" subtitle="Track onboarding progress at a glance">
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Onboarding progress</span>
                  <span>{completedChecklist}/{totalChecklist || 0} items complete</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${checklistProgress}%` }} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <SummaryStat label="Stage" value={stageDisplay} />
                <SummaryStat label="Bond" value={formatMoney(data.bond_amount)} tone="info" />
                <SummaryStat label="Assigned to" value={crmDetails.assignedTo || 'Unassigned'} />
                <SummaryStat label="Next follow-up" value={followUpDisplay} tone={crmDetails.followUpAt ? 'info' : 'default'} />
                <SummaryStat
                  label="Last contact"
                  value={lastContactDisplay}
                  tone={data.contacted ? 'success' : 'default'}
                  hint={data.contacted ? 'Contacted' : 'No outreach yet'}
                />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Case summary" subtitle="Reference details for this client file">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-3">
                <DetailItem label="Case number" value={data.case_number || '—'} />
                <DetailItem label="Booking number" value={data.booking_number || '—'} />
                <DetailItem label="County" value={data.county || '—'} />
                <DetailItem label="Category" value={data.category || '—'} />
                <DetailItem label="Agency" value={data.agency || '—'} />
                <DetailItem label="Facility" value={data.facility || '—'} />
                <DetailItem label="Status" value={data.status || '—'} />
              </div>
              <div className="space-y-3">
                <DetailItem label="Primary charge" value={data.charge || data.offense || '—'} />
                <DetailItem label="Manual tags">
                  <div className="mt-1 flex flex-wrap gap-2">
                    {manualTags.length === 0 ? <span className="text-slate-500">None</span> : null}
                    {manualTags.map((tag) => (
                      <span key={`manual-${tag}`} className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                        {tag.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </DetailItem>
                <DetailItem label="System flags">
                  <div className="mt-1 flex flex-wrap gap-2">
                    {systemFlags.length === 0 ? <span className="text-slate-500">None</span> : null}
                    {systemFlags.map((tag) => (
                      <span key={`flag-${tag}`} className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                        {tag.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </DetailItem>
                <DetailItem label="Source" value={data.source || '—'} />
                <DetailItem label="Updated" value={formatDateTime(data.updatedAt || data.normalized_at)} />
              </div>
            </div>
          </SectionCard>

          <div id="case-checklist">
            <SectionCard
              title="Onboarding checklist"
              subtitle="Mark tasks complete to unlock later stages"
            >
              <div className="mt-3">{renderChecklist()}</div>
            </SectionCard>
          </div>

          <SectionCard
            title="Workspaces"
            subtitle="Choose a panel to open the right toolkit for this case"
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {panelCards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => handlePanelSelect(card.id)}
                  className={`rounded-2xl border px-4 py-4 text-left shadow-sm transition ${
                    activePanel === card.id
                      ? 'border-blue-400 bg-blue-50 text-blue-800'
                      : 'border-slate-200 bg-white text-slate-800 hover:border-blue-300 hover:shadow'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold">{card.title}</h3>
                    <span className={`text-xs font-semibold ${activePanel === card.id ? 'text-blue-600' : 'text-slate-400'}`}>
                      {activePanel === card.id ? 'Open' : 'Select'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{card.description}</p>
                  <div className="mt-3 text-sm font-semibold text-slate-900">{card.metric}</div>
                  <div className="text-xs text-slate-500">{card.meta}</div>
                </button>
              ))}
            </div>
          </SectionCard>

          {renderWorkspaceContent()}
        </>
      ) : null}

    </div>
  );
}

function DetailItem({ label, value, children }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {children ? (
        children
      ) : (
        <div className="mt-1 text-sm text-slate-800">{value}</div>
      )}
    </div>
  );
}
