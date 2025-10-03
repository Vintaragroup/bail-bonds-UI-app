import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader, SectionCard } from '../components/PageToolkit';
import CrmStageSelect from '../components/CrmStageSelect';
import {
  useCase,
  useCaseMeta,
  useCaseMessages,
  useCaseActivity,
  useResendMessage,
  useUpdateCaseCrm,
  useUploadCaseDocument,
  useUpdateCaseDocument,
  useDeleteCaseDocument,
  useCreateCaseActivity,
  useUpdateCaseStage,
  useEnrichmentProviders,
  useCaseEnrichment,
  useRunCaseEnrichment,
  useSelectCaseEnrichment,
} from '../hooks/cases';
import { useToast } from '../components/ToastContext';
import { stageLabel } from '../lib/stage';
import { useUser } from '../components/UserContext';

const formatMoney = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return `$${num.toLocaleString()}`;
};

const formatRelative = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

const formatFileSize = (bytes) => {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return '—';
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const splitCaseName = (value = '') => {
  const source = String(value || '').trim();
  if (!source) {
    return { firstName: '', lastName: '', fullName: '' };
  }
  const parts = source.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '', fullName: source };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
    fullName: source,
  };
};

const formatAddressDisplay = (address) => {
  if (!address || typeof address !== 'object') return '';
  const line1 = address.streetLine1 || address.line1 || '';
  const line2 = address.streetLine2 || address.line2 || '';
  const city = address.city || '';
  const state = address.stateCode || address.state || '';
  const postal = address.postalCode || address.zip || '';

  const cityState = [city, state].filter(Boolean).join(', ');
  const parts = [line1, line2, cityState, postal].filter((part) => part && part.trim().length > 0);
  return parts.join('\n');
};

const FOLLOW_UP_PRESETS = [
  { id: 'today', label: 'Later today', offsetHours: 4 },
  { id: 'tomorrow', label: 'Tomorrow 9am', offsetDays: 1, setHour: 9 },
  { id: 'threeDays', label: 'In 3 days', offsetDays: 3, setHour: 9 },
  { id: 'nextWeek', label: 'Next week', offsetDays: 7, setHour: 9 },
];

const ACTIVITY_PRESETS = [
  { id: 'left-voicemail', label: 'Left voicemail', note: 'Left voicemail for client.', followOffsetDays: 1, followHour: 10 },
  { id: 'spoke-client', label: 'Spoke with client', note: 'Spoke with client and confirmed next steps.', followOffsetDays: 2, followHour: 9 },
  { id: 'text-sent', label: 'Sent text message', note: 'Sent follow-up text message.', followOffsetDays: 1, followHour: 12 },
  { id: 'docs-requested', label: 'Requested documents', note: 'Requested required documents from client.', followOffsetDays: 3, followHour: 11 },
];

const createEmptyCrmDetails = () => ({
  qualificationNotes: '',
  documents: [],
  followUpAt: null,
  assignedTo: '',
  address: { streetLine1: '', streetLine2: '', city: '', stateCode: '', postalCode: '' },
  phone: '',
  acceptance: { accepted: false, acceptedAt: null, notes: '' },
  denial: { denied: false, deniedAt: null, reason: '', notes: '' },
  attachments: [],
});

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'crm', label: 'CRM' },
  { id: 'enrichment', label: 'Enrichment' },
  { id: 'documents', label: 'Documents' },
  { id: 'communications', label: 'Comms' },
  { id: 'activity', label: 'Activity' },
];

export default function CaseDetail() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const { caseId } = useParams();
  const [searchParams] = useSearchParams();

  const { data, isLoading, isError, error, refetch } = useCase(caseId);
  const { data: meta } = useCaseMeta();
  const { data: messagesData, isLoading: messagesLoading, isError: messagesError } = useCaseMessages(caseId);
  const { data: activityData, isLoading: activityLoading, isError: activityError } = useCaseActivity(caseId);
  const { currentUser } = useUser();

  const updateCrm = useUpdateCaseCrm({
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'CRM updated', message: 'Case CRM details saved.' });
      if (caseId) {
        queryClient.invalidateQueries({ queryKey: ['case', caseId] });
        queryClient.invalidateQueries({ queryKey: ['cases'] });
        queryClient.invalidateQueries({ queryKey: ['caseActivity', caseId] });
      }
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Save failed', message: err?.message || 'Unable to save CRM details.' });
    },
  });

  const updateStage = useUpdateCaseStage({
    onSuccess: (_res, vars) => {
      pushToast({ variant: 'success', title: 'Stage updated', message: 'Stage saved successfully.' });
      setStageChangeNote('');
      if (vars?.caseId) {
        queryClient.invalidateQueries({ queryKey: ['case', vars.caseId] });
        queryClient.invalidateQueries({ queryKey: ['cases'] });
        queryClient.invalidateQueries({ queryKey: ['caseActivity', vars.caseId] });
      }
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Stage update failed', message: err?.message || 'Unable to update stage.' });
    },
  });

  const uploadDocument = useUploadCaseDocument({
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'Document uploaded', message: 'Attachment added to CRM.' });
      setUploadFile(null);
      setUploadLabel('');
      setUploadNote('');
      setUploadChecklistKey('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      if (caseId) {
        queryClient.invalidateQueries({ queryKey: ['case', caseId] });
        queryClient.invalidateQueries({ queryKey: ['caseActivity', caseId] });
      }
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Upload failed', message: err?.message || 'Unable to upload document.' });
    },
  });

  const ageInfo = useMemo(() => {
    const ref = data?.booking_date;
    if (!ref) return { label: '—', hours: null, days: null };
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(ref) ? `${ref}T00:00:00Z` : ref;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { label: '—', hours: null, days: null };
    const diffMs = Date.now() - d.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    const label = hours < 24 ? `${hours}h` : `${days}d ${hours % 24}h`;
    return { label, hours, days };
  }, [data?.booking_date]);

  const updateAttachment = useUpdateCaseDocument({
    onSuccess: (response, vars) => {
      const attachment = response?.attachment;
      if (vars?.caseId && attachment) {
        queryClient.setQueryData(['case', vars.caseId], (old) => {
          if (!old) return old;
          const oldAttachments = Array.isArray(old.crm_details?.attachments)
            ? old.crm_details.attachments.slice()
            : [];
          const idx = oldAttachments.findIndex((att) => att?.id === attachment.id);
          if (idx !== -1) {
            oldAttachments[idx] = { ...oldAttachments[idx], ...attachment };
          }
          return {
            ...old,
            crm_details: {
              ...old.crm_details,
              attachments: oldAttachments,
            },
          };
        });
        queryClient.invalidateQueries({ queryKey: ['case', vars.caseId] });
        queryClient.invalidateQueries({ queryKey: ['caseActivity', vars.caseId] });
      }
      cancelAttachmentEdit();
      pushToast({ variant: 'success', title: 'Document updated', message: 'Attachment details saved.' });
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Update failed', message: err?.message || 'Unable to update document.' });
    },
  });

  const deleteAttachment = useDeleteCaseDocument({
    onSuccess: (response, vars) => {
      const removed = response?.removed;
      if (vars?.caseId) {
        queryClient.setQueryData(['case', vars.caseId], (old) => {
          if (!old) return old;
          const oldAttachments = Array.isArray(old.crm_details?.attachments)
            ? old.crm_details.attachments.filter((att) => att?.id !== (removed?.id || vars.attachmentId))
            : [];
          return {
            ...old,
            crm_details: {
              ...old.crm_details,
              attachments: oldAttachments,
            },
          };
        });
        queryClient.invalidateQueries({ queryKey: ['case', vars.caseId] });
        queryClient.invalidateQueries({ queryKey: ['caseActivity', vars.caseId] });
      }
      if (editingAttachmentId && editingAttachmentId === (vars?.attachmentId || removed?.id)) {
        cancelAttachmentEdit();
      }
      pushToast({ variant: 'success', title: 'Document removed', message: 'Attachment deleted from CRM.' });
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Delete failed', message: err?.message || 'Unable to delete document.' });
    },
    onSettled: () => {
      setDeletingAttachmentId('');
    },
  });

  const createActivity = useCreateCaseActivity({
    onSuccess: (_res, vars) => {
      pushToast({ variant: 'success', title: 'Activity logged', message: 'Interaction saved to timeline.' });
      setActivityNote('');
      setActivityOutcome('');
      setActivityFollowUp('');
      if (vars?.caseId) {
        queryClient.invalidateQueries({ queryKey: ['caseActivity', vars.caseId] });
        queryClient.invalidateQueries({ queryKey: ['case', vars.caseId] });
      }
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Save failed', message: err?.message || 'Unable to log activity.' });
    },
  });

  const resendMessage = useResendMessage({
    onSuccess: (_res, vars) => {
      pushToast({ variant: 'success', title: 'Message queued', message: 'A retry was queued successfully.' });
      if (vars?.caseId) {
        queryClient.invalidateQueries({ queryKey: ['caseMessages', vars.caseId] });
        queryClient.invalidateQueries({ queryKey: ['caseActivity', vars.caseId] });
      }
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Retry failed', message: err?.message || 'Unable to queue retry.' });
    },
  });

  const crmDetails = useMemo(() => {
    const defaults = createEmptyCrmDetails();
    if (!data?.crm_details) return defaults;
    const base = data.crm_details;
    const acceptance = {
      ...defaults.acceptance,
      ...(base.acceptance || {}),
      accepted: Boolean(base.acceptance?.accepted),
    };
    const denial = {
      ...defaults.denial,
      ...(base.denial || {}),
      denied: Boolean(base.denial?.denied),
    };
    return {
      ...defaults,
      ...base,
      qualificationNotes: base.qualificationNotes ?? defaults.qualificationNotes,
      followUpAt: base.followUpAt ?? defaults.followUpAt,
      assignedTo: base.assignedTo ?? defaults.assignedTo,
      documents: Array.isArray(base.documents) ? base.documents : defaults.documents,
      attachments: Array.isArray(base.attachments) ? base.attachments : defaults.attachments,
      acceptance,
      denial,
    };
  }, [data?.crm_details]);

  const manualTags = useMemo(
    () => (Array.isArray(data?.manual_tags) ? Array.from(new Set(data.manual_tags)).sort() : []),
    [data?.manual_tags]
  );

  const checklistItems = crmDetails.documents;
  const attachments = crmDetails.attachments;

  const totalChecklist = checklistItems.length;
  const completedChecklist = checklistItems.filter((item) => item?.status === 'completed').length;
  const requiredChecklist = checklistItems.filter((item) => item?.required).length;
  const requiredCompleted = checklistItems.filter((item) => item?.required && item?.status === 'completed').length;
  const missingRequiredDocs = checklistItems.filter((item) => item?.required && item?.status !== 'completed');
  const checklistProgress = totalChecklist ? Math.round((completedChecklist / totalChecklist) * 100) : 0;

  const stageDisplay = stageLabel(data?.crm_stage || 'new');
  const followUpDisplay = formatRelative(crmDetails.followUpAt);
  const lastContactDisplay = formatRelative(data?.last_contact_at);
  const bondDisplay = (() => {
    const numeric = formatMoney(data?.bond_amount);
    if (numeric) return numeric;
    if (data?.bond_status) return data.bond_status.replace(/_/g, ' ');
    if (data?.bond_label) return data.bond_label;
    if (data?.bond) return String(data.bond);
    return '—';
  })();

  const stageOptions = useMemo(
    () => (Array.isArray(meta?.stages) && meta.stages.length ? meta.stages : undefined),
    [meta]
  );

  const messageItems = Array.isArray(messagesData?.items) ? messagesData.items : [];
  const messageCount = messageItems.length;

  const activityEvents = Array.isArray(activityData?.events) ? activityData.events : [];
  const activityCount = activityEvents.length;
  const contactAddressDisplay = useMemo(
    () => formatAddressDisplay(data?.crm_details?.address || data?.address || null),
    [data?.crm_details?.address, data?.address]
  );
  const contactPhoneDisplay = useMemo(() => {
    const phone = data?.crm_details?.phone || data?.phone || data?.primary_phone;
    if (!phone || typeof phone !== 'string') return '';
    return phone;
  }, [data?.crm_details?.phone, data?.phone, data?.primary_phone]);
  const { data: enrichmentProvidersData } = useEnrichmentProviders();
  const providerOptions = Array.isArray(enrichmentProvidersData?.providers)
    ? enrichmentProvidersData.providers
    : [];
  const providersLoaded = Boolean(enrichmentProvidersData);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const defaultProviderId = useMemo(() => {
    const flagged = providerOptions.find((provider) => provider.default);
    return flagged?.id || providerOptions[0]?.id || '';
  }, [providerOptions]);

  useEffect(() => {
    if (!providerOptions.length) {
      setSelectedProviderId('');
    } else if (!selectedProviderId && defaultProviderId) {
      setSelectedProviderId(defaultProviderId);
    }
  }, [providerOptions, selectedProviderId, defaultProviderId]);

  const defaultEnrichmentInput = useMemo(() => {
    const nameParts = splitCaseName(data?.full_name || '');
    const crmAddress = data?.crm_details?.address || {};
    const recordAddress = data?.address || {};
    const recordPhone = data?.crm_details?.phone || data?.phone || data?.primary_phone || '';
    return {
      fullName: nameParts.fullName,
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      city: data?.city || crmAddress.city || recordAddress.city || '',
      stateCode:
        data?.state
        || data?.stateCode
        || crmAddress.stateCode
        || recordAddress.state
        || '',
      postalCode:
        data?.postal_code
        || data?.postalCode
        || data?.zip
        || crmAddress.postalCode
        || recordAddress.postalCode
        || recordAddress.zip
        || '',
      addressLine1:
        data?.address_line_1
        || data?.addressLine1
        || crmAddress.streetLine1
        || recordAddress.line1
        || '',
      addressLine2:
        data?.address_line_2
        || data?.addressLine2
        || crmAddress.streetLine2
        || recordAddress.line2
        || '',
      phone: recordPhone,
    };
  }, [
    data?.full_name,
    data?.city,
    data?.state,
    data?.stateCode,
    data?.postal_code,
    data?.postalCode,
    data?.zip,
    data?.address_line_1,
    data?.addressLine1,
    data?.address_line_2,
    data?.addressLine2,
    data?.phone,
    data?.primary_phone,
    data?.crm_details?.address,
    data?.crm_details?.phone,
    data?.address,
  ]);

  const initialTab = (() => {
    const queryTab = searchParams.get('tab');
    return TABS.some((tab) => tab.id === queryTab) ? queryTab : 'overview';
  })();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [stageDraft, setStageDraft] = useState('new');
  const [stageChangeNote, setStageChangeNote] = useState('');
  const [qualificationNotes, setQualificationNotes] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [decision, setDecision] = useState('pending');
  const [acceptanceNotes, setAcceptanceNotes] = useState('');
  const [denialReason, setDenialReason] = useState('');
  const [denialNotes, setDenialNotes] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploadNote, setUploadNote] = useState('');
  const [uploadChecklistKey, setUploadChecklistKey] = useState('');
  const [activityNote, setActivityNote] = useState('');
  const [activityOutcome, setActivityOutcome] = useState('');
  const [activityFollowUp, setActivityFollowUp] = useState('');
  const [activityPreset, setActivityPreset] = useState('');
  // CRM contact fields
  const [contactStreet1, setContactStreet1] = useState('');
  const [contactStreet2, setContactStreet2] = useState('');
  const [contactCity, setContactCity] = useState('');
  const [contactStateCode, setContactStateCode] = useState('');
  const [contactPostalCode, setContactPostalCode] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [editingAttachmentId, setEditingAttachmentId] = useState('');
  const [attachmentLabel, setAttachmentLabel] = useState('');
  const [attachmentNote, setAttachmentNote] = useState('');
  const [attachmentChecklist, setAttachmentChecklist] = useState('');
  const [deletingAttachmentId, setDeletingAttachmentId] = useState('');
  const [enrichmentInputs, setEnrichmentInputs] = useState({});
  const currentEnrichmentInput = useMemo(() => {
    if (!selectedProviderId) return defaultEnrichmentInput;
    return enrichmentInputs[selectedProviderId] || defaultEnrichmentInput;
  }, [enrichmentInputs, selectedProviderId, defaultEnrichmentInput]);
  const [selectingRecordId, setSelectingRecordId] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    setStageDraft(data?.crm_stage || 'new');
  }, [data?.crm_stage]);

  useEffect(() => {
    if (!selectedProviderId) return;
    setEnrichmentInputs((prev) => {
      const existing = prev[selectedProviderId];
      if (existing) return prev;
      return { ...prev, [selectedProviderId]: defaultEnrichmentInput };
    });
  }, [selectedProviderId, defaultEnrichmentInput]);

  useEffect(() => {
    setQualificationNotes(crmDetails.qualificationNotes || '');
    setAssignedTo(crmDetails.assignedTo || '');
    setAcceptanceNotes(crmDetails.acceptance?.notes || '');
    setDenialReason(crmDetails.denial?.reason || '');
    setDenialNotes(crmDetails.denial?.notes || '');
    const addr = crmDetails.address || {};
    setContactStreet1(addr.streetLine1 || '');
    setContactStreet2(addr.streetLine2 || '');
    setContactCity(addr.city || '');
    setContactStateCode(addr.stateCode || '');
    setContactPostalCode(addr.postalCode || '');
    setContactPhone(crmDetails.phone || '');

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
  }, [crmDetails]);

  useEffect(() => {
    const queryTab = searchParams.get('tab');
    if (queryTab && TABS.some((tab) => tab.id === queryTab)) {
      setActiveTab(queryTab);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!editingAttachmentId) return;
    const exists = attachments.some((att) => att?.id === editingAttachmentId);
    if (!exists) {
      cancelAttachmentEdit();
    }
  }, [attachments, editingAttachmentId]);

  const {
    data: enrichmentData,
    isLoading: enrichmentLoading,
    isFetching: enrichmentFetching,
    refetch: refetchEnrichment,
  } = useCaseEnrichment(caseId, selectedProviderId, {
    enabled: Boolean(caseId) && Boolean(selectedProviderId) && activeTab === 'enrichment',
  });

  const permittedRoles = Array.isArray(currentUser?.roles) ? currentUser.roles : [];
  const canRunEnrichment = useMemo(
    () => permittedRoles.some((role) => ['SuperUser', 'Admin', 'DepartmentLead', 'Employee'].includes(role)),
    [permittedRoles]
  );
  const canForceByRole = useMemo(
    () => permittedRoles.some((role) => ['SuperUser', 'Admin'].includes(role)),
    [permittedRoles]
  );
  const activeProvider = useMemo(
    () => providerOptions.find((provider) => provider.id === selectedProviderId) || null,
    [providerOptions, selectedProviderId]
  );
  const supportsForce = Boolean(activeProvider?.supportsForce);
  const providerLabel = activeProvider?.label || (selectedProviderId ? selectedProviderId.toUpperCase() : 'Enrichment');

  const runEnrichment = useRunCaseEnrichment({
    onSuccess: (response) => {
      const count = response?.enrichment?.candidates?.length ?? 0;
      pushToast({
        variant: 'success',
        title: `${providerLabel} enrichment complete`,
        message: count ? `${count} potential matches returned.` : 'No matches were returned for this search.',
      });
      refetchEnrichment();
    },
    onError: (err) => {
      pushToast({
        variant: 'error',
        title: 'Enrichment failed',
        message: err?.message || `Unable to run ${providerLabel} enrichment right now.`,
      });
    },
  });

  const selectEnrichment = useSelectCaseEnrichment({
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Match attached',
        message: 'The selected record has been linked to this case.',
      });
      refetchEnrichment();
    },
    onError: (err) => {
      pushToast({
        variant: 'error',
        title: 'Unable to attach record',
        message: err?.message || 'Failed to attach the selected enrichment record.',
      });
    },
    onSettled: () => setSelectingRecordId(''),
  });

  const enrichmentDoc = enrichmentData?.enrichment || null;
  const enrichmentCandidates = Array.isArray(enrichmentDoc?.candidates) ? enrichmentDoc.candidates : [];
  const enrichmentSelected = Array.isArray(enrichmentDoc?.selectedRecords) ? enrichmentDoc.selectedRecords : [];
  const enrichmentSelectedSet = useMemo(
    () => new Set(enrichmentSelected.map((entry) => entry?.recordId).filter(Boolean)),
    [enrichmentSelected]
  );
  const enrichmentNextRefresh = useMemo(() => {
    if (enrichmentData?.nextRefreshAt) {
      const dt = new Date(enrichmentData.nextRefreshAt);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
    if (enrichmentDoc?.expiresAt) {
      const dt = new Date(enrichmentDoc.expiresAt);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
    return null;
  }, [enrichmentData?.nextRefreshAt, enrichmentDoc?.expiresAt]);
  const enrichmentRefreshing = activeTab === 'enrichment' && (enrichmentLoading || enrichmentFetching);

  const handleEnrichmentFieldChange = (field, value) => {
    if (!selectedProviderId) return;
    setEnrichmentInputs((prev) => ({
      ...prev,
      [selectedProviderId]: { ...currentEnrichmentInput, [field]: value },
    }));
  };

  const handleRunEnrichment = (force = false) => {
    if (!caseId || !canRunEnrichment || !selectedProviderId) return;

    const nameFromParts = `${(currentEnrichmentInput.firstName || '').trim()} ${(currentEnrichmentInput.lastName || '').trim()}`.trim();
    const payload = {
      ...currentEnrichmentInput,
      fullName: nameFromParts || currentEnrichmentInput.fullName || undefined,
    };

    const cleanedPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => {
        if (typeof value === 'string') return value.trim().length > 0;
        return value != null;
      })
    );

    if (!cleanedPayload.fullName && !cleanedPayload.firstName && !cleanedPayload.lastName) {
      pushToast({
        variant: 'warn',
        title: 'Name required',
        message: 'Enter at least a first or last name before running enrichment.',
      });
      return;
    }

    if (force && supportsForce && canForceByRole) {
      cleanedPayload.force = true;
    }

    runEnrichment.mutate({ caseId, providerId: selectedProviderId, payload: cleanedPayload });
  };

  const handleSelectEnrichmentRecord = (recordId) => {
    if (!caseId || !recordId || !selectedProviderId) return;
    setSelectingRecordId(recordId);
    selectEnrichment.mutate({ caseId, providerId: selectedProviderId, recordId });
  };

  const handleEnrichmentSubmit = (event) => {
    event.preventDefault();
    handleRunEnrichment(false);
  };

  const handleForceEnrichment = () => {
    if (!supportsForce || !canForceByRole) return;
    handleRunEnrichment(true);
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

  const handleCrmSave = (event) => {
    event.preventDefault();
    if (!caseId) return;
    const payload = {
      qualificationNotes,
      followUpAt: followUpAt ? new Date(followUpAt).toISOString() : null,
      assignedTo,
      address: {
        streetLine1: contactStreet1,
        streetLine2: contactStreet2,
        city: contactCity,
        stateCode: contactStateCode,
        postalCode: contactPostalCode,
      },
      phone: contactPhone,
    };

    if (decision === 'accepted') {
      payload.acceptance = {
        accepted: true,
        acceptedAt: new Date().toISOString(),
        notes: acceptanceNotes,
      };
      payload.denial = { denied: false, deniedAt: null, reason: '', notes: '' };
    } else if (decision === 'denied') {
      payload.denial = {
        denied: true,
        deniedAt: new Date().toISOString(),
        reason: denialReason,
        notes: denialNotes,
      };
      payload.acceptance = { accepted: false, acceptedAt: null, notes: '' };
    } else {
      payload.acceptance = { accepted: false, acceptedAt: null, notes: acceptanceNotes };
      payload.denial = { denied: false, deniedAt: null, reason: denialReason, notes: denialNotes };
    }

    updateCrm.mutate({ caseId, payload });
  };

  const applyFollowUpPreset = (preset) => {
    if (!preset) return;
    const now = new Date();
    if (preset.offsetDays) {
      now.setDate(now.getDate() + preset.offsetDays);
    }
    if (preset.offsetHours) {
      now.setHours(now.getHours() + preset.offsetHours);
    }
    if (typeof preset.setHour === 'number') {
      now.setHours(preset.setHour, 0, 0, 0);
    } else {
      now.setMinutes(0, 0, 0);
    }
    const isoLocal = now.toISOString().slice(0, 16);
    setFollowUpAt(isoLocal);
  };

  const toggleChecklistItem = (item) => {
    if (!caseId) return;
    const updatedDocs = checklistItems.map((doc) => {
      if ((doc?.key || doc?.label) !== (item?.key || item?.label)) return doc;
      if (doc?.status === 'completed') {
        return { ...doc, status: 'pending', completedAt: null };
      }
      return { ...doc, status: 'completed', completedAt: new Date().toISOString() };
    });
    updateCrm.mutate({ caseId, payload: { documents: updatedDocs } });
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

  const cancelAttachmentEdit = () => {
    setEditingAttachmentId('');
    setAttachmentLabel('');
    setAttachmentNote('');
    setAttachmentChecklist('');
  };

  const startAttachmentEdit = (attachment) => {
    if (!attachment?.id) return;
    setEditingAttachmentId(attachment.id);
    setAttachmentLabel(attachment.label || attachment.originalName || attachment.filename || '');
    setAttachmentNote(attachment.note || '');
    setAttachmentChecklist(attachment.checklistKey || '');
  };

  const handleAttachmentSave = (event) => {
    if (event) event.preventDefault();
    if (!caseId || !editingAttachmentId) return;
    const trimmedLabel = attachmentLabel.trim();
    if (!trimmedLabel) {
      pushToast({ variant: 'warn', title: 'Label required', message: 'Add a brief label before saving.' });
      return;
    }
    const payload = {
      label: trimmedLabel,
      note: attachmentNote.trim(),
      checklistKey: attachmentChecklist || '',
    };
    updateAttachment.mutate({ caseId, attachmentId: editingAttachmentId, payload });
  };

  const handleAttachmentDelete = (attachment) => {
    if (!caseId || !attachment?.id) return;
    const confirmed = typeof window !== 'undefined'
      ? window.confirm('Remove this document from the CRM? This cannot be undone.')
      : true;
    if (!confirmed) return;
    setDeletingAttachmentId(attachment.id);
    deleteAttachment.mutate({ caseId, attachmentId: attachment.id });
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

  const applyActivityPreset = (presetId) => {
    const preset = ACTIVITY_PRESETS.find((item) => item.id === presetId);
    if (!preset) {
      setActivityPreset('');
      return;
    }
    setActivityPreset(preset.id);
    if (preset.note) {
      setActivityNote(preset.note);
    }
    if (preset.label) {
      setActivityOutcome(preset.label);
    }
    if (preset.followOffsetDays != null) {
      const follow = new Date();
      follow.setDate(follow.getDate() + Number(preset.followOffsetDays));
      if (preset.followHour != null) {
        follow.setHours(Number(preset.followHour), 0, 0, 0);
      }
      setActivityFollowUp(follow.toISOString().slice(0, 16));
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Case detail" subtitle="Loading case…" />
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
          Loading case details…
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Case detail" subtitle="Unable to load case" />
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Failed to load case: {error?.message || 'Unknown error'}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Case detail" subtitle="Case not found" />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Case not found.
        </div>
      </div>
    );
  }

  const renderChecklist = () => {
    if (!totalChecklist) {
      return (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No onboarding tasks have been configured for this case yet.
        </div>
      );
    }

    return (
      <ul className="space-y-2">
        {checklistItems.map((item, idx) => {
          const key = item?.key || item?.label || `checklist-${idx}`;
          const label = item?.label || item?.key || 'Checklist item';
          const isRequired = Boolean(item?.required);
          const isCompleted = item?.status === 'completed';

          return (
            <li
              key={key}
              className={`flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm md:flex-row md:items-start md:justify-between ${
                isCompleted ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
              }`}
            >
              <div>
                <div className="font-medium text-slate-800">{label}</div>
                <div className="text-xs text-slate-500">
                  {isRequired ? 'Required' : 'Optional'}
                  {isCompleted && item?.completedAt ? ` • Completed ${formatRelative(item.completedAt)}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                    isCompleted ? 'bg-emerald-200 text-emerald-800' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {isCompleted ? 'Done' : 'Pending'}
                </span>
                <button
                  type="button"
                  onClick={() => toggleChecklistItem(item)}
                  disabled={updateCrm.isPending}
                  className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isCompleted ? 'Mark pending' : 'Mark complete'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  const overviewContent = (
    <div className="space-y-6">
      <SectionCard title="Case snapshot" subtitle="Latest onboarding status">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <StatTile label="Stage" value={stageDisplay} />
          <StatTile label="Bond" value={bondDisplay} />
          <StatTile label="Assigned" value={crmDetails.assignedTo || 'Unassigned'} />
          <StatTile label="Next follow-up" value={followUpDisplay} />
          <StatTile label="Age" value={ageInfo.label} hint={data.booking_date ? `Booked ${data.booking_date}` : undefined} />
          <StatTile
            label="Checklist"
            value={totalChecklist ? `${completedChecklist}/${totalChecklist}` : '—'}
            hint={totalChecklist ? `${checklistProgress}% complete` : undefined}
          />
          <StatTile
            label="Last contact"
            value={lastContactDisplay}
            hint={data.contacted ? 'Contacted' : 'No outreach yet'}
          />
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
            <DetailItem label="Phone" value={contactPhoneDisplay || '—'} />
            <DetailItem label="Address">
              <div className="mt-1 whitespace-pre-line text-sm text-slate-800">
                {contactAddressDisplay || '—'}
              </div>
            </DetailItem>
            <DetailItem label="Source" value={data.source || '—'} />
            <DetailItem label="Updated" value={formatRelative(data.updatedAt || data.normalized_at)} />
          </div>
        </div>
      </SectionCard>
    </div>
  );

  const checklistContent = (
    <SectionCard
      title="Onboarding checklist"
      subtitle={totalChecklist
        ? `${completedChecklist}/${totalChecklist} items • ${requiredChecklist ? `${requiredCompleted}/${requiredChecklist} required` : 'No required items'} • ${checklistProgress}% complete`
        : 'No checklist items configured yet'}
    >
      {renderChecklist()}
    </SectionCard>
  );

  const crmContent = (
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
                Complete required checklist items before accepting: {missingRequiredDocs
                  .map((item) => item.label || item.key || 'Unnamed task')
                  .join(', ')}
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
                onClick={() => setActiveTab('checklist')}
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

      <SectionCard title="CRM details" subtitle="Keep ownership, contact info, and decisions up to date">
        <form className="space-y-4" onSubmit={handleCrmSave}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-phone">
                Phone
              </label>
              <input
                id="crm-phone"
                type="text"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="e.g., (555) 555-1212"
                disabled={updateCrm.isPending}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-address1">
                Address line 1
              </label>
              <input
                id="crm-address1"
                type="text"
                value={contactStreet1}
                onChange={(e) => setContactStreet1(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="Street address"
                disabled={updateCrm.isPending}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-address2">
                Address line 2
              </label>
              <input
                id="crm-address2"
                type="text"
                value={contactStreet2}
                onChange={(e) => setContactStreet2(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="Apt, unit, suite (optional)"
                disabled={updateCrm.isPending}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-city">
                  City
                </label>
                <input
                  id="crm-city"
                  type="text"
                  value={contactCity}
                  onChange={(e) => setContactCity(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="City"
                  disabled={updateCrm.isPending}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-state">
                  State
                </label>
                <input
                  id="crm-state"
                  type="text"
                  value={contactStateCode}
                  onChange={(e) => setContactStateCode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="e.g., TX"
                  disabled={updateCrm.isPending}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-postal">
                  Postal code
                </label>
                <input
                  id="crm-postal"
                  type="text"
                  value={contactPostalCode}
                  onChange={(e) => setContactPostalCode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="ZIP"
                  disabled={updateCrm.isPending}
                />
              </div>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-assigned">
                Owner
              </label>
              <input
                id="crm-assigned"
                type="text"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                placeholder="Assigned teammate"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-followup">
                Follow-up
              </label>
              <input
                id="crm-followup"
                type="datetime-local"
                value={followUpAt}
                onChange={(e) => setFollowUpAt(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                {FOLLOW_UP_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyFollowUpPreset(preset)}
                    className="rounded-full border border-slate-300 px-2.5 py-1 hover:border-blue-300 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setFollowUpAt('')}
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-slate-500 hover:border-rose-300 hover:text-rose-600"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-qualification">
              Qualification notes
            </label>
            <textarea
              id="crm-qualification"
              value={qualificationNotes}
              onChange={(e) => setQualificationNotes(e.target.value)}
              rows={4}
              placeholder="Capture intake notes, screening details, or constraints"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Decision</div>
            <div className="flex flex-wrap gap-3 text-sm">
              {[
                { value: 'pending', label: 'Pending' },
                { value: 'accepted', label: 'Accepted' },
                { value: 'denied', label: 'Denied' },
              ].map((option) => (
                <label key={option.value} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 ${
                  decision === option.value ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600'
                }`}>
                  <input
                    type="radio"
                    name="crm-decision"
                    value={option.value}
                    checked={decision === option.value}
                    onChange={(e) => setDecision(e.target.value)}
                    className="h-3 w-3"
                  />
                  {option.label}
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

            {decision === 'accepted' && missingRequiredDocs.length ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Finish required checklist items before confirming acceptance:
                <ul className="mt-1 list-disc pl-4">
                  {missingRequiredDocs.map((doc) => (
                    <li key={doc.key || doc.label || doc.id}>{doc.label || doc.key || 'Checklist item'}</li>
                  ))}
                </ul>
              </div>
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

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={updateCrm.isPending}
              className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {updateCrm.isPending ? 'Saving…' : 'Save CRM details'}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Stage history" subtitle="Recent transitions and notes">
        <ul className="space-y-2 text-sm text-slate-600">
          {(Array.isArray(data.crm_stage_history) ? data.crm_stage_history : []).slice().reverse().map((entry, idx) => (
            <li key={`${entry.stage || 'stage'}-${idx}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
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
      </SectionCard>
    </div>
  );

  const enrichmentContent = !providersLoaded ? (
    <SectionCard title="Enrichment" subtitle="Loading provider configuration…">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">Checking available enrichment providers…</div>
    </SectionCard>
  ) : providerOptions.length === 0 ? (
    <SectionCard
      title="Enrichment"
      subtitle="Configure at least one enrichment provider to enable lookups."
    >
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        Set the `ENRICHMENT_PROVIDERS` environment variable (for example `pipl,whitepages`),
        provide API keys, and restart the API server to begin enrichment.
      </div>
    </SectionCard>
  ) : (
    <div className="space-y-6">
      <SectionCard
        title={`${providerLabel} enrichment`}
        subtitle="Run a manual lookup to pull possible next-of-kin and contact details."
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="enrichment-provider">
                  Provider
                </label>
                <select
                  id="enrichment-provider"
                  value={selectedProviderId}
                  onChange={(event) => setSelectedProviderId(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  {providerOptions.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col items-start gap-1 text-xs text-slate-500 md:items-end">
                <span>
                  Last run: {enrichmentDoc?.requestedAt ? formatRelative(enrichmentDoc.requestedAt) : 'Never'}
                </span>
                <span>
                  Requested by: {enrichmentDoc?.requestedBy?.email || enrichmentDoc?.requestedBy?.name || '—'}
                </span>
              </div>
            </div>
            {enrichmentData?.cached ? (
              <div className="mt-2 text-xs text-slate-500">
                Current results cached until {enrichmentNextRefresh ? formatRelative(enrichmentNextRefresh) : 'later'}.
                {supportsForce && canForceByRole ? ' Use force refresh to bypass the cache.' : ''}
              </div>
            ) : null}
            {enrichmentDoc?.error?.message ? (
              <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {enrichmentDoc.error.message}
              </div>
            ) : null}
          </div>

          <form className="space-y-4" onSubmit={handleEnrichmentSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="wp-first">
                  First name
                </label>
                <input
                  id="wp-first"
                  type="text"
                  value={currentEnrichmentInput.firstName || ''}
                  onChange={(event) => handleEnrichmentFieldChange('firstName', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="e.g., John"
                  disabled={runEnrichment.isPending}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="wp-last">
                  Last name
                </label>
                <input
                  id="wp-last"
                  type="text"
                  value={currentEnrichmentInput.lastName || ''}
                  onChange={(event) => handleEnrichmentFieldChange('lastName', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="e.g., Doe"
                  disabled={runEnrichment.isPending}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="wp-city">
                  City (optional)
                </label>
                <input
                  id="wp-city"
                  type="text"
                  value={currentEnrichmentInput.city || ''}
                  onChange={(event) => handleEnrichmentFieldChange('city', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="e.g., Houston"
                  disabled={runEnrichment.isPending}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="wp-state">
                  State (optional)
                </label>
                <input
                  id="wp-state"
                  type="text"
                  value={currentEnrichmentInput.stateCode || ''}
                  onChange={(event) => handleEnrichmentFieldChange('stateCode', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="e.g., TX"
                  disabled={runEnrichment.isPending}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="wp-postal">
                  Postal code (optional)
                </label>
                <input
                  id="wp-postal"
                  type="text"
                  value={currentEnrichmentInput.postalCode || ''}
                  onChange={(event) => handleEnrichmentFieldChange('postalCode', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="e.g., 77002"
                  disabled={runEnrichment.isPending}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="wp-phone">
                  Phone (optional)
                </label>
                <input
                  id="wp-phone"
                  type="text"
                  value={currentEnrichmentInput.phone || ''}
                  onChange={(event) => handleEnrichmentFieldChange('phone', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="e.g., (555) 555-1212"
                  disabled={runEnrichment.isPending}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={!selectedProviderId || !canRunEnrichment || runEnrichment.isPending}
                className="inline-flex items-center rounded-lg border border-blue-500 bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500"
              >
                {runEnrichment.isPending ? 'Running…' : enrichmentDoc ? 'Run again' : 'Run enrichment'}
              </button>
              {supportsForce && canForceByRole ? (
                <button
                  type="button"
                  onClick={handleForceEnrichment}
                  disabled={runEnrichment.isPending}
                  className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Force refresh
                </button>
              ) : null}
              {!canRunEnrichment ? (
                <span className="text-xs text-slate-500">
                  You do not have permission to run enrichment for this case.
                </span>
              ) : null}
            </div>
          </form>
        </div>
      </SectionCard>

      <SectionCard title="Enrichment results" subtitle="Review matches and attach any relevant contacts">
        {enrichmentRefreshing ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">
            Fetching results…
          </div>
        ) : !enrichmentDoc ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            Run enrichment to pull candidate matches from {providerLabel}.
          </div>
        ) : (
          <div className="space-y-4">
            {enrichmentDoc.status === 'error' ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                {enrichmentDoc.error?.message || 'Enrichment failed. Try again later.'}
              </div>
            ) : null}
            {enrichmentSelected.length ? (
              <div className="text-xs text-slate-500">
                Attached records: {enrichmentSelected.map((entry) => entry?.recordId).filter(Boolean).join(', ')}
              </div>
            ) : null}
            {enrichmentCandidates.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full table-auto border-collapse text-sm">
                  <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Phones</th>
                      <th className="px-3 py-2">Addresses</th>
                      <th className="px-3 py-2">Relations</th>
                      <th className="px-3 py-2" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {enrichmentCandidates.map((candidate, index) => {
                      const rowKey = candidate?.recordId || `${candidate?.fullName || 'candidate'}-${index}`;
                      const isSelected = candidate?.recordId && enrichmentSelectedSet.has(candidate.recordId);
                      return (
                        <tr key={rowKey} className="border-b border-slate-100">
                          <td className="px-3 py-3 align-top">
                            <div className="font-medium text-slate-800">{candidate?.fullName || 'Unknown'}</div>
                            <div className="text-xs text-slate-500">
                              {candidate?.ageRange ? `${candidate.ageRange}` : null}
                              {candidate?.gender ? ` ${candidate.gender}` : null}
                              {candidate?.recordId ? ` • ${candidate.recordId}` : ''}
                            </div>
                          </td>
                          <td className="px-3 py-3 align-top text-xs text-slate-600">
                            {Array.isArray(candidate?.contacts) && candidate.contacts.length ? (
                              <ul className="space-y-1">
                                {candidate.contacts.map((contact, idx) => (
                                  <li key={`${rowKey}-phone-${idx}`}>
                                    <span>{contact.value}</span>
                                    {contact.lineType ? ` • ${contact.lineType}` : ''}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top text-xs text-slate-600">
                            {Array.isArray(candidate?.addresses) && candidate.addresses.length ? (
                              <ul className="space-y-1">
                                {candidate.addresses.map((address, idx) => (
                                  <li key={`${rowKey}-addr-${idx}`}>
                                    {[address.streetLine1, address.city, address.stateCode, address.postalCode]
                                      .filter(Boolean)
                                      .join(', ') || '—'}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top text-xs text-slate-600">
                            {Array.isArray(candidate?.relations) && candidate.relations.length ? (
                              <ul className="space-y-1">
                                {candidate.relations.map((relation, idx) => (
                                  <li key={`${rowKey}-rel-${idx}`}>
                                    {relation.name || 'Unnamed'}{relation.relation ? ` — ${relation.relation}` : ''}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top text-right">
                            {candidate?.recordId ? (
                              <button
                                type="button"
                                onClick={() => handleSelectEnrichmentRecord(candidate.recordId)}
                                disabled={!canRunEnrichment || selectEnrichment.isPending || (selectingRecordId === candidate.recordId && selectEnrichment.isPending)}
                                className={`inline-flex items-center rounded-lg border px-3 py-1 text-xs font-medium transition ${
                                  isSelected
                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                    : 'border-slate-300 text-slate-600 hover:bg-slate-100'
                                } disabled:cursor-not-allowed disabled:opacity-60`}
                              >
                                {selectingRecordId === candidate.recordId && selectEnrichment.isPending
                                  ? 'Saving…'
                                  : isSelected
                                    ? 'Attached'
                                    : 'Attach'}
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">No record id</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                No candidates were returned for the last search.
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );

  const documentsContent = (
    <SectionCard title="Documents" subtitle="Upload and manage supporting files">
      {attachments.length ? (
        <ul className="space-y-2">
          {attachments.map((file, idx) => {
            const attachmentId = file.id || '';
            const isEditing = editingAttachmentId === attachmentId;
            const isDeleting = deletingAttachmentId === attachmentId;
            const updatePending = updateAttachment.isPending && isEditing;
            const deletePending = deleteAttachment.isPending && isDeleting;

            return (
              <li
                key={attachmentId || file.filename || file.url || idx}
                className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
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
                    <button
                      type="button"
                      onClick={() => (isEditing ? cancelAttachmentEdit() : startAttachmentEdit(file))}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={(updateAttachment.isPending && !isEditing) || deleteAttachment.isPending}
                    >
                      {isEditing ? 'Cancel' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAttachmentDelete(file)}
                      className="rounded-lg border border-rose-300 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={deletePending || updateAttachment.isPending}
                    >
                      {deletePending ? 'Removing…' : 'Delete'}
                    </button>
                  </div>
                </div>

                {isEditing ? (
                  <form onSubmit={handleAttachmentSave} className="mt-2 space-y-2 text-xs">
                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="flex flex-col">
                        <span className="font-semibold uppercase tracking-wide text-slate-500">Label</span>
                        <input
                          type="text"
                          value={attachmentLabel}
                          onChange={(e) => setAttachmentLabel(e.target.value)}
                          className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={updatePending}
                          placeholder="Document label"
                        />
                      </label>
                      <label className="flex flex-col">
                        <span className="font-semibold uppercase tracking-wide text-slate-500">Checklist link</span>
                        <select
                          value={attachmentChecklist}
                          onChange={(e) => setAttachmentChecklist(e.target.value)}
                          className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={updatePending}
                        >
                          <option value="">Not linked</option>
                          {checklistItems.map((item) => (
                            <option key={item.key || item.label} value={item.key || item.label || ''}>
                              {item.label || item.key || 'Checklist item'}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="flex flex-col">
                      <span className="font-semibold uppercase tracking-wide text-slate-500">Internal note</span>
                      <textarea
                        value={attachmentNote}
                        onChange={(e) => setAttachmentNote(e.target.value)}
                        rows={2}
                        className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={updatePending}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={updatePending}
                      >
                        {updatePending ? 'Saving…' : 'Save changes'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelAttachmentEdit}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={updatePending}
                      >
                        Close
                      </button>
                    </div>
                  </form>
                ) : null}
              </li>
            );
          })}
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
              <option key={item.key || item.label} value={item.key || item.label || ''}>
                {item.label || item.key || 'Checklist item'}
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

  const communicationsContent = (
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
          {messageItems.map((msg) => (
            <article key={msg._id || msg.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{msg.direction?.toUpperCase() || '—'}</span>
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{msg.channel?.toUpperCase() || '—'}</span>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 ${
                      msg.status === 'failed'
                        ? 'bg-rose-50 text-rose-700'
                        : msg.status === 'queued'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {msg.status || 'unknown'}
                  </span>
                </div>
                <div className="text-xs text-slate-500">{formatRelative(msg.sentAt || msg.deliveredAt || msg.createdAt)}</div>
              </div>
              {msg.body ? <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{msg.body}</p> : null}
              {msg.status === 'failed' && (msg.errorMessage || msg.errorCode) ? (
                <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {(msg.errorMessage || '').trim() || 'Delivery failed.'}
                  {msg.errorCode ? <span className="ml-2 font-mono">[{msg.errorCode}]</span> : null}
                  <div className="mt-2 flex flex-wrap gap-2">
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
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
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

  const activityContent = (
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
          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            {ACTIVITY_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyActivityPreset(preset.id)}
                className={`rounded-full border px-2.5 py-1 ${
                  activityPreset === preset.id
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-300 hover:border-blue-300 hover:text-blue-700'
                }`}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setActivityPreset('');
                setActivityOutcome('');
                setActivityNote('');
                setActivityFollowUp('');
              }}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-slate-500 hover:border-rose-300 hover:text-rose-600"
            >
              Clear preset
            </button>
          </div>
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
          {activityEvents.map((event, idx) => (
            <li key={`${event.type || 'event'}-${idx}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
    </SectionCard>
  );

  let activeContent = overviewContent;
  if (activeTab === 'checklist') activeContent = checklistContent;
  else if (activeTab === 'crm') activeContent = crmContent;
  else if (activeTab === 'enrichment') activeContent = enrichmentContent;
  else if (activeTab === 'documents') activeContent = documentsContent;
  else if (activeTab === 'communications') activeContent = communicationsContent;
  else if (activeTab === 'activity') activeContent = activityContent;

  return (
    <div className="space-y-6">
      <PageHeader
        title={data.full_name || 'Case detail'}
        subtitle={data.case_number ? `Case #${data.case_number}` : 'Full record overview'}
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

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              activeTab === tab.id ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeContent}
    </div>
  );
}

function StatTile({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
      {hint ? <div className="text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function DetailItem({ label, value, children }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {children ? children : <div className="mt-1 text-sm text-slate-800">{value}</div>}
    </div>
  );
}
