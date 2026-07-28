---
name: booking-time-contract
description: Smart Logistics booking timezone contract + Driver Pass live refresh — canonical Singapore-time handling
metadata: 
  node_type: memory
  type: project
  originSessionId: 13e8dd41-7798-49f5-86c7-1949a10a588c
  modified: 2026-07-27T11:21:37.998Z
---

Smart-Logistics booking times use ONE canonical contract (added 2026-07-27, branch feature/facial-smart-logistics). Relates to [[flowguard-felicia-scope]] and [[gate-verification-feature]].

**Contract:** user enters Singapore WALL-CLOCK time → API stores/returns absolute UTC ISO → every UI/WhatsApp display formats explicitly in `Asia/Singapore`. Singapore is a fixed +08:00 (no DST since 1982), so wall-clock⇄instant uses a constant offset; display uses `Intl` with explicit `timeZone`. Never depends on browser OS TZ or Node/Cloud-Run TZ.

**Root cause of the old +8h bug:** frontend sent the timezone-less `datetime-local` string raw; Sequelize DATE coerced it via `new Date("2026-07-27T18:01")` = host-local (UTC on Cloud Run); display formatters omitted `timeZone`, so a SG browser re-shifted it. On a SG laptop both halves cancel → **the bug ONLY reproduces under TZ=UTC** (run tests with `TZ=UTC`, else it hides).

**Single source of truth (don't re-implement per component):**
- Server: `server/utils/bookingDateTime.js` — `parseBookingDateTime`, `normalizeSlots` (used in POST /create + PATCH /:id before validation/conflict/create/update), `formatSingaporeDateTime`, `formatSingaporeTime` (used by whatsappService).
- Client: `client/src/constants/datetime.js` — `singaporeLocalInputToIso`, `isoToSingaporeLocalInput`, `formatSingaporeBookingDateTime`, `singaporeDateKey` (used by TenantLogistics, DriverPass, GateVerification).

**Logistics default filter (added 2026-07-27):** `TenantLogistics` date filter defaults to `getSingaporeTodayDateKey()` (in `client/src/constants/datetime.js`) so FMs see today's bookings on mount/remount; an "All dates" toggle (`setFilterDate('')`, `.logistics-alldates`, aria-pressed) shows full history. The "Today's Bookings" card uses the same helper and never changes with the selected filter. **Test gotcha:** any test rendering TenantLogistics with a fixed-date fixture must click the "All dates" button (or the row is hidden by the today default) — this bit LogisticsEdit/LogisticsTimezone/Logistics tests. Pin "today" in component tests by partially mocking `getSingaporeTodayDateKey`.

**How to apply:**
- Public `GET /api/bookings/:ref` sends no-store headers and DriverPass polls (~12s) + refreshes on focus/visibility with `fetch(..., {cache:"no-store"})`; guards: aliveRef/inFlightRef/stoppedRef, no full-page loader on background refresh, stop polling on 404.
- Editing a booking does NOT send WhatsApp (only status/cancel/gate routes do) — preserved.
- Existing rows stored before the fix stay wrong until edited/recreated; NO bulk migration (system can't know intent). Gate timing (`checkArrivalWindow`) already compares absolute instants — left untouched.
