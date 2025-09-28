# Check-ins Integration Plan

_Last updated: 2025-01-15_

## 1. Goals
- Replace the legacy check-in screens with the Figma-generated components while keeping existing case relationships intact.
- Support scheduled in-person check-ins, attendance logging, and reminder workflows.
- Introduce GPS ping support (2–3 times per day) for clients who consent as part of bond acceptance.
- Ensure auditability (attendance, location pings, notifications) for SOC2 / evidentiary requirements.

## 2. Current State Summary
- Existing `/check-ins` route renders basic tables but relies on mock data.
- API has partial endpoints under `server/src/routes/checkins.js` but lacks GPS support and reminder scaffolding.
- No centralized job queue for recurring tasks (reminders, GPS pings).

## 3. Feature Work Breakdown

### 3.1 Frontend Wiring
1. **Component inventory:** map each generated component/page to new routes (`src/pages/CheckIns.jsx`, detail drawers, create/edit modals).
2. **React Query hooks:** add `useCheckIns`, `useCheckInDetail`, `useCreateCheckIn`, `useUpdateCheckIn`, `useCheckInAttendance`.
3. **List view:**
   - Filters (status, officer, date range, client name).
   - Summary cards (Upcoming / Overdue / GPS-enabled clients).
   - Bulk actions placeholders (notify, export).
4. **Detail view:**
   - Timeline of attendance + GPS pings (map component using last known coordinates).
   - Quick actions (mark attended/missed, trigger manual ping, reschedule).
   - Audit tab showing change log.
5. **Modal forms:** create/edit check-in (date/time, timezone, assigned officer, location, notes, reminder toggles).
6. **Client consent messaging:** display GPS consent status with link to signed agreement.
7. **Integration touches:** update navigation badges, notifications (toast) behaviour, link from `CaseDetail` to check-ins.

### 3.2 Backend/API Tasks
1. **Schema updates:**
   - `CheckIn` model: add fields `timezone`, `remindersEnabled`, `gpsEnabled`, `scheduledPingsPerDay`, `lastPingAt`.
   - New `CheckInPingLog` collection storing `{ checkInId, clientId, scheduledFor, responseAt, location, status }`.
   - Client/Bond schema: `gpsConsentAt`, `gpsConsentMethod`, `deviceToken` (if using push) or `phoneNumber`.
2. **Routes:**
   - `GET /api/checkins` with filters, pagination.
   - `POST /api/checkins` (create) and `PUT /api/checkins/:id` (edit).
   - `POST /api/checkins/:id/attendance` (mark attended/missed with optional location + notes).
   - `POST /api/checkins/:id/pings/manual` (trigger manual ping).
   - `GET /api/checkins/:id/audit` and `/pings` endpoints for detail view.
3. **Permissions:** ensure `billing:*` or `officer:*` roles can manage; clients have limited read-only endpoints.

### 3.3 GPS Ping Service
1. **Scheduling:**
   - Use Bull/BullMQ or equivalent job queue (Redis-backed).
   - On check-in creation (gpsEnabled), enqueue daily jobs at configured times (default 08:00, 13:00, 19:00 client timezone).
   - Respect geofence windows (§3.7) by aligning ping times with expected safe-zone arrival.
2. **Ping execution:**
   - Primary channel: push/SMS deep link to lightweight web page requesting GPS + optional selfie for verification.
   - Record log entry with `status` (`queued`, `sent`, `acknowledged`, `missed`, `failed`), `responseAt`, and location.
   - Escalate to officer if two consecutive pings are missed; optionally trigger IVR call (see voice biometrics).
3. **Client experience:**
   - Provide mobile-friendly confirmation flow with consent text, location preview, ability to request short delay.
   - Store explicit consent at bond acceptance; capture device identifier.
4. **Hardware tracker integration:** API must accept pings from dedicated trackers (§3.8) and merge them with mobile pings.

### 3.4 Notifications & Reminders
1. Hook into messaging provider (Twilio/SendGrid) once selected.
2. Templates: reminder email/SMS, missed check-in alert, manual ping instructions.
3. UI toggles per client / per check-in for reminder cadence.
4. Logging: each notification -> audit trail (timestamp, channel, delivery status).

### 3.5 Audit & Compliance
1. Ensure all check-in changes go through audit middleware (user, timestamp, diff).
2. GPS consent logging: captured during bond acceptance form (store doc reference + timestamp).
3. Data retention guidelines: define TTL for `CheckInPingLog` (e.g., 1 year) and provide export endpoint.
4. SOC2 evidence: update `Schema_Authentication.md` with GPS consent and check-in policies.

### 3.6 Testing Plan
- **Unit tests:** form validation, scheduling utils, GPS job handlers, attendance endpoint.
- **Integration tests:** create/edit check-in, mark attendance, manual ping, reminder queue.
- **QA checklist:**
  1. Create check-in with reminders & GPS.
  2. Simulate attendance (success + missed).
  3. Validate pings logged 3 times per day.
  4. Verify notifications and audit entries.
  5. Confirm consent details visible in UI.

### 3.7 Smart Check-In Channels
To make supervision more flexible while keeping a strong audit trail, support additional check-in modalities:

1. **Geofenced safe zones**
   - Admins define zones (home, work, courthouse) with radius or polygon.
   - If device dwells inside zone during a scheduled window, system auto-marks “present” pending officer review.
   - Requires mobile app background location or frequent GPS pings; configurable dwell time & accuracy thresholds.
   - Must log coordinates, accuracy, and auto-mark reason for SOC2.

2. **Voice biometric call-in**
   - Toll-free IVR call, client speaks passphrase, voiceprint matches stored profile.
   - Use provider (e.g., Twilio Voice + voice-match) with fallback to live agent if verification fails twice.
   - Stores audio snippet or hashed voiceprint per compliance requirements.

3. **QR / kiosk confirmation**
   - Rotating QR codes (5 min TTL) displayed by officers or kiosks; client scans via app or enters numeric code.
   - Records device ID, geo, and optional selfie; kiosk mode uses case number + PIN.

4. **Smart SMS scripts (ties to Messaging)**
   - Conversational flows: “Reply 1 when you arrive”, “Send photo if requested”, “Need help? Reply HELP”.
   - Integrates with messaging provider; transcripts stored in `checkinLogs` and surfaced in messaging module.

5. **Wearable / vehicle GPS trackers**
   - Issue BLE/GPS devices (AirTag-style or OBD-II trackers) for clients who consent.
   - Provisioning workflow to pair device ID; ingest vendor webhooks into `CheckInPing` stream.
   - Battery/tamper alerts with escalation; inventory management in admin UI.

### 3.8 Hardware & Device Support (Future Pilot)
- Select vendor(s) for trackers; document API/webhook requirements.
- Maintain registry of device assignments, activation/deactivation history.
- Provide dashboards for device health (battery, last ping).
- Ensure removal/deletion workflow once bond terminates.

## 4. Dependencies & Open Questions
- Messaging provider decision (Twilio vs SendGrid/SMS alternative).
- Push vs SMS for GPS pings; need or availability of client mobile app.
- Infrastructure for job queue (Redis) in production.
- Legal review of GPS consent language and data retention.

## 5. Next Steps
1. Review generated check-in components and map to routes (list attached to this doc once inventoried).
2. Confirm messaging provider + queue infrastructure with ops.
3. Begin backend schema/route work in parallel with frontend wiring.

## 6. Progress Log
- **2025-01-15:** Established baseline plan, created reusable UI primitives (`CheckInSummary`, `CheckInFilters`, `CheckInList`, `CheckInDetailDrawer`, `CheckInFormModal`) and updated `src/pages/CheckIns.jsx` to use new components with enhanced filtering skeletons; expanded hooks (`useCheckins`, detail/create/update/ping stubs) ahead of API work.
- **2025-01-15:** Extended `CheckIn` schema (timezone, officer, reminders, GPS), added `CheckInPing` model, upgraded `/api/checkins` filters & stats, and introduced new detail/timeline/create/update/manual-ping endpoints.
- **2025-01-15:** Added roadmap for geofenced auto check-ins, voice biometrics, QR/kiosk scans, smart SMS workflows, and hardware tracker integration.
