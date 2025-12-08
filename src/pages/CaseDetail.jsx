import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader, SectionCard } from '../components/PageToolkit';
import CrmStageSelect from '../components/CrmStageSelect';
import { HIGH_QUALITY_MATCH } from '../config/enrichment';
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
  useCaseEnrichment,
  useRunCaseEnrichment,
  useSelectCaseEnrichment,
} from '../hooks/cases';
import { useRelatedParties, useRelatedPartyPull, useSubjectSummary, useValidateRelatedPartyPhones, useRelatedPartyOverride, useCrmSuggestions, useEnrichmentProviders as useProxyEnrichmentProviders, usePiplFirstPull, usePiplMatches } from '../hooks/enrichment';
import { useCheckins, useTriggerCheckInPing } from '../hooks/checkins';
import { useToast } from '../components/ToastContext';
import { stageLabel } from '../lib/stage';
import InlineMapEmbed from '../components/InlineMapEmbed';
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
  
  // Handle "LASTNAME, FIRSTNAME MIDDLENAME" format
  if (source.includes(',')) {
    const [lastNamePart, firstNamePart] = source.split(',').map((x) => x.trim());
    // Remove trailing comma if present in lastName
    const lastName = lastNamePart.replace(/,+$/, '').trim();
    // Extract first name (first word after comma, ignore middle names)
    const firstNameWords = firstNamePart.split(/\s+/);
    const firstName = firstNameWords[0] || '';
    return { firstName, lastName, fullName: source };
  }
  
  // Fallback for "FIRSTNAME MIDDLENAME LASTNAME" or other formats
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

// Postal helpers
const isLikelyZip = (v) => typeof v === 'string' && /^(\d{5})(?:-\d{4})?$/.test(v.trim());
// Sanitize ZIP-like inputs from case records (strip non-digits, accept 5 or 9 digits)
const cleanZip = (v) => {
  const raw = String(v == null ? '' : v).trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 9) return `${digits.slice(0, 5)}-${digits.slice(5, 9)}`;
  if (digits.length >= 5) return digits.slice(0, 5);
  return '';
};

// Lightweight ZIP -> state inference; start with Texas coverage (75000–79999)
function inferStateFromZip(zip) {
  const digits = String(zip || '').replace(/\D/g, '');
  if (digits.length < 5) return '';
  const five = Number(digits.slice(0, 5));
  if (Number.isFinite(five) && five >= 75000 && five <= 79999) return 'TX';
  return '';
}

const formatAddressDisplay = (address) => {
  if (!address || typeof address !== 'object') return '';
  const line1 = address.streetLine1 || address.line1 || '';
  const line2 = address.streetLine2 || address.line2 || '';
  const city = address.city || '';
  const state = normalizeStateCode(address.stateCode || address.state || '');
  const postalRaw = cleanZip(address.postalCode || address.zip || '');
  const postal = String(postalRaw).trim() === ';' ? '' : postalRaw;

  const cityState = [city, state].filter(Boolean).join(', ');
  const parts = [line1, line2, cityState, postal].filter((part) => part && part.trim().length > 0);
  return parts.join('\n');
};

const formatPhone = (value) => {
  if (!value) return '';
  const v = String(value);
  const digits = v.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return v;
};

// Normalize a state string to a 2-letter uppercase USPS code (best-effort)
function normalizeStateCode(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const map = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
    delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
    kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
    minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
    'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
    oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
    tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
    wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC', dc: 'DC'
  };
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const key = s.toLowerCase();
  if (map[key]) return map[key];
  if (/^[A-Za-z]{3,}$/.test(s)) return s.slice(0, 2).toUpperCase();
  return '';
}

// Age calculation helper
const calculateAgeFromDob = (rawDob) => {
  try {
    if (!rawDob) return null;
    let d;
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDob)) {
      const [y, m, dd] = rawDob.split('-').map((x) => Number(x));
      d = new Date(Date.UTC(y, (m || 1) - 1, dd || 1));
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawDob)) {
      const [mm, dd, yyyy] = rawDob.split('/').map((x) => Number(x));
      d = new Date(Date.UTC(yyyy, (mm || 1) - 1, dd || 1));
    } else {
      const t = Date.parse(rawDob);
      if (!Number.isFinite(t)) return null;
      d = new Date(t);
    }
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
    const now = new Date();
    let years = now.getUTCFullYear() - d.getUTCFullYear();
    const m = now.getUTCMonth() - d.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) {
      years--;
    }
    if (!Number.isFinite(years) || years < 0 || years > 120) return null;
    return years;
  } catch {
    return null;
  }
};

// Convert DOB to date input format (yyyy-mm-dd)
const formatDobForDateInput = (rawDob) => {
  if (!rawDob) return '';
  // Already in yyyy-mm-dd format
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDob)) {
    return rawDob;
  }
  // Convert mm/dd/yyyy to yyyy-mm-dd
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawDob)) {
    const [mm, dd, yyyy] = rawDob.split('/').map((x) => String(x).padStart(2, '0'));
    return `${yyyy}-${mm}-${dd}`;
  }
  return '';
};

// Copy utility
const copyText = async (text, pushToast) => {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(String(text || ''));
    } else {
      const ta = document.createElement('textarea');
      ta.value = String(text || '');
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    pushToast?.({ variant: 'success', title: 'Copied', message: 'Copied to clipboard.' });
  } catch {
    pushToast?.({ variant: 'error', title: 'Copy failed', message: 'Unable to copy to clipboard.' });
  }
};

const toTelHref = (value) => {
  if (!value) return '#';
  const digits = String(value).replace(/[^0-9+]/g, '');
  return `tel:${digits}`;
};

const toMapsHref = (value) => {
  if (!value) return '#';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(String(value))}`;
};

const SourceBadge = ({ label }) => {
  const color = label === 'facts' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : label === 'pdl' ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
    : label === 'base' ? 'bg-slate-50 text-slate-700 border-slate-200'
    : label === 'related_parties' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-slate-50 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${color}`}>{label}</span>
  );
};

const renderSourceBadges = (sources) => {
  if (!sources || typeof sources !== 'string') return null;
  const parts = sources.split('|').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {parts.map((p, idx) => (
        <SourceBadge key={`${p}-${idx}`} label={p} />
      ))}
    </div>
  );
};

// Primary contact helpers for accordion details
const getPrimaryPhone = (candidate) => {
  const contacts = Array.isArray(candidate?.contacts) ? candidate.contacts : [];
  const phone = contacts.find((ct) => /\d{10}/.test(String(ct?.value || '').replace(/\D/g, '')));
  return phone?.value || null;
};

const getPrimaryEmail = (candidate) => {
  const contacts = Array.isArray(candidate?.contacts) ? candidate.contacts : [];
  const email = contacts.find((ct) => /@/.test(String(ct?.value || '')));
  return email?.value || null;
};

const formatAddress = (addr) => {
  if (!addr) return null;
  const parts = [addr.streetLine1, addr.city, addr.stateCode, addr.postalCode].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
};

// Helpers for enrichment display
const getCandidateName = (candidate) => {
  if (!candidate || typeof candidate !== 'object') return 'Unknown';
  const firstLast = [candidate.firstName, candidate.lastName].filter(Boolean).join(' ').trim();
  const givenFamily = [candidate.givenName, candidate.familyName].filter(Boolean).join(' ').trim();
  const namesArray = Array.isArray(candidate.names) ? candidate.names : Array.isArray(candidate.person?.names) ? candidate.person.names : [];
  const fromNames = namesArray.find((n) => n?.display || n?.formatted || n?.name) || {};
  return (
    candidate.fullName
    || candidate.displayName
    || candidate.name
    || candidate?.summary?.name
    || candidate?.chosenSummary?.name
    || fromNames.display
    || fromNames.formatted
    || fromNames.name
    || firstLast
    || givenFamily
    || 'Unknown'
  );
};

const getCandidateScore = (candidate) => {
  if (!candidate || typeof candidate !== 'object') return null;
  const raw =
    (typeof candidate.score === 'number' ? candidate.score : null)
    ?? (typeof candidate.matchScore === 'number' ? candidate.matchScore : null)
    ?? (typeof candidate.confidence === 'number' ? candidate.confidence : null)
    ?? (typeof candidate.scorePercent === 'number' ? candidate.scorePercent / 100 : null);
  if (raw == null) return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  // Normalize plausible ranges: if provider returned 0-100, convert
  return num > 1 ? Math.max(0, Math.min(1, num / 100)) : Math.max(0, Math.min(1, num));
};

const formatScoreDisplay = (score) => {
  if (score == null) return '—';
  const pct = Math.round(Number(score) * 100);
  if (!Number.isFinite(pct)) return '—';
  return `${pct}%`;
};

// Cooldown helper for related-party re-enrichment
// Expects lastAudit.cooldownUntil as an ISO timestamp when a cooldown is active
function getCooldownInfo(lastAudit) {
  try {
    const untilStr = lastAudit && lastAudit.cooldownUntil;
    if (!untilStr) return { cooling: false, eta: '' };
    const until = new Date(untilStr).getTime();
    if (!Number.isFinite(until)) return { cooling: false, eta: '' };
    const now = Date.now();
    if (until <= now) return { cooling: false, eta: '' };
    const minutes = Math.max(1, Math.round((until - now) / 60000));
    return { cooling: true, eta: `${minutes}m` };
  } catch {
    return { cooling: false, eta: '' };
  }
}

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
  email: '',
  alternateAddresses: [],
  acceptance: { accepted: false, acceptedAt: null, notes: '' },
  denial: { denied: false, deniedAt: null, reason: '', notes: '' },
  attachments: [],
});

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'crm', label: 'CRM' },
  { id: 'enrichment', label: 'Enrichment' },
  { id: 'activity', label: 'Activity' },
];

const CRM_VIEWS = [
  { id: 'summary', label: 'Summary', shortcut: 'S' },
  { id: 'checkins', label: 'Check-ins', shortcut: 'K' },
  { id: 'checklist', label: 'Checklist', shortcut: 'L' },
  { id: 'documents', label: 'Documents', shortcut: 'D' },
  { id: 'communications', label: 'Comms', shortcut: 'M' },
];

export default function CaseDetail() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const { caseId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading, isError, error, refetch } = useCase(caseId);
  const { data: meta } = useCaseMeta();
  const { data: messagesData, isLoading: messagesLoading, isError: messagesError } = useCaseMessages(caseId);
  const { data: activityData, isLoading: activityLoading, isError: activityError } = useCaseActivity(caseId);
  const { data: caseCheckinsData } = useCheckins({ scope: 'all', caseId }, { enabled: Boolean(caseId) });
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
      alternateAddresses: Array.isArray(base.alternateAddresses) ? base.alternateAddresses : defaults.alternateAddresses,
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
  const dobDisplay = useMemo(() => {
    const v = data?.dob;
    if (!v) return '—';
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) return v;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = String(v).split('-');
      return `${Number(m)}/${Number(d)}/${y}`;
    }
    return String(v);
  }, [data?.dob]);
  // Age from DOB in full years (fallback shown separately below)
  const ageYears = useMemo(() => {
    try {
      const raw = data?.dob;
      if (!raw) return null;
      let d;
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const [y, m, dd] = raw.split('-').map((x) => Number(x));
        // Use UTC to avoid off-by-one due to TZ
        d = new Date(Date.UTC(y, (m || 1) - 1, dd || 1));
      } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
        const [mm, dd, yyyy] = raw.split('/').map((x) => Number(x));
        d = new Date(Date.UTC(yyyy, (mm || 1) - 1, dd || 1));
      } else {
        const t = Date.parse(raw);
        if (!Number.isFinite(t)) return null;
        d = new Date(t);
      }
      if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
      const now = new Date();
      // Use UTC components to avoid DST/timezone edge cases
      let years = now.getUTCFullYear() - d.getUTCFullYear();
      const m = now.getUTCMonth() - d.getUTCMonth();
      if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) {
        years--;
      }
      if (!Number.isFinite(years) || years < 0 || years > 120) return null;
      return years;
    } catch {
      return null;
    }
  }, [data?.dob]);
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

  
  const messagePhoneOptions = useMemo(() => {
    const options = [];
    const seen = new Set();
    const push = (value, label) => {
      if (!value || typeof value !== 'string') return;
      const digits = value.replace(/[^0-9]/g, '');
      if (digits.length < 10) return;
      const withoutCountry = digits.startsWith('1') ? digits.slice(1) : digits;
      const e164 = `+1${withoutCountry}`;
      if (seen.has(e164)) return;
      seen.add(e164);
      options.push({ label, value: e164 });
    };

    push(data?.crm_details?.phone, data?.full_name ? `${data.full_name} (CRM)` : 'Client phone');
    push(data?.phone, 'Case record phone');
    push(data?.primary_phone, 'Primary phone');
  push(data?.phone_nbr1, 'Alt phone 1');
  push(data?.phone_nbr2, 'Alt phone 2');
  push(data?.phone_nbr3, 'Alt phone 3');

    if (Array.isArray(data?.crm_details?.contacts)) {
      data.crm_details.contacts.forEach((contact, index) => {
        push(contact?.phone, contact?.name ? contact.name : `Contact ${index + 1}`);
      });
    }
    if (Array.isArray(data?.crm_details?.references)) {
      data.crm_details.references.forEach((ref, index) => {
        push(ref?.phone, ref?.name ? ref.name : `Reference ${index + 1}`);
      });
    }

    return options;
  }, [
    data?.crm_details?.contacts,
    data?.crm_details?.phone,
    data?.crm_details?.references,
    data?.full_name,
    data?.phone,
    data?.primary_phone,
    data?.phone_nbr1,
    data?.phone_nbr2,
    data?.phone_nbr3,
  ]);
  const caseCheckins = Array.isArray(caseCheckinsData?.items) ? caseCheckinsData.items : [];
  const gpsCheckins = caseCheckins.filter((checkin) => Boolean(checkin?.gpsEnabled));
  const triggerPing = useTriggerCheckInPing();
  // Enrichment provider dropdown data source
  // Flow:
  //  - Browser calls UI hook useEnrichmentProviders() -> GET /api/enrichment/providers (same-origin)
  //  - Dashboard API mounts enrichmentProxy at /api/enrichment and forwards to ENRICHMENT_API_URL
  //  - Enrichment service responds from /api/enrichment/providers with [{ id, label, ... }]
  //  - We render these providers as options in the select below.
  const { data: enrichmentProvidersData } = useProxyEnrichmentProviders();
  const providerOptions = useMemo(() => (
    Array.isArray(enrichmentProvidersData?.providers)
      ? enrichmentProvidersData.providers
      : []
  ), [enrichmentProvidersData?.providers]);
  const providersLoaded = Boolean(enrichmentProvidersData);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  // Default provider selection:
  //  - Prefer an explicit default flag from the API
  //  - Otherwise prefer 'pipl' if available
  //  - Otherwise fall back to the first provider
  const defaultProviderId = useMemo(() => {
    const flagged = providerOptions.find((provider) => provider.default)
      || providerOptions.find((provider) => provider.id === 'pipl');
    return flagged?.id || providerOptions[0]?.id || '';
  }, [providerOptions]);

  useEffect(() => {
    if (!providerOptions.length) {
      setSelectedProviderId('');
    } else if (!selectedProviderId && defaultProviderId) {
      setSelectedProviderId(defaultProviderId);
    }
  }, [providerOptions, selectedProviderId, defaultProviderId]);

  const handleMessageCase = () => {
    if (!data) return;
    const identifier = data.case_number || caseId;
    if (!identifier) {
      pushToast({ variant: 'error', title: 'Missing case number', message: 'Unable to open composer without a case number.' });
      return;
    }
    if (!messagePhoneOptions.length) {
      pushToast({ variant: 'warning', title: 'No phone number on file', message: 'Add a mobile number in CRM or enrichment before sending an SMS.' });
      return;
    }

    const params = new URLSearchParams({ caseId: identifier, to: messagePhoneOptions[0].value });
    navigate(`/messages?${params.toString()}`);
  };

  const queuePingForCheckIn = (checkInId) => {
    if (!checkInId) {
      pushToast({ variant: 'error', title: 'Ping failed', message: 'Unable to determine which check-in to ping.' });
      return;
    }
    triggerPing.mutate(checkInId, {
      onSuccess: () => {
        pushToast({ variant: 'success', title: 'Ping queued', message: 'Manual GPS ping has been queued.' });
        queryClient.invalidateQueries({ queryKey: ['checkins'] });
        queryClient.invalidateQueries({ queryKey: ['checkins', 'detail', checkInId] });
        queryClient.invalidateQueries({ queryKey: ['checkins', 'timeline', checkInId] });
      },
      onError: (err) => {
        pushToast({ variant: 'error', title: 'Ping failed', message: err?.message || 'Unable to queue GPS ping.' });
      },
    });
  };

  const handlePingNow = () => {
    if (!gpsCheckins.length) {
      pushToast({ variant: 'warning', title: 'No GPS check-ins', message: 'Enable GPS on a check-in before triggering a ping.' });
      return;
    }

    const targetEntry = gpsCheckins.reduce((best, current) => {
      const ts = current?.dueAt ? new Date(current.dueAt).getTime() : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(ts)) return best;
      if (!best) return { item: current, ts };
      return ts < best.ts ? { item: current, ts } : best;
    }, null);

    const targetCheckIn = targetEntry?.item || gpsCheckins[0];
    if (!targetCheckIn?.id) {
      pushToast({ variant: 'error', title: 'Ping failed', message: 'Unable to determine which check-in to ping.' });
      return;
    }

    queuePingForCheckIn(targetCheckIn.id);
  };

  const defaultEnrichmentInput = useMemo(() => {
    const nameParts = splitCaseName(data?.full_name || '');
    const crmAddress = data?.crm_details?.address || {};
    const recordAddress = data?.address || {};
    const recordPhone = data?.crm_details?.phone || data?.phone || data?.primary_phone || '';
    const postalCandidates = [
      data?.postal_code,
      data?.postalCode,
      data?.zip,
      data?.zip_code,
      crmAddress.postalCode,
      crmAddress.zip,
      recordAddress.postalCode,
      recordAddress.zip,
      recordAddress.postal,
    ].map(cleanZip);
    const pickedPostal = postalCandidates.find((z) => isLikelyZip(z)) || '';
    const calculatedAge = calculateAgeFromDob(data?.dob);
    const formattedDob = formatDobForDateInput(data?.dob);
    let normalizedState = normalizeStateCode(
      data?.state
        || data?.stateCode
        || crmAddress.stateCode
        || crmAddress.state
        || recordAddress.stateCode
        || recordAddress.state
        || ''
    );
    if (!normalizedState) {
      const inferred = inferStateFromZip(pickedPostal);
      if (inferred) normalizedState = inferred;
    }
    return {
      fullName: nameParts.fullName,
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      dob: formattedDob,
      age: calculatedAge != null ? String(calculatedAge) : '',
      city: data?.city || crmAddress.city || recordAddress.city || '',
      stateCode: normalizedState,
      postalCode: pickedPostal,
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
    data?.dob,
    data?.city,
    data?.state,
    data?.stateCode,
    data?.postal_code,
    data?.postalCode,
    data?.zip,
    data?.zip_code,
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

  // Fill-in missing state/ZIP for the active provider input from case defaults (no overwrite of user input)
  useEffect(() => {
    if (!selectedProviderId) return;
    const desiredState = String(defaultEnrichmentInput.stateCode || '').trim();
    const desiredZip = String(defaultEnrichmentInput.postalCode || '').trim();
    if (!desiredState && !desiredZip) return;
    setEnrichmentInputs((prev) => {
      const cur = prev[selectedProviderId] || {};
      const next = { ...cur };
      let changed = false;
      if (!String(cur.stateCode || '').trim() && desiredState) {
        next.stateCode = desiredState;
        changed = true;
      }
      if (!String(cur.postalCode || '').trim() && desiredZip) {
        next.postalCode = desiredZip;
        changed = true;
      }
      if (!changed) return prev;
      return { ...prev, [selectedProviderId]: next };
    });
  }, [selectedProviderId, defaultEnrichmentInput.stateCode, defaultEnrichmentInput.postalCode]);

  const initialTab = (() => {
    const queryTab = searchParams.get('tab');
    // Map deprecated tabs to CRM sub-views to preserve deep links
    if (['checkins', 'checklist', 'documents', 'communications'].includes(String(queryTab))) {
      return 'crm';
    }
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
  // Sort mode for related parties: 'score' | 'value'
  const [_relatedSortMode, _setRelatedSortMode] = useState('score');
  const [contactCity, setContactCity] = useState('');
  const [contactStateCode, setContactStateCode] = useState('');
  const [contactPostalCode, setContactPostalCode] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [editingAttachmentId, setEditingAttachmentId] = useState('');
  const [attachmentLabel, setAttachmentLabel] = useState('');
  const [attachmentNote, setAttachmentNote] = useState('');
  const [attachmentChecklist, setAttachmentChecklist] = useState('');
  const [deletingAttachmentId, setDeletingAttachmentId] = useState('');
  const [enrichmentInputs, setEnrichmentInputs] = useState({});
  const currentEnrichmentInput = useMemo(() => {
    if (!selectedProviderId) return defaultEnrichmentInput;
    const perProvider = enrichmentInputs[selectedProviderId];
    return perProvider ? { ...defaultEnrichmentInput, ...perProvider } : defaultEnrichmentInput;
  }, [enrichmentInputs, selectedProviderId, defaultEnrichmentInput]);

  // Ensure core identity fields are back-filled if missing for the active provider
  useEffect(() => {
    if (!selectedProviderId) return;
    const deps = [
      defaultEnrichmentInput.firstName,
      defaultEnrichmentInput.lastName,
      defaultEnrichmentInput.fullName,
      defaultEnrichmentInput.city,
      defaultEnrichmentInput.dob,
      defaultEnrichmentInput.age,
      defaultEnrichmentInput.phone,
    ];
    // Trigger effect when defaults change
    deps;
    setEnrichmentInputs((prev) => {
      const cur = prev[selectedProviderId] || {};
      const next = { ...cur };
      let changed = false;
      const fill = (key, value) => {
        const curVal = cur[key];
        const curBlank = curVal == null || String(curVal).trim() === '';
        const valStr = value == null ? '' : String(value);
        if (curBlank && valStr.trim() !== '') {
          next[key] = value;
          changed = true;
        }
      };
      fill('firstName', defaultEnrichmentInput.firstName);
      fill('lastName', defaultEnrichmentInput.lastName);
      fill('fullName', defaultEnrichmentInput.fullName);
      fill('city', defaultEnrichmentInput.city);
      fill('dob', defaultEnrichmentInput.dob);
      fill('age', defaultEnrichmentInput.age);
      fill('phone', defaultEnrichmentInput.phone);
      if (!changed) return prev;
      return { ...prev, [selectedProviderId]: next };
    });
  }, [
    selectedProviderId,
    defaultEnrichmentInput.firstName,
    defaultEnrichmentInput.lastName,
    defaultEnrichmentInput.fullName,
    defaultEnrichmentInput.city,
    defaultEnrichmentInput.dob,
    defaultEnrichmentInput.age,
    defaultEnrichmentInput.phone,
  ]);
  const [selectingRecordId, setSelectingRecordId] = useState('');
  const [enrichmentPanel, setEnrichmentPanel] = useState('menu'); // 'menu' | 'details' | 'full'
  // After the first enrichment, default to hiding the input form in favor of a summary view
  const [enrichmentInputsExpanded, setEnrichmentInputsExpanded] = useState(true);
  // CRM sub-view within CRM tab
  const [crmPanel, setCrmPanel] = useState('summary'); // 'summary' | 'checkins' | 'checklist' | 'documents' | 'communications'
  const fileInputRef = useRef(null);
  
  // When map/geocoder resolves an address and ZIP can be inferred, auto-fill ZIP if missing
  const handleMapResolvedAddress = useCallback((info) => {
    try {
      const zip = String(info?.components?.postalCode || info?.components?.zip || '').trim();
      if (!zip) return;
      // If CRM postal code is empty, set it and persist
      if (!contactPostalCode) {
        setContactPostalCode(zip);
        if (caseId) {
          const payload = {
            address: {
              streetLine1: contactStreet1 || '',
              streetLine2: contactStreet2 || '',
              city: contactCity || '',
              stateCode: contactStateCode || '',
              postalCode: zip,
            },
          };
          updateCrm.mutate({ caseId, payload });
        }
      }
      // If current enrichment input is missing postalCode, seed it too
      setEnrichmentInputs((prev) => {
        const next = { ...prev };
        const provId = selectedProviderId;
        if (!provId) return next;
        const existing = next[provId] || {};
        const existingZip = String(existing?.postalCode || '').trim();
        if (!existingZip || existingZip === ';' || !isLikelyZip(existingZip)) {
          next[provId] = { ...existing, postalCode: zip };
        }
        return next;
      });
    } catch {
      // no-op
    }
  }, [caseId, contactCity, contactPostalCode, contactStateCode, contactStreet1, contactStreet2, selectedProviderId, updateCrm]);

  useEffect(() => {
    setStageDraft(data?.crm_stage || 'new');
  }, [data?.crm_stage]);

  useEffect(() => {
    if (!selectedProviderId) return;
    setEnrichmentInputs((prev) => {
      const existing = prev[selectedProviderId];
      // If no existing input for this provider OR the existing input is effectively empty,
      // seed with the latest defaults derived from the case data.
      const isEmptyExisting = (() => {
        if (!existing || typeof existing !== 'object') return true;
        const keys = ['firstName', 'lastName', 'city', 'stateCode', 'postalCode', 'phone', 'fullName'];
        return keys.every((k) => {
          const v = existing[k];
          return v == null || String(v).trim() === '';
        });
      })();
      if (isEmptyExisting) {
        return { ...prev, [selectedProviderId]: defaultEnrichmentInput };
      }
      return prev;
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
  setContactPostalCode(cleanZip(addr.postalCode));
    setContactPhone(crmDetails.phone || '');
  setContactEmail(crmDetails.email || '');

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
      return;
    }
    // Redirect deprecated tabs into CRM sub-views
    if (['checkins', 'checklist', 'documents', 'communications'].includes(String(queryTab))) {
      const params = new URLSearchParams(searchParams);
      params.set('tab', 'crm');
      params.set('crmView', String(queryTab));
      setSearchParams(params);
      setActiveTab('crm');
      setCrmPanel(String(queryTab));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (!editingAttachmentId) return;
    const exists = attachments.some((att) => att?.id === editingAttachmentId);
    if (!exists) {
      cancelAttachmentEdit();
    }
  }, [attachments, editingAttachmentId]);

  // Reset enrichment panel when switching providers or tabs
  // Sync panel with URL param when on the enrichment tab
  useEffect(() => {
    if (activeTab !== 'enrichment') return;
    const v = (searchParams.get('view') || '').toLowerCase();
    const next = v === 'details' || v === 'full' ? v : 'menu';
    setEnrichmentPanel(next);
  }, [activeTab, searchParams]);

  // When opening the Enrichment tab, force-refresh provider list to avoid stale cache
  // Ensures newly enabled providers (e.g., Pipl) appear immediately.
  useEffect(() => {
    if (activeTab === 'enrichment') {
      try {
        queryClient.invalidateQueries({ queryKey: ['enrichmentProviders:proxy'] });
      } catch {
        // no-op: cache invalidation is best-effort
      }
    }
  }, [activeTab, queryClient]);

  const goPanel = (panel) => {
    const allowed = panel === 'details' || panel === 'full' ? panel : 'menu';
    setEnrichmentPanel(allowed);
    const params = new URLSearchParams(searchParams);
    if (allowed === 'menu') params.delete('view');
    else params.set('view', allowed);
    setSearchParams(params);
  };

  // Sync CRM sub-view with URL (?crmView=...)
  useEffect(() => {
    if (activeTab !== 'crm') return;
    const v = (searchParams.get('crmView') || '').toLowerCase();
    const allowed = CRM_VIEWS.some((x) => x.id === v) ? v : 'summary';
    setCrmPanel(allowed);
  }, [activeTab, searchParams]);

  const goCrmPanel = (panel) => {
    const allowed = CRM_VIEWS.some((x) => x.id === panel) ? panel : 'summary';
    setCrmPanel(allowed);
    const params = new URLSearchParams(searchParams);
    if (allowed === 'summary') params.delete('crmView');
    else params.set('crmView', allowed);
    setSearchParams(params);
  };

  // Keyboard shortcuts for CRM sub-view navigation
  useEffect(() => {
    if (activeTab !== 'crm') return;

    const handleKeyDown = (e) => {
      // Check for Alt key (or Cmd on macOS) + shortcut letter
      if (!e.altKey && !e.metaKey) return;
      if (e.shiftKey || e.ctrlKey) return; // Avoid conflicts with other shortcuts

      const keyMap = {
        's': 'summary',      // Alt+S for Summary
        'k': 'checkins',     // Alt+K for Check-ins (K for "kheckins")
        'l': 'checklist',    // Alt+L for checklist
        'd': 'documents',    // Alt+D for Documents
        'm': 'communications', // Alt+M for coMmunications
      };

      const target = keyMap[e.key?.toLowerCase()];
      if (target) {
        e.preventDefault();
        goCrmPanel(target);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, searchParams]);

  // Persist CRM sub-view preference to localStorage per caseId
  useEffect(() => {
    if (!caseId || activeTab !== 'crm') return;
    
    // Save current CRM panel preference
    const storageKey = `crm-panel-preference-${caseId}`;
    try {
      localStorage.setItem(storageKey, crmPanel);
    } catch {
      // Silently fail if localStorage is unavailable
    }
  }, [caseId, crmPanel, activeTab]);

  // Restore CRM sub-view preference from localStorage on case load
  useEffect(() => {
    if (!caseId || activeTab !== 'crm') return;
    if (searchParams.has('crmView')) return; // URL params take precedence
    
    const storageKey = `crm-panel-preference-${caseId}`;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && CRM_VIEWS.some((v) => v.id === saved) && saved !== crmPanel) {
        setCrmPanel(saved);
      }
    } catch {
      // Silently fail if localStorage is unavailable
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, activeTab]);

  // Track CRM sub-view access for analytics
  useEffect(() => {
    if (!caseId || activeTab !== 'crm') return;
    
    try {
      // Log to console for now; could be extended to send to backend/analytics service
      console.debug('[CRM Analytics] Sub-view accessed', {
        caseId,
        subView: crmPanel,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
      });
      
      // Optional: Send to backend analytics endpoint if configured
      // Example: POST /api/analytics/crm-view-access with { caseId, subView, timestamp }
      // This could be enabled by uncommenting and configuring an analytics service
    } catch {
      // Silently fail if analytics logging errors
    }
  }, [caseId, crmPanel, activeTab]);

  // Header subtitle with CRM breadcrumb, now safely after activeTab/crmPanel are initialized
  const headerSubtitle = useMemo(() => {
    const parts = [];
    if (data?.spn) parts.push(`SPN ${data.spn}`);
    if (data?.case_number) parts.push(`Case #${data.case_number}`);
    if (dobDisplay && dobDisplay !== '—') parts.push(`DOB ${dobDisplay}`);
    const base = parts.length ? parts.join(' • ') : 'Full record overview';

    if (activeTab === 'crm' && crmPanel !== 'summary') {
      const subView = CRM_VIEWS.find((v) => v.id === crmPanel);
      if (subView) return `${base} › CRM › ${subView.label}`;
    }
    if (activeTab === 'crm') return `${base} › CRM`;

    return base;
  }, [data?.spn, data?.case_number, dobDisplay, activeTab, crmPanel]);

  // Determine in-custody status via enrichment subject summary flags when available
  const subjectIdForSummary = useMemo(() => data?.spn || data?.booking_number || '', [data?.spn, data?.booking_number]);
  const { data: subjectSummaryResp } = useSubjectSummary(subjectIdForSummary, { enabled: Boolean(subjectIdForSummary) });
  const inCustody = useMemo(() => {
    try {
      const flags = subjectSummaryResp?.summary?.flags || {};
      if (typeof flags?.notInJail === 'boolean') return !flags.notInJail;
      return undefined; // unknown
    } catch { return undefined; }
  }, [subjectSummaryResp]);

  const {
    data: enrichmentData,
    isLoading: enrichmentLoading,
    isFetching: enrichmentFetching,
    refetch: refetchEnrichment,
  } = useCaseEnrichment(caseId, selectedProviderId, {
    enabled: Boolean(caseId) && Boolean(selectedProviderId) && activeTab === 'enrichment',
  });

  // Proxy-first results for Pipl: list of matches for the subject
  const { data: piplMatchesData } = usePiplMatches(subjectIdForSummary, {
    enabled: Boolean(subjectIdForSummary) && selectedProviderId === 'pipl',
  });

  // Related parties for the subject (SPN); fetch when we have an identifier
  // Note: API may return either an array or an object with { rows }
  const { data: relatedPartiesData, refetch: refetchRelatedParties } = useRelatedParties(
    data?.spn || data?.booking_number,
    { enabled: Boolean(data?.spn || data?.booking_number) }
  );

  const permittedRoles = useMemo(
    () => Array.isArray(currentUser?.roles) ? currentUser.roles : [],
    [currentUser?.roles]
  );
  const canRunEnrichment = useMemo(
    () => permittedRoles.some((role) => ['SuperUser', 'Admin', 'DepartmentLead', 'Employee'].includes(role)),
    [permittedRoles]
  );
  const canForceByRole = useMemo(
    () => permittedRoles.some((role) => ['SuperUser', 'Admin'].includes(role)),
    [permittedRoles]
  );
  const isAdmin = canForceByRole;
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

  // Proxy-first: Pipl run via enrichment service, no dashboard API key required
  const piplFirstPull = usePiplFirstPull({
    onSuccess: (resp) => {
      const ms = typeof resp?.matchScore === 'number' ? Math.round(resp.matchScore * 100) : null;
      const scoreTxt = ms != null ? `Best match ${ms}%` : 'Pull complete';
      pushToast({ variant: 'success', title: 'Pipl enrichment complete', message: scoreTxt });
      try {
        // Refresh subject summary and related parties to reflect new facts/relations
        if (subjectIdForSummary) {
          queryClient.invalidateQueries({ queryKey: ['enrichmentSubjectSummary', subjectIdForSummary] });
          queryClient.invalidateQueries({ queryKey: ['relatedParties', subjectIdForSummary] });
          queryClient.invalidateQueries({ queryKey: ['piplMatches', subjectIdForSummary] });
        }
      } catch {
        // no-op: cache invalidation is best-effort
      }
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Pipl enrichment failed', message: err?.message || 'Unable to run Pipl right now.' });
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
  // Normalize proxy match list to a flexible array; accept common shapes {matches|candidates|rows|items}
  const piplRawList = useMemo(() => {
    if (!piplMatchesData) return [];
    const list = piplMatchesData.matches
      || piplMatchesData.candidates
      || piplMatchesData.rows
      || piplMatchesData.items
      || (Array.isArray(piplMatchesData) ? piplMatchesData : []);
    return Array.isArray(list) ? list : [];
  }, [piplMatchesData]);
  const usingProxyCandidates = selectedProviderId === 'pipl' && piplRawList.length > 0;
  const effectiveCandidates = usingProxyCandidates ? piplRawList : enrichmentCandidates;
  const enrichmentSelected = useMemo(
    () => Array.isArray(enrichmentDoc?.selectedRecords) ? enrichmentDoc.selectedRecords : [],
    [enrichmentDoc?.selectedRecords]
  );
  const relatedParties = useMemo(() => {
    // API may return either an array or { rows: [...] }
    const rows = Array.isArray(relatedPartiesData?.rows) ? relatedPartiesData.rows : (Array.isArray(relatedPartiesData) ? relatedPartiesData : []);
    return rows;
  }, [relatedPartiesData]);
  const relatedWithScores = useMemo(() => (
    Array.isArray(relatedParties)
      ? relatedParties.map((rp) => ({
          rp,
          s: Number.isFinite(Number(rp?.lastAudit?.match))
            ? Math.max(0, Math.min(1, Number(rp.lastAudit.match)))
            : null,
        }))
      : []
  ), [relatedParties]);
  // Sort control for related parties: 'score' (default) or 'value' (net-new data gained in last run)
  const [relatedSort, setRelatedSort] = useState('score');
  // Filter control for related parties: 'all' | 'hq' | 'phone' | 'email' | 'address'
  const [relatedFilter, setRelatedFilter] = useState('all');
  // Candidate filter for provider results: 'all' | 'hq' | 'phone'
  const [candidateFilter, setCandidateFilter] = useState('all');
  // Sync sort/filter with URL when on enrichment tab
  useEffect(() => {
    if (activeTab !== 'enrichment') return;
    const rpSort = (searchParams.get('rpSort') || '').toLowerCase();
    const rp = (searchParams.get('rp') || '').toLowerCase();
    const cand = (searchParams.get('cand') || '').toLowerCase();
    if (rpSort === 'value' || rpSort === 'score') setRelatedSort(rpSort);
    if (['all', 'hq', 'phone', 'email', 'address'].includes(rp)) setRelatedFilter(rp);
    if (['all', 'hq', 'phone'].includes(cand)) setCandidateFilter(cand);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
  useEffect(() => {
    if (activeTab !== 'enrichment') return;
    const params = new URLSearchParams(searchParams);
    params.set('view', (searchParams.get('view') || 'menu'));
    params.set('rpSort', relatedSort);
    params.set('rp', relatedFilter);
    params.set('cand', candidateFilter);
    setSearchParams(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relatedSort, relatedFilter, candidateFilter]);
  const relatedFiltered = useMemo(() => {
    if (!Array.isArray(relatedParties)) return [];
    switch (relatedFilter) {
      case 'hq': {
        return relatedParties.filter((rp) => {
          const s = Number.isFinite(Number(rp?.lastAudit?.match)) ? Math.max(0, Math.min(1, Number(rp.lastAudit.match))) : null;
          return s != null && s >= HIGH_QUALITY_MATCH;
        });
      }
      case 'phone':
        return relatedParties.filter((rp) => Array.isArray(rp?.contacts?.phones) && rp.contacts.phones.length > 0);
      case 'email':
        return relatedParties.filter((rp) => Array.isArray(rp?.contacts?.emails) && rp.contacts.emails.length > 0);
      case 'address':
        return relatedParties.filter((rp) => Array.isArray(rp?.addresses) && rp.addresses.length > 0);
      default:
        return relatedParties;
    }
  }, [relatedParties, relatedFilter]);
  const relatedSorted = useMemo(() => {
    if (!Array.isArray(relatedFiltered)) return [];
    const rows = relatedFiltered.map((rp) => {
      const s = Number.isFinite(Number(rp?.lastAudit?.match)) ? Math.max(0, Math.min(1, Number(rp.lastAudit.match))) : null;
      const nP = Number.isFinite(Number(rp?.lastAudit?.netNewPhones)) ? Number(rp.lastAudit.netNewPhones) : 0;
      const nE = Number.isFinite(Number(rp?.lastAudit?.netNewEmails)) ? Number(rp.lastAudit.netNewEmails) : 0;
      const nA = Number.isFinite(Number(rp?.lastAudit?.netNewAddresses)) ? Number(rp.lastAudit.netNewAddresses) : 0;
      const v = nP + nE + nA;
      return { rp, s, v };
    });
    rows.sort((a, b) => {
      if (relatedSort === 'value') {
        const byV = (b.v || 0) - (a.v || 0);
        if (byV !== 0) return byV;
        return (b.s ?? -1) - (a.s ?? -1);
      }
      const byS = (b.s ?? -1) - (a.s ?? -1);
      if (byS !== 0) return byS;
      return (b.v || 0) - (a.v || 0);
    });
    return rows.map((x) => x.rp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relatedParties, relatedSort]);
  const highQualityRelated = useMemo(() => (
    relatedWithScores.filter((x) => x.s != null && x.s >= HIGH_QUALITY_MATCH).map((x) => x.rp)
  ), [relatedWithScores]);
  // Admin override local state
  const [overrideEditPartyId, setOverrideEditPartyId] = useState('');
  const [overrideType, setOverrideType] = useState('');
  const [overrideLabel, setOverrideLabel] = useState('');
  // Expanded rows
  const [expandedParties, setExpandedParties] = useState(() => new Set());
  const toggleExpanded = (partyId) => {
    setExpandedParties((prev) => {
      const next = new Set(prev);
      if (next.has(partyId)) next.delete(partyId);
      else next.add(partyId);
      return next;
    });
  };
  const enrichmentSelectedSet = useMemo(
    () => new Set(enrichmentSelected.map((entry) => entry?.recordId).filter(Boolean)),
    [enrichmentSelected]
  );
  const withScores = useMemo(() => (
    Array.isArray(effectiveCandidates)
      ? effectiveCandidates.map((c) => ({ c, s: getCandidateScore(c) }))
      : []
  ), [effectiveCandidates]);
  const highQualityCandidates = useMemo(() => withScores.filter((x) => x.s != null && x.s >= HIGH_QUALITY_MATCH).map((x) => x.c), [withScores]);
  const withPhoneCandidates = useMemo(() => (
    effectiveCandidates.filter((c) => Array.isArray(c?.contacts) && c.contacts.some((ct) => /\d{10}/.test(String(ct?.value || '').replace(/\D/g, ''))))
  ), [effectiveCandidates]);
  const bestCandidate = useMemo(() => {
    if (!withScores.length) return null;
    const sorted = withScores.slice().sort((a, b) => (b.s ?? -1) - (a.s ?? -1));
    return sorted[0]?.c || null;
  }, [withScores]);
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

  // Subject summary: captured details (phones/emails/addresses) for the inmate from enrichment
  const subjectId = data?.spn || data?.booking_number || '';
  const { data: subjectSummaryData } = useSubjectSummary(subjectId, {
    enabled: Boolean(subjectId),
  });
  const subjectSummary = subjectSummaryData?.summary || null;
  // CRM suggestions from enrichment/related parties
  const { data: crmSuggestData } = useCrmSuggestions(subjectId, { enabled: Boolean(subjectId) });
  const crmSuggestions = crmSuggestData?.suggestions || null;
  const crmSuggestionSources = crmSuggestData?.sources || {};
  const subjectName = subjectSummary?.name || data?.full_name || 'Unknown';
  const subjectPhones = useMemo(() => {
    const fromFacts = Array.isArray(subjectSummary?.facts?.phones) ? subjectSummary.facts.phones : [];
    const fromPipl = Array.isArray(subjectSummary?.pipl?.phones) ? subjectSummary.pipl.phones : [];
    const fromRoot = Array.isArray(subjectSummary?.phones) ? subjectSummary.phones : [];
    const list = [...fromFacts, ...fromPipl, ...fromRoot]
      .map((v) => (typeof v === 'string' ? v : (v?.value || v?.number || '')))
      .filter((v) => typeof v === 'string' && v.trim().length > 0);
    const seen = new Set();
    const dedup = [];
    list.forEach((p) => {
      const key = p.replace(/[^0-9]/g, '').replace(/^1/, '');
      if (!key || seen.has(key)) return;
      seen.add(key);
      dedup.push(p);
    });
    return dedup;
  }, [subjectSummary]);
  const currentSubjectPhone = subjectPhones[0] || null;
  const allSubjectAddresses = useMemo(() => {
    const out = [];
    const push = (v) => {
      if (!v || typeof v !== 'string') return;
      const s = v.trim();
      if (!s) return;
      if (out.some((x) => x.toLowerCase() === s.toLowerCase())) return;
      out.push(s);
    };
    if (typeof subjectSummary?.baseAddress === 'string') push(subjectSummary.baseAddress);
    (Array.isArray(subjectSummary?.facts?.addresses) ? subjectSummary.facts.addresses : []).forEach(push);
    (Array.isArray(subjectSummary?.pipl?.addresses) ? subjectSummary.pipl.addresses : []).forEach(push);
    return out;
  }, [subjectSummary]);
  const currentSubjectAddress = allSubjectAddresses[0] || null;
  const otherAddressesCount = Math.max(0, allSubjectAddresses.length - 1);

  // Related-party enrichment options
  const [relatedLocationPref, setRelatedLocationPref] = useState(() => {
    try { return localStorage.getItem('relatedLocationPref') || 'auto'; } catch { return 'auto'; }
  });
  const [relatedAggressive, setRelatedAggressive] = useState(() => {
    try { return (localStorage.getItem('relatedAggressive') || 'true') === 'true'; } catch { return true; }
  });
  const [relatedForce, setRelatedForce] = useState(() => {
    try { return (localStorage.getItem('relatedForce') || 'false') === 'true'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('relatedLocationPref', String(relatedLocationPref)); } catch {
      // no-op: localStorage may be unavailable
    }
  }, [relatedLocationPref]);
  useEffect(() => {
    try { localStorage.setItem('relatedAggressive', relatedAggressive ? 'true' : 'false'); } catch {
      // no-op: localStorage may be unavailable
    }
  }, [relatedAggressive]);
  useEffect(() => {
    try { localStorage.setItem('relatedForce', relatedForce ? 'true' : 'false'); } catch {
      // no-op: localStorage may be unavailable
    }
  }, [relatedForce]);
  const preferStatewideParam = useMemo(() => {
    if (relatedLocationPref === 'auto') return undefined;
    return relatedLocationPref === 'statewide';
  }, [relatedLocationPref]);

  // Client details address text for map display
  const fallbackStateCode = useMemo(() => {
    const fromField = (contactStateCode || '').trim();
    if (/^[A-Za-z]{2}$/.test(fromField)) return fromField.toUpperCase();
    const fromData = (data?.stateCode || data?.state || '').trim();
    if (/^[A-Za-z]{2}$/.test(fromData)) return fromData.toUpperCase();
    return '';
  }, [contactStateCode, data?.stateCode, data?.state]);
  const fallbackCountry = 'US';

  // Build normalized address for geocoding and record whether state was inferred
  const clientAddressInference = useMemo(() => {
    const addrText = formatAddressDisplay({
      streetLine1: contactStreet1,
      streetLine2: contactStreet2,
      city: contactCity,
      stateCode: contactStateCode,
      postalCode: contactPostalCode,
    }) || (currentSubjectAddress || '');
    let s = String(addrText || '').trim();
    if (!s || s === '—') return { text: '', stateInferred: false, inferredStateCode: '', countryInferred: false };
    s = s.replace(/[\n\r]+/g, ', ').replace(/;+$/g, '').replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ', ').replace(/,+\s*$/, '');
    const hasStateLike = /(^|[,\s])([A-Za-z]{2})(\s+\d{5}(-\d{4})?)?($|[,\s])/.test(s);
    let stateInferred = false;
    let countryInferred = false;
    if (!hasStateLike && fallbackStateCode) {
      s = `${s}, ${fallbackStateCode}, ${fallbackCountry}`;
      stateInferred = true;
      countryInferred = true;
    } else if (!/\b(US|USA|United States)\b/i.test(s)) {
      s = `${s}, ${fallbackCountry}`;
      countryInferred = true;
    }
    return { text: s, stateInferred, inferredStateCode: stateInferred ? fallbackStateCode : '', countryInferred };
  }, [contactStreet1, contactStreet2, contactCity, contactStateCode, contactPostalCode, currentSubjectAddress, fallbackStateCode]);

  // Derive city/state/zip for field-level copy helpers
  const addressFieldParts = useMemo(() => {
    const city = (contactCity || '').trim();
    const state = (contactStateCode || '').trim();
    const zip = (contactPostalCode || '').trim();
    if (city || state || zip) return { city, state, zip };
    // Fallback: try to parse the subject address string
    try {
      const parsed = parseSuggestedAddress(currentSubjectAddress || '') || {};
      return {
        city: (parsed.city || '').trim(),
        state: (parsed.stateCode || '').trim(),
        zip: (parsed.postalCode || '').trim(),
      };
    } catch {
      return { city: '', state: '', zip: '' };
    }
  }, [contactCity, contactStateCode, contactPostalCode, currentSubjectAddress]);

  // Auto-populate CRM state code when missing using case metadata
  useEffect(() => {
    if (!contactStateCode) {
      const st = (data?.stateCode || data?.state || '').trim();
      if (st && /^[A-Za-z]{2}$/.test(st)) {
        setContactStateCode(st.toUpperCase());
      }
    }
  }, [contactStateCode, data?.stateCode, data?.state]);

  // Toggle input form visibility based on whether we have prior enrichment
  useEffect(() => {
    // Default behavior: show inputs before first run; hide after results exist
    setEnrichmentInputsExpanded(!enrichmentDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProviderId, Boolean(enrichmentDoc)]);

  // Re-enrich related party action
  const relatedPartyPull = useRelatedPartyPull({
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'Re-enrichment queued', message: 'Related party enrichment has been triggered.' });
      // Refresh related parties shortly after
      setTimeout(() => {
        if (typeof refetchRelatedParties === 'function') refetchRelatedParties();
      }, 750);
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Unable to re-enrich', message: err?.message || 'Failed to trigger related party enrichment.' });
    },
  });

  // Validate related-party phones for this subject
  const validatePartyPhones = useValidateRelatedPartyPhones({
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'Validation queued', message: 'Phone validation triggered for related parties.' });
      setTimeout(() => {
        if (typeof refetchRelatedParties === 'function') refetchRelatedParties();
      }, 750);
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Validation failed', message: err?.message || 'Unable to validate related party phones.' });
    },
  });

  // Admin override for relationship classification
  const relatedPartyOverride = useRelatedPartyOverride({
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'Relationship updated', message: 'Override saved successfully.' });
      setOverrideEditPartyId('');
      setOverrideType('');
      setOverrideLabel('');
      if (typeof refetchRelatedParties === 'function') refetchRelatedParties();
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Override failed', message: err?.message || 'Unable to save override.' });
    },
  });

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

    // Proxy-first path for Pipl: call enrichment service via dashboard proxy
    if (selectedProviderId === 'pipl') {
      const sid = subjectIdForSummary;
      if (!sid) {
        pushToast({ variant: 'warn', title: 'Missing subject ID', message: 'SPN or booking number is required to run Pipl.' });
        return;
      }
      // For Pipl, enrichment API derives inputs from subject; optional aggressive/override to consider later
      piplFirstPull.mutate({ subjectId: sid, overrideLocation: false });
      return;
    }

    if (force && supportsForce && canForceByRole) {
      cleanedPayload.force = true;
    }

    // Fallback to legacy server-managed providers for non-Pipl
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
      email: contactEmail,
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

  // Helpers to apply CRM suggestions safely (do not overwrite without confirmation)
  const parseSuggestedAddress = (addrStr) => {
    if (typeof addrStr !== 'string' || !addrStr.trim()) return null;
    const s = addrStr.trim();
    // Try to parse formats like: "123 Main St, Houston, TX 77001"
    const m = s.match(/^\s*(.+?),\s*([^,]+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?\s*$/i);
    if (m) {
      return {
        streetLine1: m[1].trim(),
        streetLine2: '',
        city: m[2].trim(),
        stateCode: m[3].toUpperCase(),
        postalCode: (m[4] || '').trim(),
      };
    }
    // Fallback: best-effort split by commas
    const partsRaw = s.split(',').map((p) => p.trim()).filter(Boolean);
    // Drop trailing country if present
    const parts = partsRaw.length && /^(US|USA|United States)$/i.test(partsRaw[partsRaw.length - 1])
      ? partsRaw.slice(0, -1)
      : partsRaw;
    // Handle "City, ST ZIP" (no street)
    if (parts.length === 2) {
      const [city, stateZipStr] = parts;
      const m2 = stateZipStr.match(/^([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/);
      if (m2) {
        return { streetLine1: '', streetLine2: '', city: city || '', stateCode: m2[1].toUpperCase(), postalCode: m2[2] || '' };
      }
    }
    if (parts.length >= 3) {
      const last = parts[parts.length - 1];
      const stateZip = last.match(/([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)/);
      const stateOnly = /^[A-Za-z]{2}$/.test(last);
      return {
        streetLine1: parts[0] || '',
        streetLine2: parts.length > 3 ? parts.slice(1, parts.length - 2).join(', ') : '',
        city: parts[parts.length - 2] || (parts.length === 2 ? parts[0] : ''),
        stateCode: stateZip ? stateZip[1].toUpperCase() : (stateOnly ? last.toUpperCase() : ''),
        postalCode: stateZip ? stateZip[2] : '',
      };
    }
    return { streetLine1: s, streetLine2: '', city: '', stateCode: '', postalCode: '' };
  };

  const _confirmReplace = (label) => {
    if (typeof window === 'undefined') return true;
    return window.confirm(`Replace existing ${label}? This will overwrite the current value.`);
  };

  const applySuggestedPhone = () => {
    if (!caseId || !crmSuggestions?.phone) return;
    const fromRelated = typeof crmSuggestionSources?.phone === 'string' && crmSuggestionSources.phone.split('|').map((s) => s.trim()).includes('related_parties');
    const msg = fromRelated
      ? 'The suggested phone comes from a related party. Apply it as the CLIENT\'s primary phone?'
      : 'Replace existing phone? This will overwrite the current value.';
    if (contactPhone) {
      if (!window.confirm(msg)) return;
    }
    updateCrm.mutate({ caseId, payload: { phone: crmSuggestions.phone } });
  };

  const applySuggestedAddress = () => {
    if (!caseId || !crmSuggestions?.address) return;
    const parsed = parseSuggestedAddress(crmSuggestions.address);
    if (!parsed) return;
    const hasExisting = [contactStreet1, contactStreet2, contactCity, contactStateCode, contactPostalCode]
      .some((v) => (v || '').trim().length > 0);
    const fromRelated = typeof crmSuggestionSources?.address === 'string' && crmSuggestionSources.address.split('|').map((s) => s.trim()).includes('related_parties');
    if (hasExisting) {
      const msg = fromRelated
        ? 'The suggested address comes from a related party. Apply it as the CLIENT\'s mailing address and overwrite existing?'
        : 'Replace existing address? This will overwrite the current value.';
      if (!window.confirm(msg)) return;
    } else if (fromRelated) {
      const msg2 = 'The suggested address comes from a related party. Apply it as the CLIENT\'s address?';
      if (!window.confirm(msg2)) return;
    }
    updateCrm.mutate({ caseId, payload: { address: parsed } });
  };

  const applySuggestedEmail = () => {
    if (!caseId || !crmSuggestions?.email) return;
    const fromRelated = typeof crmSuggestionSources?.email === 'string' && crmSuggestionSources.email.split('|').map((s) => s.trim()).includes('related_parties');
    const msg = fromRelated
      ? 'The suggested email comes from a related party. Apply it as the CLIENT\'s primary email?'
      : 'Replace existing email? This will overwrite the current value.';
    if (contactEmail) {
      if (!window.confirm(msg)) return;
    } else if (fromRelated) {
      if (!window.confirm(msg)) return;
    }
    updateCrm.mutate({ caseId, payload: { email: crmSuggestions.email } });
  };

  // Extend suggestions: add as contact (phone/email) and save address as alternate
  const addSuggestedPhoneAsContact = () => {
    if (!caseId || !crmSuggestions?.phone) return;
    const phone = crmSuggestions.phone;
    const existingList = Array.isArray(crmDetails?.contacts) ? crmDetails.contacts : [];
    const phoneKey = String(phone || '').replace(/[^0-9]/g, '').replace(/^1/, '');
    const exists = existingList.some((ex) => {
      const exPhoneKey = String(ex?.phone || '').replace(/[^0-9]/g, '').replace(/^1/, '');
      return phoneKey && exPhoneKey && phoneKey === exPhoneKey;
    });
    if (exists) {
      pushToast({ variant: 'info', title: 'Already added', message: 'This phone is already in contacts.' });
      return;
    }
    const name = typeof window !== 'undefined' ? (window.prompt('Contact name (optional):') || '').trim() : '';
    const relation = typeof window !== 'undefined' ? (window.prompt('Relation (optional):') || '').trim() : '';
    const next = [...existingList, { name, relation, phone, email: '' }];
    updateCrm.mutate({ caseId, payload: { contacts: next } });
  };

  const addSuggestedEmailAsContact = () => {
    if (!caseId || !crmSuggestions?.email) return;
    const email = crmSuggestions.email;
    const existingList = Array.isArray(crmDetails?.contacts) ? crmDetails.contacts : [];
    const exists = existingList.some((ex) => {
      const exEmail = String(ex?.email || '').toLowerCase();
      return email && exEmail && email.toLowerCase() === exEmail;
    });
    if (exists) {
      pushToast({ variant: 'info', title: 'Already added', message: 'This email is already in contacts.' });
      return;
    }
    const name = typeof window !== 'undefined' ? (window.prompt('Contact name (optional):') || '').trim() : '';
    const relation = typeof window !== 'undefined' ? (window.prompt('Relation (optional):') || '').trim() : '';
    const next = [...existingList, { name, relation, phone: '', email }];
    updateCrm.mutate({ caseId, payload: { contacts: next } });
  };

  const saveSuggestedAddressAsAlternate = () => {
    if (!caseId || !crmSuggestions?.address) return;
    const parsed = parseSuggestedAddress(crmSuggestions.address);
    if (!parsed) return;
    const label = typeof window !== 'undefined' ? (window.prompt('Label for this alternate address (optional):') || '').trim() : '';
    const existing = Array.isArray(crmDetails?.alternateAddresses) ? crmDetails.alternateAddresses : [];
    const keyFor = (a) => [a.streetLine1||'', a.city||'', a.stateCode||'', a.postalCode||''].join('|').toLowerCase();
    const exists = existing.some((a) => keyFor(a) === keyFor(parsed));
    if (exists) {
      pushToast({ variant: 'info', title: 'Already saved', message: 'This address is already in alternate addresses.' });
      return;
    }
    const next = [...existing, { ...parsed, ...(label ? { label } : {}) }];
    updateCrm.mutate({ caseId, payload: { alternateAddresses: next } });
  };

  const removeAlternateAddress = (idx) => {
    if (!caseId) return;
    const existing = Array.isArray(crmDetails?.alternateAddresses) ? crmDetails.alternateAddresses : [];
    if (idx < 0 || idx >= existing.length) return;
    const next = existing.filter((_, i) => i !== idx);
    updateCrm.mutate({ caseId, payload: { alternateAddresses: next } });
  };

  const renameAlternateAddress = (idx) => {
    if (!caseId) return;
    const existing = Array.isArray(crmDetails?.alternateAddresses) ? crmDetails.alternateAddresses : [];
    if (idx < 0 || idx >= existing.length) return;
    const current = existing[idx] || {};
    const nextLabel = typeof window !== 'undefined' ? window.prompt('Edit label (leave blank to clear):', current.label || '') : '';
    if (nextLabel === null) return; // cancelled
    const trimmed = String(nextLabel || '').trim();
    const updated = { ...current };
    if (trimmed) updated.label = trimmed; else delete updated.label;
    const next = existing.map((a, i) => (i === idx ? updated : a));
    updateCrm.mutate({ caseId, payload: { alternateAddresses: next } });
  };

  const promoteAlternateAddress = (idx) => {
    if (!caseId) return;
    const existing = Array.isArray(crmDetails?.alternateAddresses) ? crmDetails.alternateAddresses : [];
    if (idx < 0 || idx >= existing.length) return;
    const selected = existing[idx] || {};
    const confirmed = typeof window !== 'undefined'
      ? window.confirm('Set this as the primary address and remove it from alternates?')
      : true;
    if (!confirmed) return;
    const nextAlternates = existing.filter((_, i) => i !== idx);
    const primaryAddress = {
      streetLine1: selected.streetLine1 || '',
      streetLine2: selected.streetLine2 || '',
      city: selected.city || '',
      stateCode: selected.stateCode || '',
      postalCode: selected.postalCode || '',
    };
    updateCrm.mutate({ caseId, payload: { address: primaryAddress, alternateAddresses: nextAlternates } });
  };

  const buildApplyAllMissingPayload = () => {
    if (!caseId || !crmSuggestions) return;
    const payload = {};
    if (!contactPhone && crmSuggestions.phone) payload.phone = crmSuggestions.phone;
    if (!contactEmail && crmSuggestions.email) payload.email = crmSuggestions.email;
    const addrMissing = !contactStreet1 && !contactCity && !contactStateCode && !contactPostalCode;
    if (addrMissing && crmSuggestions.address) {
      const parsed = parseSuggestedAddress(crmSuggestions.address);
      if (parsed) payload.address = parsed;
    }
    return payload;
  };

  const [showApplyPreview, setShowApplyPreview] = useState(false);
  const [applyPreviewPayload, setApplyPreviewPayload] = useState(null);

  const applyAllMissing = () => {
    const payload = buildApplyAllMissingPayload();
    if (!payload || Object.keys(payload).length === 0) {
      pushToast({ variant: 'info', title: 'Nothing to apply', message: 'All suggested fields are already set.' });
      return;
    }
    setApplyPreviewPayload(payload);
    setShowApplyPreview(true);
  };

  // Deep link to Enrichment tab with optional presets
  const goToEnrichment = ({ view = 'full', rp, rpSort, cand } = {}) => {
    // Friendly toast to confirm context of the deep link
    try {
      const parts = [];
      if (view === 'details') parts.push('details');
      if (rp === 'hq') parts.push('HQ related parties');
      if (rp === 'phone') parts.push('related parties with phone');
      if (typeof rp === 'string' && rp && rp !== 'hq' && rp !== 'phone') parts.push(`related parties: ${rp}`);
      if (rpSort === 'value') parts.push('sorted by value');
      if (cand === 'hq') parts.push('candidates: HQ');
      if (cand === 'phone') parts.push('candidates: with phone');
      const msg = parts.length ? `Opening Enrichment (${parts.join(', ')})` : 'Opening Enrichment';
      pushToast({ variant: 'info', title: 'Deep link', message: msg });
    } catch {
      // no-op: toast is best-effort
    }
    setActiveTab('enrichment');
    const params = new URLSearchParams(searchParams);
    params.set('view', view);
    if (rp) params.set('rp', rp); else params.delete('rp');
    if (rpSort) params.set('rpSort', rpSort); else params.delete('rpSort');
    if (cand) params.set('cand', cand); else params.delete('cand');
    setSearchParams(params);
    // Also sync local panel state
    setEnrichmentPanel(view === 'details' || view === 'full' ? view : 'menu');
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-8">
          <StatTile label="Stage" value={stageDisplay} />
          <StatTile label="Bond" value={bondDisplay} />
          <StatTile label="Assigned" value={crmDetails.assignedTo || 'Unassigned'} />
          <StatTile label="Next follow-up" value={followUpDisplay} />
          <StatTile
            label="Age"
            value={ageYears != null ? `${ageYears}` : '—'}
            hint={dobDisplay && dobDisplay !== '—' ? `DOB ${dobDisplay}` : undefined}
          />
          <StatTile label="In custody" value={inCustody === true ? 'Yes' : (inCustody === false ? 'No' : '—')} />
          <StatTile label="Since booking" value={ageInfo.label} hint={data.booking_date ? `Booked ${data.booking_date}` : undefined} />
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
          {(() => {
            try {
              const totalRelated = Array.isArray(relatedParties) ? relatedParties.length : 0;
              const hqRelated = Array.isArray(highQualityRelated) ? highQualityRelated.length : 0;
              const phonesOnSubject = Array.isArray(subjectPhones) ? subjectPhones.length : 0;
              const sums = (Array.isArray(relatedParties) ? relatedParties : []).reduce((acc, rp) => {
                const p = Array.isArray(rp?.contacts?.phones) ? rp.contacts.phones.length : 0;
                const e = Array.isArray(rp?.contacts?.emails) ? rp.contacts.emails.length : 0;
                const a = Array.isArray(rp?.addresses) ? rp.addresses.length : 0;
                acc.p += p; acc.e += e; acc.a += a; acc.withPhone += p > 0 ? 1 : 0; return acc;
              }, { p: 0, e: 0, a: 0, withPhone: 0 });
              const lastRelatedAt = (Array.isArray(relatedParties) ? relatedParties : []).reduce((max, rp) => {
                const t = rp?.lastAudit?.at ? new Date(rp.lastAudit.at).getTime() : 0;
                return Number.isFinite(t) && t > max ? t : max;
              }, 0);
              const availableNow = (Array.isArray(relatedParties) ? relatedParties : []).reduce((count, rp) => {
                const untilStr = rp?.lastAudit?.cooldownUntil;
                if (!untilStr) return count + 1;
                const until = new Date(untilStr).getTime();
                return (!Number.isFinite(until) || until <= Date.now()) ? count + 1 : count;
              }, 0);
              return (
                <>
                  <StatTile
                    label="Related parties"
                    value={totalRelated ? `${hqRelated}/${totalRelated}` : '—'}
                    hint={totalRelated ? 'HQ / Total' : undefined}
                    onClick={() => goToEnrichment({ view: 'full', rp: hqRelated ? 'hq' : 'all' })}
                  />
                  <StatTile
                    label="Contacts (parties)"
                    value={`${sums.p}p • ${sums.e}e • ${sums.a}a`}
                    hint={`${sums.withPhone} with phone`}
                    onClick={() => goToEnrichment({ view: 'full', rp: 'phone', rpSort: 'value' })}
                  />
                  <StatTile
                    label="Subject phones"
                    value={phonesOnSubject || '—'}
                    hint={subjectPhones[0] ? `Primary ${subjectPhones[0]}` : undefined}
                    onClick={() => goToEnrichment({ view: 'details' })}
                  />
                  <StatTile
                    label="Re-enrich available"
                    value={availableNow || '0'}
                    hint="Parties eligible now"
                    onClick={() => goToEnrichment({ view: 'full', rpSort: 'value' })}
                  />
                  <StatTile
                    label="Last related pull"
                    value={lastRelatedAt ? formatRelative(lastRelatedAt) : '—'}
                    onClick={() => goToEnrichment({ view: 'full' })}
                  />
                </>
              );
            } catch {
              return null;
            }
          })()}
        </div>
  </SectionCard>
  

      <SectionCard title="Client details" subtitle="Current primary contact and address at a glance">
        <div className="grid gap-4 md:grid-cols-3 text-sm">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Primary phone</div>
            <div className="mt-1 flex items-center gap-2 font-medium text-slate-800">
              <a
                href={toTelHref(contactPhone || currentSubjectPhone)}
                className="hover:underline"
                onClick={(e) => { if (!(contactPhone || currentSubjectPhone)) e.preventDefault(); }}
              >
                {contactPhone ? formatPhone(contactPhone) : (currentSubjectPhone ? formatPhone(currentSubjectPhone) : '—')}
              </a>
              {(contactPhone || currentSubjectPhone) ? (
                <button
                  type="button"
                  onClick={() => copyText(contactPhone || currentSubjectPhone, pushToast)}
                  className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:border-slate-300"
                >
                  Copy
                </button>
              ) : null}
            </div>
            {!contactPhone && currentSubjectPhone ? (
              <div className="mt-1 text-xs text-slate-500">from enrichment</div>
            ) : null}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Address</div>
            <div className="mt-1 whitespace-pre-line font-medium text-slate-800">
              {(() => {
                const addrText = formatAddressDisplay({
                  streetLine1: contactStreet1,
                  streetLine2: contactStreet2,
                  city: contactCity,
                  stateCode: contactStateCode,
                  postalCode: contactPostalCode,
                }) || (currentSubjectAddress || '—');
                const oneLine = clientAddressInference.text || String(addrText).replace(/[\n\r]+/g, ', ');
                return (
                  <div className="flex items-start gap-2">
                    <a
                      href={toMapsHref(addrText)}
                      className="hover:underline"
                      onClick={(e) => { if (!addrText || addrText === '—') e.preventDefault(); }}
                    >
                      {addrText}
                    </a>
                    {addrText && addrText !== '—' ? (
                      <button
                        type="button"
                        onClick={() => copyText(addrText, pushToast)}
                        className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:border-slate-300"
                      >
                        Copy
                      </button>
                    ) : null}
                    {addrText && addrText !== '—' ? (
                      <button
                        type="button"
                        onClick={() => copyText(oneLine, pushToast)}
                        className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:border-slate-300"
                      >
                        Copy 1-line
                      </button>
                    ) : null}
                    <a
                      href={toMapsHref(oneLine)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:border-slate-300"
                    >
                      Open in Google Maps
                    </a>
                  </div>
                );
              })()}
            </div>
            {(() => {
              const { city, state, zip } = addressFieldParts;
              if (!(city || state || zip)) return null;
              return (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>Quick copy:</span>
                  {city ? (
                    <button
                      type="button"
                      onClick={() => copyText(city, pushToast)}
                      className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:border-slate-300"
                    >
                      City
                    </button>
                  ) : null}
                  {state ? (
                    <button
                      type="button"
                      onClick={() => copyText(state, pushToast)}
                      className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:border-slate-300"
                    >
                      State
                    </button>
                  ) : null}
                  {zip ? (
                    <button
                      type="button"
                      onClick={() => copyText(zip, pushToast)}
                      className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:border-slate-300"
                    >
                      ZIP
                    </button>
                  ) : null}
                </div>
              );
            })()}
            {!(contactStreet1 || contactCity || contactStateCode || contactPostalCode) && currentSubjectAddress ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>from enrichment</span>
                {clientAddressInference.stateInferred && clientAddressInference.inferredStateCode ? (
                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                    state inferred: {clientAddressInference.inferredStateCode}
                  </span>
                ) : null}
                {!clientAddressInference.stateInferred && clientAddressInference.countryInferred ? (
                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                    country inferred: US
                  </span>
                ) : null}
              </div>
            ) : null}
            {/* Inline OSM map with marker for current address */}
            {clientAddressInference.text ? (
              <InlineMapEmbed addressText={clientAddressInference.text} onResolvedAddress={handleMapResolvedAddress} />
            ) : null}
            {Array.isArray(crmDetails?.alternateAddresses) && crmDetails.alternateAddresses.length ? (
              <div className="mt-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Alternate addresses</div>
                <ul className="mt-1 space-y-1 text-xs">
                  {crmDetails.alternateAddresses.map((a, i) => {
                    const display = formatAddressDisplay(a) || [a?.streetLine1, a?.city, a?.stateCode, a?.postalCode].filter(Boolean).join(', ');
                    const maps = toMapsHref(display);
                    return (
                      <li key={`alt-${i}`} className="flex items-start justify-between gap-2">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <a href={maps} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                              {display || '—'}
                            </a>
                            {a?.label ? (
                              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">{a.label}</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <button type="button" className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:border-slate-300" onClick={() => copyText(display, pushToast)}>Copy</button>
                          <button type="button" className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:border-slate-300" onClick={() => renameAlternateAddress(i)} disabled={updateCrm.isPending}>Rename</button>
                          <button type="button" className="rounded border border-blue-300 px-2 py-0.5 text-[11px] text-blue-700 hover:bg-blue-50" onClick={() => promoteAlternateAddress(i)} disabled={updateCrm.isPending}>Promote to primary</button>
                          <button type="button" className="rounded border border-rose-300 px-2 py-0.5 text-[11px] text-rose-700 hover:bg-rose-50" onClick={() => removeAlternateAddress(i)} disabled={updateCrm.isPending}>Remove</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 flex flex-col justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Owner</div>
              <div className="mt-1 font-medium text-slate-800">{assignedTo || '—'}</div>
              <div className="mt-2 text-xs text-slate-500">Follow-up: {followUpAt ? formatRelative(followUpAt) : '—'}</div>
            </div>
            <div className="mt-3">
              <button
                type="button"
                onClick={() => goToEnrichment({ view: 'full', rp: 'phone', rpSort: 'value' })}
                className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                Open Enrichment
              </button>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="CRM suggestions" subtitle="Proposed values from enrichment (apply only what’s missing)">
        <div className="space-y-3 text-sm">
          {!crmSuggestions ? (
            <div className="text-slate-500">No suggestions available right now.</div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</div>
                  <div className="mt-1 flex items-center gap-2 font-medium text-slate-800">
                    <a
                      href={toTelHref(crmSuggestions.phone)}
                      className="hover:underline"
                      onClick={(e) => { if (!crmSuggestions.phone) e.preventDefault(); }}
                    >
                      {crmSuggestions.phone ? formatPhone(crmSuggestions.phone) : '—'}
                    </a>
                    {crmSuggestions.phone ? (
                      <button
                        type="button"
                        onClick={() => copyText(crmSuggestions.phone, pushToast)}
                        className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:border-slate-300"
                      >
                        Copy
                      </button>
                    ) : null}
                  </div>
                  {renderSourceBadges(crmSuggestionSources?.phone)}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!crmSuggestions.phone}
                      onClick={applySuggestedPhone}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {contactPhone ? 'Replace phone' : 'Apply phone'}
                    </button>
                    <button
                      type="button"
                      disabled={!crmSuggestions.phone}
                      onClick={addSuggestedPhoneAsContact}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add as contact
                    </button>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</div>
                  <div className="mt-1 flex items-center gap-2 font-medium text-slate-800">
                    <a
                      href={crmSuggestions.email ? `mailto:${crmSuggestions.email}` : '#'}
                      className="hover:underline"
                      onClick={(e) => { if (!crmSuggestions.email) e.preventDefault(); }}
                    >
                      {crmSuggestions.email || '—'}
                    </a>
                    {crmSuggestions.email ? (
                      <button
                        type="button"
                        onClick={() => copyText(crmSuggestions.email, pushToast)}
                        className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:border-slate-300"
                      >
                        Copy
                      </button>
                    ) : null}
                  </div>
                  {renderSourceBadges(crmSuggestionSources?.email)}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!crmSuggestions.email}
                      onClick={applySuggestedEmail}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {contactEmail ? 'Replace email' : 'Apply email'}
                    </button>
                    <button
                      type="button"
                      disabled={!crmSuggestions.email}
                      onClick={addSuggestedEmailAsContact}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add as contact
                    </button>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Address</div>
                  <div className="mt-1 flex items-start gap-2 whitespace-pre-line font-medium text-slate-800">
                    <a
                      href={toMapsHref(crmSuggestions.address)}
                      className="hover:underline"
                      onClick={(e) => { if (!crmSuggestions.address) e.preventDefault(); }}
                    >
                      {crmSuggestions.address || '—'}
                    </a>
                    {crmSuggestions.address ? (
                      <button
                        type="button"
                        onClick={() => copyText(crmSuggestions.address, pushToast)}
                        className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:border-slate-300"
                      >
                        Copy
                      </button>
                    ) : null}
                  </div>
                  {renderSourceBadges(crmSuggestionSources?.address)}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!crmSuggestions.address}
                      onClick={applySuggestedAddress}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {(contactStreet1 || contactCity || contactStateCode || contactPostalCode) ? 'Replace address' : 'Apply address'}
                    </button>
                    <button
                      type="button"
                      disabled={!crmSuggestions.address}
                      onClick={saveSuggestedAddressAsAlternate}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:border-amber-300 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Save as alternate
                    </button>
                  </div>
                </div>
              </div>

              {Array.isArray(crmSuggestions.contacts) && crmSuggestions.contacts.length ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top contacts</div>
                  <ul className="mt-1 space-y-1">
                    {crmSuggestions.contacts.slice(0, 3).map((ct, idx) => {
                      const name = ct.name || 'Unknown';
                      const relation = ct.relation || '';
                      const phone = ct.phone || '';
                      const email = ct.email || '';
                      const existingList = Array.isArray(crmDetails?.contacts) ? crmDetails.contacts : [];
                      const phoneKey = String(phone || '').replace(/[^0-9]/g, '').replace(/^1/, '');
                      const exists = existingList.some((ex) => {
                        const exPhoneKey = String(ex?.phone || '').replace(/[^0-9]/g, '').replace(/^1/, '');
                        const exEmail = String(ex?.email || '').toLowerCase();
                        return (phoneKey && exPhoneKey && phoneKey === exPhoneKey) || (email && exEmail && email.toLowerCase() === exEmail);
                      });
                      const handleAddContact = () => {
                        if (!caseId) return;
                        const next = [
                          ...existingList,
                          { name, relation, phone, email },
                        ];
                        updateCrm.mutate({ caseId, payload: { contacts: next } });
                      };
                      return (
                        <li key={`${name}-${idx}`} className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-slate-800">{name}</div>
                            <div className="text-xs text-slate-500">{relation || 'associate'}{phone ? ` • ${formatPhone(phone)}` : ''}{email ? ` • ${email}` : ''}</div>
                          </div>
                          <div>
                            <button
                              type="button"
                              onClick={handleAddContact}
                              disabled={exists}
                              className="rounded border border-slate-300 px-2.5 py-1 text-xs hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {exists ? 'Added' : 'Add as contact'}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => goToEnrichment({ view: 'full', rp: 'phone', rpSort: 'value' })}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:border-blue-300 hover:text-blue-700"
                    >
                      View all in Enrichment
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={applyAllMissing}
                  className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                >
                  Apply all missing
                </button>
              </div>
            </>
          )}
        </div>
      </SectionCard>

      {showApplyPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={(e) => { if (e.key === 'Escape') setShowApplyPreview(false); }}>
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowApplyPreview(false)} />
          <div
            className="relative z-10 w-full max-w-md rounded-lg border border-slate-200 bg-white p-4 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="apply-preview-title"
          >
            <div id="apply-preview-title" className="text-sm font-semibold text-slate-800">Apply all missing</div>
            <div className="mt-1 text-xs text-slate-600">Confirm applying the following fields to CRM:</div>
            <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
              {applyPreviewPayload?.phone ? (
                <li>phone: {formatPhone(applyPreviewPayload.phone)} {crmSuggestionSources?.phone ? (<span className="ml-1 align-middle">{renderSourceBadges(crmSuggestionSources.phone)}</span>) : null}</li>
              ) : null}
              {applyPreviewPayload?.email ? (
                <li>email: {applyPreviewPayload.email} {crmSuggestionSources?.email ? (<span className="ml-1 align-middle">{renderSourceBadges(crmSuggestionSources.email)}</span>) : null}</li>
              ) : null}
              {applyPreviewPayload?.address ? (
                <li>address: {formatAddressDisplay(applyPreviewPayload.address)}</li>
              ) : null}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowApplyPreview(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!caseId || !applyPreviewPayload) return;
                  const appliedFields = Object.keys(applyPreviewPayload);
                  updateCrm.mutate(
                    { caseId, payload: applyPreviewPayload },
                    {
                      onSuccess: () => {
                        try {
                          const label = appliedFields.join(', ');
                          pushToast({ variant: 'success', title: 'CRM updated', message: `Applied: ${label}` });
                        } catch {
                          // no-op: toast is best-effort
                        }
                      },
                    }
                  );
                  setShowApplyPreview(false);
                }}
                className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
                autoFocus
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <SectionCard title="Case summary" subtitle="Reference details for this client file">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <DetailItem label="SPN" value={data.spn || data.booking_number || '—'} />
            <DetailItem label="Case number" value={data.case_number || '—'} />
            <DetailItem label="Date of birth" value={(() => {
              const v = data?.dob;
              if (!v) return '—';
              // Accept either MM/DD/YYYY or YYYY-MM-DD and display as MM/DD/YYYY
              if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) return v;
              if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                const [y, m, d] = v.split('-');
                return `${Number(m)}/${Number(d)}/${y}`;
              }
              return String(v);
            })()} />
            <DetailItem label="Status" value={data.status || '—'} />
            <DetailItem label="County" value={data.county || '—'} />
            <DetailItem label="Category" value={data.category || '—'} />
            <DetailItem label="Agency" value={data.agency || '—'} />
            <DetailItem label="Facility" value={data.facility || '—'} />
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
            <DetailItem label="Phones">
              <div className="mt-1 flex flex-wrap gap-2">
                {(() => {
                  const list = [];
                  const seen = new Set();
                  const pushPhone = (val) => {
                    if (!val || typeof val !== 'string') return;
                    const digits = val.replace(/\D/g, '');
                    if (digits.length < 10) return;
                    const key = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
                    if (seen.has(key)) return;
                    seen.add(key);
                    list.push(formatPhone(val));
                  };
                  pushPhone(data?.crm_details?.phone);
                  pushPhone(data?.phone);
                  pushPhone(data?.primary_phone);
                  pushPhone(data?.phone_nbr1);
                  pushPhone(data?.phone_nbr2);
                  pushPhone(data?.phone_nbr3);
                  return list.length
                    ? list.map((p) => (
                        <span key={p} className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{p}</span>
                      ))
                    : <span className="text-slate-500">—</span>;
                })()}
              </div>
              {(data?.phones_source || data?.phones_updated_at) ? (
                <div className="mt-1 text-[11px] text-slate-400">
                  {data?.phones_source ? `Source: ${data.phones_source}` : null}
                  {(data?.phones_source && data?.phones_updated_at) ? ' • ' : ''}
                  {data?.phones_updated_at ? `Updated: ${new Date(data.phones_updated_at).toLocaleString()}` : null}
                </div>
              ) : null}
            </DetailItem>
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
      {/* Quick actions to mirror header actions inside CRM for centralized workflow */}
      <SectionCard title="Quick actions" subtitle="Common actions while working this case">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 sticky top-0 z-20 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60 p-2 border-b border-slate-200 rounded-t-lg">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handlePingNow}
                disabled={triggerPing.isPending}
                className="rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {triggerPing.isPending ? 'Pinging…' : 'Ping now'}
              </button>
              <button
                type="button"
                onClick={handleMessageCase}
                className="rounded-lg border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Message client
              </button>
              <button
                type="button"
                onClick={() => refetch()}
                className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:border-blue-300"
              >
                Refresh
              </button>
            </div>
            {/* CRM sub-nav */}
            <div className="flex flex-wrap items-center gap-2 text-xs" role="tablist" aria-label="CRM sub-views">
              {CRM_VIEWS.map((v) => {
                const badge = (() => {
                  if (v.id === 'checkins') return Array.isArray(caseCheckins) ? caseCheckins.length : 0;
                  if (v.id === 'checklist') return Array.isArray(missingRequiredDocs) ? missingRequiredDocs.length : 0;
                  if (v.id === 'documents') return Array.isArray(attachments) ? attachments.length : 0;
                  if (v.id === 'communications') return Number.isFinite(messageCount) ? messageCount : 0;
                  return 0;
                })();
                return (
                  <button
                    key={v.id}
                    id={`crm-tab-${v.id}`}
                    role="tab"
                    aria-selected={crmPanel === v.id}
                    aria-controls={`crm-panel-${v.id}`}
                    type="button"
                    onClick={() => goCrmPanel(v.id)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300 ${crmPanel === v.id ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
                    title={`Open ${v.label.toLowerCase()} (Alt+${v.shortcut})`}
                  >
                    <span>{v.label}</span>
                    {badge > 0 ? (
                      <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-slate-200 px-1 text-[10px] font-semibold text-slate-700">
                        {badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Keyboard shortcut legend */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-700">⌨️ Keyboard shortcuts:</span> Alt+S (Summary) • Alt+K (Check-ins) • Alt+L (Checklist) • Alt+D (Documents) • Alt+M (Communications)
          </div>
        </div>
      </SectionCard>
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

      {crmPanel === 'summary' ? (
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
              <div className="mt-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-email">
                  Email
                </label>
                <input
                  id="crm-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="e.g., name@example.com"
                  disabled={updateCrm.isPending}
                />
              </div>
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
  ) : null}

      {crmPanel === 'summary' ? (
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
      ) : null}

      {/* CRM sub-views with smooth fade transition */}
      <div
        key={`crm-${crmPanel}`}
        id={`crm-panel-${crmPanel}`}
        role="tabpanel"
        aria-labelledby={`crm-tab-${crmPanel}`}
        tabIndex={0}
        className="animate-fadeIn"
      >
        {crmPanel === 'checkins' ? <CheckinsSection /> : null}
        {crmPanel === 'checklist' ? checklistContent : null}
        {crmPanel === 'documents' ? <DocumentsSection /> : null}
        {crmPanel === 'communications' ? <CommunicationsSection /> : null}
      </div>
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
      <div className="flex items-center justify-end gap-2">
        {enrichmentPanel === 'menu' ? (
          <>
            <button
              type="button"
              onClick={() => goPanel('details')}
              className="rounded-full border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
            >
              Details
            </button>
            <button
              type="button"
              onClick={() => goPanel('full')}
              className="rounded-full border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
            >
              Full results
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => goPanel('menu')}
            className="rounded-full border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
          >
            ← Back to enrichment
          </button>
        )}
      </div>

      {enrichmentPanel === 'menu' ? (
        <>
          <SectionCard
            title={`${providerLabel} enrichment`}
            subtitle="Run a manual lookup to pull possible next-of-kin and contact details."
          >
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-2">
                    {/* Provider dropdown: populated from enrichmentProvidersData.providers */}
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

              {enrichmentInputsExpanded ? (
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
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="wp-dob">
                        Date of birth (optional)
                      </label>
                      <input
                        id="wp-dob"
                        type="date"
                        value={currentEnrichmentInput.dob || ''}
                        onChange={(event) => handleEnrichmentFieldChange('dob', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={runEnrichment.isPending}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="wp-age">
                        Age (optional)
                      </label>
                      <input
                        id="wp-age"
                        type="number"
                        value={currentEnrichmentInput.age || ''}
                        onChange={(event) => handleEnrichmentFieldChange('age', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                        placeholder="e.g., 35"
                        min="0"
                        max="150"
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
                    <button
                      type="button"
                      onClick={() => setEnrichmentInputsExpanded(false)}
                      className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-100"
                    >
                      Hide inputs
                    </button>
                    {!canRunEnrichment ? (
                      <span className="text-xs text-slate-500">
                        You do not have permission to run enrichment for this case.
                      </span>
                    ) : null}
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  {(() => { const isRunning = selectedProviderId === 'pipl' ? piplFirstPull.isPending : runEnrichment.isPending; return (
                  <button
                    type="button"
                    onClick={() => handleRunEnrichment(false)}
                    disabled={!selectedProviderId || !canRunEnrichment || isRunning}
                    className="inline-flex items-center rounded-lg border border-blue-500 bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500"
                  >
                    {isRunning ? 'Running…' : 'Run again'}
                  </button>
                  ); })()}
                  {supportsForce && canForceByRole ? (
                    <button
                      type="button"
                      onClick={handleForceEnrichment}
                      disabled={(selectedProviderId === 'pipl' ? piplFirstPull.isPending : runEnrichment.isPending)}
                      className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Force refresh
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setEnrichmentInputsExpanded(true)}
                    className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-100"
                  >
                    Edit inputs
                  </button>
                  {!canRunEnrichment ? (
                    <span className="text-xs text-slate-500">
                      You do not have permission to run enrichment for this case.
                    </span>
                  ) : null}
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Enrichment results" subtitle="Review matches and attach any relevant contacts">
            {enrichmentRefreshing ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">
                Fetching results…
              </div>
            ) : (!enrichmentDoc && !usingProxyCandidates) ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                Run enrichment to pull candidate matches from {providerLabel}.
              </div>
            ) : (
              <div className="space-y-4">
                {highQualityCandidates.length ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <div className="text-sm font-semibold text-emerald-800">Enrichment success</div>
                    <div className="mt-1 text-xs text-emerald-800">
                      {highQualityCandidates.length} high-quality match{highQualityCandidates.length === 1 ? '' : 'es'} found (≥ {Math.round(HIGH_QUALITY_MATCH * 100)}%).
                    </div>
                    {bestCandidate ? (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-sm text-emerald-900">
                          <div className="font-semibold">{(() => { const n = getCandidateName(bestCandidate); return (!n || n === 'Unknown') ? subjectName : n; })()}</div>
                          <div className="text-xs text-emerald-800">
                            Score {formatScoreDisplay(getCandidateScore(bestCandidate))}
                            {Array.isArray(bestCandidate.contacts) && bestCandidate.contacts.length ? ` • ${bestCandidate.contacts[0]?.value || ''}` : ''}
                            {Array.isArray(bestCandidate.addresses) && bestCandidate.addresses.length ? ` • ${[bestCandidate.addresses[0]?.streetLine1, bestCandidate.addresses[0]?.city, bestCandidate.addresses[0]?.stateCode].filter(Boolean).join(', ')}` : ''}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {bestCandidate?.recordId ? (
                            <button
                              type="button"
                              onClick={() => handleSelectEnrichmentRecord(bestCandidate.recordId)}
                              disabled={!canRunEnrichment || enrichmentSelectedSet.has(bestCandidate.recordId) || selectEnrichment.isPending}
                              className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {enrichmentSelectedSet.has(bestCandidate.recordId) ? 'Attached' : 'Attach best'}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => goPanel('full')}
                            className="rounded-lg border border-emerald-300 bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-200"
                          >
                            Review all results
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {enrichmentDoc && enrichmentDoc.status === 'error' ? (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                    {enrichmentDoc.error?.message || 'Enrichment failed. Try again later.'}
                  </div>
                ) : null}
                {enrichmentSelected.length ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="font-semibold text-slate-700">Attached records</div>
                    <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                      {enrichmentSelected.map((entry) => (
                        <li key={`sel-${entry?.recordId || 'row'}`} className="text-slate-600">
                          {entry?.recordId || '—'}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="space-y-3">
                  {/* Captured inmate details summary */}
                  <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
                    <div className="font-semibold text-slate-800">Captured inmate details</div>
                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Name</div>
                        <div className="mt-0.5 text-sm text-slate-800">{subjectName}</div>
                        <div className="mt-1 text-[11px] text-slate-400">Record: {enrichmentDoc?.id || enrichmentDoc?._id || (usingProxyCandidates ? '—' : '—')}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Phone</div>
                        <div className="mt-0.5 text-sm text-slate-800">{currentSubjectPhone || '—'}</div>
                        {subjectPhones.length > 1 ? (
                          <div className="mt-1 text-[11px] text-slate-400">+{subjectPhones.length - 1} other</div>
                        ) : null}
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Address</div>
                        <div className="mt-0.5 text-sm text-slate-800">{currentSubjectAddress || '—'}</div>
                        {otherAddressesCount > 0 ? (
                          <div className="mt-1 text-[11px] text-slate-400">+{otherAddressesCount} other</div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Summary table for inmate row */}
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
                        <tr className="border-b border-slate-100">
                          <td className="px-3 py-3 align-top">
                            <div className="font-medium text-slate-800">{subjectName}</div>
                            <div className="text-xs text-slate-500">{enrichmentDoc?.id || enrichmentDoc?._id || (usingProxyCandidates ? '—' : '—')}</div>
                          </td>
                          <td className="px-3 py-3 align-top text-xs text-slate-600">
                            {currentSubjectPhone ? (
                              <div>{currentSubjectPhone}{subjectPhones.length > 1 ? ` • +${subjectPhones.length - 1} other` : ''}</div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top text-xs text-slate-600">
                            {currentSubjectAddress ? (
                              <div>{currentSubjectAddress}{otherAddressesCount > 0 ? ` • +${otherAddressesCount} other` : ''}</div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top text-xs text-slate-600">{highQualityRelated.length || '—'}</td>
                          <td className="px-3 py-3 align-top text-right">
                            <button
                              type="button"
                              onClick={() => goPanel('full')}
                              className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                            >
                              View all
                            </button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </SectionCard>
        </>
      ) : enrichmentPanel === 'details' ? (
        <SectionCard title="Enrichment details" subtitle={`Provider: ${providerLabel}`}>
          <div className="space-y-4 text-sm text-slate-700">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last run</div>
                <div>{enrichmentDoc?.requestedAt ? formatRelative(enrichmentDoc.requestedAt) : 'Never'}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Requested by</div>
                <div>{enrichmentDoc?.requestedBy?.email || enrichmentDoc?.requestedBy?.name || '—'}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cache status</div>
                <div>{enrichmentData?.cached ? `Cached • Expires ${enrichmentNextRefresh ? formatRelative(enrichmentNextRefresh) : 'later'}` : 'Live'}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected records</div>
                <div>{enrichmentSelected.length ? enrichmentSelected.map((e) => e.recordId).filter(Boolean).join(', ') : '—'}</div>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current inputs</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div><span className="text-slate-500">First name:</span> {currentEnrichmentInput.firstName || '—'}</div>
                <div><span className="text-slate-500">Last name:</span> {currentEnrichmentInput.lastName || '—'}</div>
                <div><span className="text-slate-500">City:</span> {currentEnrichmentInput.city || '—'}</div>
                <div><span className="text-slate-500">State:</span> {currentEnrichmentInput.stateCode || '—'}</div>
                <div><span className="text-slate-500">Postal:</span> {currentEnrichmentInput.postalCode || '—'}</div>
                <div><span className="text-slate-500">Phone:</span> {currentEnrichmentInput.phone || '—'}</div>
              </div>
            </div>
            {(highQualityRelated.length || highQualityCandidates.length) ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">High-quality matches</div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                  <span>Jump to full results:</span>
                  <button
                    type="button"
                    className="rounded-full border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
                    onClick={() => { const p = new URLSearchParams(searchParams); p.set('view','full'); p.set('cand','all'); setSearchParams(p); setEnrichmentPanel('full'); }}
                  >All</button>
                  <button
                    type="button"
                    className="rounded-full border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
                    onClick={() => { const p = new URLSearchParams(searchParams); p.set('view','full'); p.set('cand','hq'); setSearchParams(p); setEnrichmentPanel('full'); }}
                  >HQ</button>
                  <button
                    type="button"
                    className="rounded-full border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
                    onClick={() => { const p = new URLSearchParams(searchParams); p.set('view','full'); p.set('cand','phone'); setSearchParams(p); setEnrichmentPanel('full'); }}
                  >With phone</button>
                </div>
                <ul className="space-y-2">
                  {(highQualityRelated.length ? highQualityRelated : highQualityCandidates).slice(0, 2).map((c, idx) => {
                    // c may be a relatedParty or a provider candidate
                    const isRelated = Boolean(c?.partyId || c?.lastAudit || c?.relationType);
                    const name = getCandidateName(c);
                    const score = isRelated ? (Number.isFinite(Number(c?.lastAudit?.match)) ? Math.max(0, Math.min(1, Number(c.lastAudit.match))) : null) : getCandidateScore(c);
                    const scoreDisplay = formatScoreDisplay(score);
                    const primaryPhone = isRelated ? (Array.isArray(c?.contacts?.phones) && c.contacts.phones[0]) || null : getPrimaryPhone(c);
                    const primaryEmail = isRelated ? (Array.isArray(c?.contacts?.emails) && c.contacts.emails[0]) || null : getPrimaryEmail(c);
                    const primaryAddress = isRelated ? (Array.isArray(c?.addresses) && c.addresses[0]) || null : formatAddress(Array.isArray(c?.addresses) ? c.addresses[0] : null);
                    const rowKey = c?.recordId || c?.partyId || `${name}-${idx}`;
                    const isSelected = !isRelated && c?.recordId && enrichmentSelectedSet.has(c.recordId);
                    return (
                      <li key={rowKey} className="overflow-hidden rounded-lg border border-emerald-200">
                        <details open>
                          <summary className="flex cursor-pointer list-none items-center justify-between bg-emerald-50 px-3 py-2">
                            <div>
                              <div className="font-semibold text-emerald-900">{name}</div>
                              <div className="text-xs text-emerald-800">Score {scoreDisplay}{c?.recordId ? ` • ${c.recordId}` : ''}{isRelated && (c?.relationLabel || c?.relationType) ? ` • ${(c?.relationLabel || c?.relationType)}` : ''}</div>
                            </div>
                            <div>
                              {!isRelated && c?.recordId ? (
                                <button
                                  type="button"
                                  onClick={() => handleSelectEnrichmentRecord(c.recordId)}
                                  disabled={!canRunEnrichment || selectEnrichment.isPending || (selectingRecordId === c.recordId && selectEnrichment.isPending)}
                                  className={`inline-flex items-center rounded-lg border px-3 py-1 text-xs font-medium transition ${
                                    isSelected ? 'border-emerald-500 bg-white text-emerald-700' : 'border-slate-300 text-slate-600 hover:bg-slate-100'
                                  } disabled:cursor-not-allowed disabled:opacity-60`}
                                >
                                  {selectingRecordId === c.recordId && selectEnrichment.isPending ? 'Saving…' : isSelected ? 'Attached' : 'Attach'}
                                </button>
                              ) : isRelated && (data?.spn || data?.booking_number) && c?.partyId ? (
                                (() => {
                                  const { cooling, eta } = getCooldownInfo(c?.lastAudit);
                                  return (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        if (cooling) return;
                                        relatedPartyPull.mutate({ subjectId: data?.spn || data?.booking_number, partyId: c.partyId, aggressive: relatedAggressive, preferStatewide: preferStatewideParam, force: isAdmin && relatedForce ? true : undefined });
                                      }}
                                      disabled={cooling || relatedPartyPull.isPending}
                                      title={cooling ? `Re-enrich available in ~${eta}` : undefined}
                                      className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {cooling ? `Re-enrich in ${eta}` : 'Re-enrich'}
                                    </button>
                                  );
                                })()
                              ) : null}
                            </div>
                          </summary>
                          <div className="border-t border-emerald-200 bg-white px-3 py-3 text-sm text-slate-700">
                            <div className="grid gap-3 md:grid-cols-3">
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current phone</div>
                                <div>{primaryPhone || '—'}</div>
                                <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">All phones</div>
                                {(!isRelated && Array.isArray(c?.contacts) && c.contacts.length) ? (
                                  <ul className="mt-1 list-disc pl-4 text-xs">
                                    {c.contacts.map((ct, i) => (
                                      <li key={`${rowKey}-ph-${i}`}>{ct.value}{ct.lineType ? ` • ${ct.lineType}` : ''}</li>
                                    ))}
                                  </ul>
                                ) : (isRelated && Array.isArray(c?.contacts?.phones) && c.contacts.phones.length) ? (
                                  <ul className="mt-1 list-disc pl-4 text-xs">
                                    {c.contacts.phones.map((ph, i) => (
                                      <li key={`${rowKey}-ph-${i}`}>{ph}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <div className="text-xs text-slate-400">—</div>
                                )}
                              </div>
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</div>
                                <div>{primaryEmail || '—'}</div>
                                <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Demographics</div>
                                <div className="text-xs text-slate-600">{[c?.ageRange, c?.gender].filter(Boolean).join(' • ') || '—'}</div>
                              </div>
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current address</div>
                                <div>{(isRelated && typeof primaryAddress === 'string') ? primaryAddress : (primaryAddress || '—')}</div>
                                <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">All addresses</div>
                                {Array.isArray(c?.addresses) && c.addresses.length ? (
                                  <ul className="mt-1 list-disc pl-4 text-xs">
                                    {c.addresses.map((a, i) => {
                                      if (isRelated && typeof a === 'string') {
                                        return <li key={`${rowKey}-ad-${i}`}>{a}</li>;
                                      }
                                      const parts = [a?.streetLine1, a?.city, a?.stateCode, a?.postalCode].filter(Boolean).join(', ') || '—';
                                      return <li key={`${rowKey}-ad-${i}`}>{parts}</li>;
                                    })}
                                  </ul>
                                ) : (
                                  <div className="text-xs text-slate-400">—</div>
                                )}
                              </div>
                            </div>
                            {!isRelated && Array.isArray(c?.relations) && c.relations.length ? (
                              <div className="mt-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Relations</div>
                                <ul className="mt-1 grid gap-1 text-xs md:grid-cols-2">
                                  {c.relations.map((rel, i) => (
                                    <li key={`${rowKey}-rel-${i}`}>
                                      {rel.name || 'Unnamed'}{rel.relation ? ` — ${rel.relation}` : ''}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </div>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </SectionCard>
      ) : (
        <SectionCard title="Full enrichment results" subtitle={`Sorted by score • High-quality ≥ ${Math.round(HIGH_QUALITY_MATCH * 100)}%`}>
          {(!enrichmentDoc && !usingProxyCandidates) ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
              Run enrichment to view full results from {providerLabel}.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {(() => {
                  const Chip = ({ id, label, count }) => (
                    <button
                      type="button"
                      onClick={() => setCandidateFilter(id)}
                      className={`rounded-full border px-2 py-0.5 ${candidateFilter === id ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
                      title={`Show ${label.toLowerCase()}`}
                    >
                      {label}: {count}
                    </button>
                  );
                  return (
                    <>
                      <Chip id="all" label="All" count={effectiveCandidates.length} />
                      <Chip id="hq" label="High-quality" count={highQualityCandidates.length} />
                      <Chip id="phone" label="With phone" count={withPhoneCandidates.length} />
                    </>
                  );
                })()}
              </div>
              <div className="overflow-x-auto">
                {(() => {
                  const all = (Array.isArray(effectiveCandidates) ? effectiveCandidates : []);
                  let filtered = all;
                  if (candidateFilter === 'hq') {
                    filtered = all.filter((c) => {
                      const s = getCandidateScore(c);
                      return s != null && s >= HIGH_QUALITY_MATCH;
                    });
                  } else if (candidateFilter === 'phone') {
                    filtered = all.filter((c) => Array.isArray(c?.contacts) && c.contacts.some((ct) => /\d{10}/.test(String(ct?.value || '').replace(/\D/g, ''))));
                  }
                  const withScore = filtered.map((c) => ({ c, s: getCandidateScore(c) }));
                  withScore.sort((a, b) => {
                    const sa = a.s == null ? -1 : a.s;
                    const sb = b.s == null ? -1 : b.s;
                    return sb - sa;
                  });
                  const rows = withScore.map(({ c }, index) => {
                    const rowKey = c?.recordId || `${getCandidateName(c)}-${index}`;
                    const isSelected = c?.recordId && enrichmentSelectedSet.has(c.recordId);
                    const score = getCandidateScore(c);
                    const scoreDisplay = formatScoreDisplay(score);
                    const isHighQuality = score != null && score >= HIGH_QUALITY_MATCH;
                    return (
                      <tr key={rowKey} className={isHighQuality ? 'bg-emerald-50' : ''}>
                        <td className="px-3 py-2 text-xs font-semibold text-slate-700">{scoreDisplay}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800">{getCandidateName(c)}</div>
                          <div className="text-xs text-slate-500">{c?.recordId || '—'}</div>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {Array.isArray(c?.contacts) && c.contacts.length ? (
                            <ul className="space-y-1">{c.contacts.map((ct, i) => <li key={`${rowKey}-ph-${i}`}>{ct.value}{ct.lineType ? ` • ${ct.lineType}` : ''}</li>)}</ul>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {Array.isArray(c?.addresses) && c.addresses.length ? (
                            <ul className="space-y-1">{c.addresses.map((a, i) => <li key={`${rowKey}-ad-${i}`}>{[a.streetLine1, a.city, a.stateCode, a.postalCode].filter(Boolean).join(', ') || '—'}</li>)}</ul>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {c?.recordId ? (
                            <button
                              type="button"
                              onClick={() => handleSelectEnrichmentRecord(c.recordId)}
                              disabled={!canRunEnrichment || selectEnrichment.isPending || (selectingRecordId === c.recordId && selectEnrichment.isPending)}
                              className={`inline-flex items-center rounded-lg border px-3 py-1 text-xs font-medium transition ${
                                isSelected ? 'border-emerald-500 bg-white text-emerald-700' : 'border-slate-300 text-slate-600 hover:bg-slate-100'
                              } disabled:cursor-not-allowed disabled:opacity-60`}
                            >
                              {selectingRecordId === c.recordId && selectEnrichment.isPending ? 'Saving…' : isSelected ? 'Attached' : 'Attach'}
                            </button>
                          ) : <span className="text-xs text-slate-400">No record id</span>}
                        </td>
                      </tr>
                    );
                  });
                  return (
                    <table className="min-w-full table-auto border-collapse text-sm">
                      <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <tr>
                          <th className="px-3 py-2">Score</th>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Phones</th>
                          <th className="px-3 py-2">Addresses</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>{rows}</tbody>
                    </table>
                  );
                })()}
              </div>
              {/* Related parties table (includes low-quality and unscored) */}
              <div className="overflow-x-auto">
                {Array.isArray(relatedParties) && relatedParties.length ? (
                  <>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-500">Filter</span>
                        {(() => {
                          const total = relatedParties.length;
                          const hq = highQualityRelated.length;
                          const withPhone = relatedParties.filter((rp) => Array.isArray(rp?.contacts?.phones) && rp.contacts.phones.length > 0).length;
                          const withEmail = relatedParties.filter((rp) => Array.isArray(rp?.contacts?.emails) && rp.contacts.emails.length > 0).length;
                          const withAddress = relatedParties.filter((rp) => Array.isArray(rp?.addresses) && rp.addresses.length > 0).length;
                          const Chip = ({ id, label, count }) => (
                            <button
                              type="button"
                              onClick={() => setRelatedFilter(id)}
                              className={`rounded-full border px-2 py-0.5 ${relatedFilter === id ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
                              title={`Show ${label.toLowerCase()}`}
                            >
                              {label} {typeof count === 'number' ? `(${count})` : ''}
                            </button>
                          );
                          return (
                            <div className="flex flex-wrap items-center gap-2">
                              <Chip id="all" label="All" count={total} />
                              <Chip id="hq" label="HQ" count={hq} />
                              <Chip id="phone" label="Phone" count={withPhone} />
                              <Chip id="email" label="Email" count={withEmail} />
                              <Chip id="address" label="Address" count={withAddress} />
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {isAdmin && (data?.spn || data?.booking_number) ? (
                          <a
                            href={`/enrichment/providers/pipl/raw?subjectId=${encodeURIComponent(data?.spn || data?.booking_number)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-600 hover:bg-slate-100"
                          >
                            Raw Pipl
                          </a>
                        ) : null}
                        <label className="text-slate-500">Location</label>
                        <select
                          value={relatedLocationPref}
                          onChange={(e) => setRelatedLocationPref(e.target.value)}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700"
                          title="Location preference for related-party search"
                        >
                          <option value="auto">Auto</option>
                          <option value="statewide">Statewide</option>
                          <option value="city_state">City+State</option>
                        </select>
                        <label className="inline-flex items-center gap-1 text-slate-600">
                          <input type="checkbox" checked={relatedAggressive} onChange={(e) => setRelatedAggressive(e.target.checked)} />
                          Aggressive
                        </label>
                        {isAdmin ? (
                          <label className="inline-flex items-center gap-1 text-slate-600" title="Bypass cooldown for targeted pulls (admin)">
                            <input type="checkbox" checked={relatedForce} onChange={(e) => setRelatedForce(e.target.checked)} />
                            Force
                          </label>
                        ) : null}
                        <label className="text-slate-500">Sort by</label>
                      <select
                        value={relatedSort}
                        onChange={(e) => setRelatedSort(e.target.value)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700"
                      >
                        <option value="score">Score</option>
                        <option value="value">Value</option>
                      </select>
                        <span className="text-slate-400" title="Value = net-new phones + emails + addresses from last run">i</span>
                      {(data?.spn || data?.booking_number) && canRunEnrichment ? (
                        <button
                          type="button"
                          onClick={() => validatePartyPhones.mutate({ subjectId: data?.spn || data?.booking_number })}
                          disabled={validatePartyPhones.isPending}
                          className="inline-flex items-center rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                          title="Validate related-party phones via Whitepages"
                        >
                          {validatePartyPhones.isPending ? 'Validating…' : 'Validate phones'}
                        </button>
                      ) : null}
                        {(data?.spn || data?.booking_number) && canRunEnrichment ? (
                          <button
                            type="button"
                            onClick={() => {
                              const subjectId = data?.spn || data?.booking_number;
                              const list = relatedSorted.filter((rp) => {
                                const untilStr = rp?.lastAudit?.cooldownUntil;
                                if (!untilStr) return true;
                                const until = new Date(untilStr).getTime();
                                return !Number.isFinite(until) || until <= Date.now();
                              });
                              if (!list.length) {
                                pushToast({ variant: 'info', title: 'Nothing to re-enrich', message: 'All parties are still cooling down.' });
                                return;
                              }
                              let started = 0;
                              list.forEach((rp) => {
                                if (!rp?.partyId) return;
                                started += 1;
                                relatedPartyPull.mutate({ subjectId, partyId: rp.partyId, aggressive: relatedAggressive, preferStatewide: preferStatewideParam, force: isAdmin && relatedForce ? true : undefined });
                              });
                              pushToast({ variant: 'success', title: 'Re-enrichment queued', message: `Triggered ${started} re-enrich ${started === 1 ? 'run' : 'runs'}.` });
                              setTimeout(() => { if (typeof refetchRelatedParties === 'function') refetchRelatedParties(); }, 1000);
                            }}
                            disabled={relatedPartyPull.isPending}
                            className="inline-flex items-center rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            title="Re-enrich all parties whose cooldown has expired"
                          >
                            Re-enrich available
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {/* Provenance and defaults for related-party search */}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">Assumed country: US</span>
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                        Base location: {(() => {
                          const c = (data?.city || '').trim();
                          const st = (data?.stateCode || data?.state || '').trim();
                          if (c && st) return `${c}, ${st}`;
                          if (st) return st;
                          return '—';
                        })()}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                        Preference: {relatedLocationPref === 'auto' ? 'Auto' : relatedLocationPref === 'statewide' ? 'Statewide' : 'City+State'}
                      </span>
                    </div>
                    <table className="mt-2 min-w-full table-auto border-collapse text-sm">
                    <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Score</th>
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Relation</th>
                        <th className="px-3 py-2">Phones</th>
                        <th className="px-3 py-2">Emails</th>
                        <th className="px-3 py-2">Addresses</th>
                        <th className="px-3 py-2">Accepted</th>
                        <th className="px-3 py-2">Last run</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relatedSorted
                        .map((rp, idx) => {
                          const s = Number.isFinite(Number(rp?.lastAudit?.match)) ? Math.max(0, Math.min(1, Number(rp.lastAudit.match))) : null;
                          const isHQ = s != null && s >= HIGH_QUALITY_MATCH;
                          const scoreDisplay = formatScoreDisplay(s);
                          const phonesCount = Array.isArray(rp?.contacts?.phones) ? rp.contacts.phones.length : 0;
                          const emailsCount = Array.isArray(rp?.contacts?.emails) ? rp.contacts.emails.length : 0;
                          const addressesCount = Array.isArray(rp?.addresses) ? rp.addresses.length : 0;
                          const expanded = !!(rp?.partyId && expandedParties.has(rp.partyId));
                            return (
                            <>
                            <tr key={(rp?.partyId || rp?.name || idx) + ':row'} className={isHQ ? 'bg-emerald-50' : ''}>
                              <td className="px-3 py-2 text-xs font-semibold text-slate-700">{scoreDisplay}</td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  {rp?.partyId ? (
                                    <button
                                      type="button"
                                      onClick={() => toggleExpanded(rp.partyId)}
                                      className="rounded border border-slate-300 px-1 text-[10px] text-slate-600 hover:bg-slate-100"
                                      title={expanded ? 'Hide details' : 'Show details'}
                                    >
                                      {expanded ? '▾' : '▸'}
                                    </button>
                                  ) : null}
                                  <div className="font-medium text-slate-800">{rp?.name || 'Unknown'}</div>
                                </div>
                                <div className="text-xs text-slate-500">{rp?.partyId || '—'}</div>
                              </td>
                              <td className="px-3 py-2 text-xs text-slate-600">{rp?.relationLabel || rp?.relationType || '—'}</td>
                              <td className="px-3 py-2 text-xs text-slate-600">{phonesCount || '—'}</td>
                              <td className="px-3 py-2 text-xs text-slate-600">{emailsCount || '—'}</td>
                              <td className="px-3 py-2 text-xs text-slate-600">{addressesCount || '—'}</td>
                              <td className="px-3 py-2 text-xs text-slate-600">{rp?.lastAudit?.accepted === true ? 'Yes' : rp?.lastAudit?.accepted === false ? 'No' : '—'}</td>
                              <td className="px-3 py-2 text-xs text-slate-600">
                                {rp?.lastAudit?.at ? (
                                  (() => {
                                    const when = formatRelative(rp.lastAudit.at);
                                    const nP = Number.isFinite(Number(rp?.lastAudit?.netNewPhones)) ? Number(rp.lastAudit.netNewPhones) : null;
                                    const nE = Number.isFinite(Number(rp?.lastAudit?.netNewEmails)) ? Number(rp.lastAudit.netNewEmails) : null;
                                    const nA = Number.isFinite(Number(rp?.lastAudit?.netNewAddresses)) ? Number(rp.lastAudit.netNewAddresses) : null;
                                    const deltas = [
                                      nP != null ? `+${nP}p` : null,
                                      nE != null ? `+${nE}e` : null,
                                      nA != null ? `+${nA}a` : null,
                                    ].filter(Boolean).join(' ');
                                    return deltas ? `${when} • ${deltas}` : when;
                                  })()
                                ) : '—'}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {rp?.partyId && (data?.spn || data?.booking_number) ? (
                                  (() => {
                                    const { cooling, eta } = getCooldownInfo(rp?.lastAudit);
                                    return (
                                      <div className="flex flex-wrap items-center justify-end gap-2">
                                        {overrideEditPartyId === rp.partyId && isAdmin ? (
                                          <>
                                            <select
                                              value={overrideType}
                                              onChange={(e) => setOverrideType(e.target.value)}
                                              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                                            >
                                              <option value="">Type</option>
                                              <option value="family">family</option>
                                              <option value="associate">associate</option>
                                              <option value="household">household</option>
                                            </select>
                                            <input
                                              type="text"
                                              value={overrideLabel}
                                              onChange={(e) => setOverrideLabel(e.target.value)}
                                              placeholder="Label"
                                              className="w-28 rounded border border-slate-300 px-2 py-1 text-xs"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => {
                                                if (!(data?.spn || data?.booking_number)) return;
                                                relatedPartyOverride.mutate({
                                                  subjectId: data?.spn || data?.booking_number,
                                                  partyId: rp.partyId,
                                                  relationType: overrideType || undefined,
                                                  relationLabel: (overrideLabel || '').trim() || undefined,
                                                });
                                              }}
                                              disabled={relatedPartyOverride.isPending}
                                              className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                              {relatedPartyOverride.isPending ? 'Saving…' : 'Save'}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => { setOverrideEditPartyId(''); setOverrideType(''); setOverrideLabel(''); }}
                                              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                                            >
                                              Cancel
                                            </button>
                                          </>
                                        ) : (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                if (cooling) return;
                                                relatedPartyPull.mutate({ subjectId: data?.spn || data?.booking_number, partyId: rp.partyId, aggressive: relatedAggressive, preferStatewide: preferStatewideParam, force: isAdmin && relatedForce ? true : undefined });
                                              }}
                                              disabled={cooling || relatedPartyPull.isPending}
                                              title={cooling ? `Re-enrich available in ~${eta}` : undefined}
                                              className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                              {cooling ? `Re-enrich in ${eta}` : 'Re-enrich'}
                                            </button>
                                            {isAdmin ? (
                                              <button
                                                type="button"
                                                onClick={() => { setOverrideEditPartyId(rp.partyId); setOverrideType(rp?.relationType || ''); setOverrideLabel(rp?.relationLabel || ''); }}
                                                className="inline-flex items-center rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                                                title="Override relationship classification"
                                              >
                                                Override
                                              </button>
                                            ) : null}
                                          </>
                                        )}
                                      </div>
                                    );
                                  })()
                                ) : null}
                              </td>
                            </tr>
                            {expanded ? (
                              <tr key={(rp?.partyId || rp?.name || idx) + ':expanded'}>
                                <td colSpan={9} className="bg-slate-50 px-3 py-2 text-xs text-slate-700">
                                  <div className="grid gap-3 md:grid-cols-3">
                                    <div>
                                      <div className="mb-1 font-semibold text-slate-600">Phones</div>
                                      <ul className="space-y-1">
                                        {Array.isArray(rp?.contacts?.phones) && rp.contacts.phones.length ? (
                                          rp.contacts.phones.map((p, i) => (
                                            <li key={p + i} className="flex items-center justify-between gap-2">
                                              <a href={`tel:${String(p).replace(/\D/g,'')}`} className="text-blue-700 hover:underline">{p}</a>
                                              <button type="button" className="rounded border border-slate-300 px-1 text-[10px] text-slate-600 hover:bg-slate-100" onClick={() => navigator.clipboard && navigator.clipboard.writeText(String(p))}>Copy</button>
                                            </li>
                                          ))
                                        ) : (
                                          <li className="text-slate-400">None</li>
                                        )}
                                      </ul>
                                    </div>
                                    <div>
                                      <div className="mb-1 font-semibold text-slate-600">Emails</div>
                                      <ul className="space-y-1">
                                        {Array.isArray(rp?.contacts?.emails) && rp.contacts.emails.length ? (
                                          rp.contacts.emails.map((e, i) => (
                                            <li key={e + i} className="flex items-center justify-between gap-2">
                                              <a href={`mailto:${e}`} className="text-blue-700 hover:underline">{e}</a>
                                              <button type="button" className="rounded border border-slate-300 px-1 text-[10px] text-slate-600 hover:bg-slate-100" onClick={() => navigator.clipboard && navigator.clipboard.writeText(String(e))}>Copy</button>
                                            </li>
                                          ))
                                        ) : (
                                          <li className="text-slate-400">None</li>
                                        )}
                                      </ul>
                                    </div>
                                    <div>
                                      <div className="mb-1 font-semibold text-slate-600">Addresses</div>
                                      <ul className="space-y-1">
                                        {Array.isArray(rp?.addresses) && rp.addresses.length ? (
                                          rp.addresses.map((a, i) => {
                                            const addr = typeof a === 'string' ? a : [a?.streetLine1, a?.city, a?.stateCode, a?.postalCode].filter(Boolean).join(', ');
                                            const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
                                            return (
                                              <li key={addr + i} className="flex items-center justify-between gap-2">
                                                <a href={maps} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{addr || '—'}</a>
                                                <button type="button" className="rounded border border-slate-300 px-1 text-[10px] text-slate-600 hover:bg-slate-100" onClick={() => navigator.clipboard && navigator.clipboard.writeText(String(addr))}>Copy</button>
                                              </li>
                                            );
                                          })
                                        ) : (
                                          <li className="text-slate-400">None</li>
                                        )}
                                      </ul>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                            </>
                          );
                        })}
                    </tbody>
                  </table>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );

  function DocumentsSection() {
    return (
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
  }

  function CheckinsSection() {
    return (
    <SectionCard
      title="Scheduled check-ins"
      subtitle={`${caseCheckins.length} record${caseCheckins.length === 1 ? '' : 's'}`}
    >
      {caseCheckins.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
          No check-ins scheduled for this case yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Due at</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Officer</th>
                <th className="px-4 py-3">GPS</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-sm text-slate-700">
              {caseCheckins.map((checkIn) => (
                <tr key={checkIn.id || checkIn._id}>
                  <td className="px-4 py-3">
                    {checkIn.dueAt ? new Date(checkIn.dueAt).toLocaleString() : '—'}
                    {checkIn.timezone ? (
                      <div className="text-xs text-slate-400">{checkIn.timezone}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                        checkIn.status === 'done'
                          ? 'bg-emerald-50 text-emerald-700'
                          : checkIn.status === 'overdue'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {checkIn.status || 'pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{checkIn.meta?.officerName || '—'}</td>
                  <td className="px-4 py-3">
                    {checkIn.gpsEnabled ? (
                      <div className="space-y-1">
                        <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                          Enabled
                        </span>
                        <div className="text-[11px] text-slate-400">{checkIn.pingsPerDay} ping(s)/day</div>
                        {checkIn.lastPingAt ? (
                          <div className="text-[11px] text-slate-400">
                            Last ping {formatRelative(checkIn.lastPingAt)}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Disabled</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{checkIn.note || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {checkIn.gpsEnabled ? (
                      <button
                        type="button"
                        onClick={() => queuePingForCheckIn(checkIn.id)}
                        disabled={triggerPing.isPending}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {triggerPing.isPending ? 'Pinging…' : 'Ping now'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
    );
  }

  function CommunicationsSection() {
    return (
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
  }

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
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{event.title}</div>
                    {(() => {
                      const d = event?.details;
                      if (d == null) return null;
                      const t = typeof d;
                      if (t === 'string' || t === 'number' || t === 'boolean') {
                        return <div className="text-xs text-slate-500 break-words">{String(d)}</div>;
                      }
                      // Objects/arrays are not valid as React children; show a collapsible JSON block
                      try {
                        return (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-slate-500">Details</summary>
                            <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">{JSON.stringify(d, null, 2)}</pre>
                          </details>
                        );
                      } catch {
                        return <div className="text-xs text-slate-500 break-words">[details]</div>;
                      }
                    })()}
                    {event.actor ? <div className="text-[11px] text-slate-400">By {event.actor}</div> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {isAdmin && event.actionUrl ? (
                      <a
                        href={event.actionUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        title="View raw payload"
                      >
                        View raw
                      </a>
                    ) : null}
                    <div className="text-xs text-slate-500">{formatRelative(event.occurredAt)}</div>
                  </div>
                </div>
              </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );

  let activeContent = overviewContent;
  if (activeTab === 'checkins') activeContent = <CheckinsSection />;
  else if (activeTab === 'checklist') activeContent = checklistContent;
  else if (activeTab === 'crm') activeContent = crmContent;
  else if (activeTab === 'enrichment') activeContent = enrichmentContent;
  else if (activeTab === 'documents') activeContent = <DocumentsSection />;
  else if (activeTab === 'communications') activeContent = <CommunicationsSection />;
  else if (activeTab === 'activity') activeContent = activityContent;

  return (
    <div className="space-y-6">
      <PageHeader
        title={data.full_name || 'Case detail'}
        subtitle={headerSubtitle}
        actions={(
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handlePingNow}
              disabled={triggerPing.isPending}
              className="rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {triggerPing.isPending ? 'Pinging…' : 'Ping now'}
            </button>
            <button
              type="button"
              onClick={handleMessageCase}
              className="rounded-lg border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Message client
            </button>
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

      <div className="flex flex-wrap items-center gap-2">
        {Boolean(data?.needs_attention) && Array.isArray(data?.attention_reasons) && data.attention_reasons.length > 0 ? (
          <div className="mr-2 flex flex-wrap gap-2">
            {data.attention_reasons.map((r) => (
              <span key={`ar-${r}`} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                ⚠ {String(r).replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        ) : null}
        {manualTags.length ? (
          <div className="mr-2 hidden flex-wrap gap-2 sm:flex">
            {manualTags.map((t) => (
              <span key={`mt-${t}`} className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                {t.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div
        className="sticky top-0 z-30 flex flex-wrap gap-2 bg-white/95 p-2 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-b border-slate-200 rounded-t-xl"
        role="tablist"
        aria-label="Case sections"
      >
        {TABS.map((tab) => {
          const badge = (() => {
            if (tab.id === 'crm') return Array.isArray(missingRequiredDocs) ? missingRequiredDocs.length : 0;
            if (tab.id === 'activity') return Number.isFinite(activityCount) ? activityCount : 0;
            if (tab.id === 'enrichment') return Array.isArray(highQualityRelated) ? highQualityRelated.length : 0;
            return 0;
          })();
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1 rounded-full px-4 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-300 ${
                activeTab === tab.id ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              title={`${tab.label}`}
            >
              <span>{tab.label}</span>
              {badge > 0 ? (
                <span className={`inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                  activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                }`}>
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`} tabIndex={0}>
        {activeContent}
      </div>
    </div>
  );
}

function StatTile({ label, value, hint, onClick }) {
  const interactive = typeof onClick === 'function';
  const base = 'rounded-xl border border-slate-200 p-4 shadow-sm';
  const cls = interactive
    ? `${base} bg-white hover:bg-slate-50 cursor-pointer transition` 
    : `${base} bg-white`;
  const handleKey = (e) => {
    if (!interactive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <div className={cls} onClick={onClick} role={interactive ? 'button' : undefined} tabIndex={interactive ? 0 : undefined} onKeyDown={handleKey}>
      <div className="flex items-start justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        {interactive ? <span className="text-slate-300 text-sm" aria-hidden>›</span> : null}
      </div>
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
