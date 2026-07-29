---
name: gate-verification-feature
description: "Dual-mode loading-bay gate verification — architecture decisions, test-running gotchas, baseline failures"
metadata: 
  node_type: memory
  type: project
  originSessionId: b0afa665-0222-4e77-9d0d-360dd6ae45a7
  modified: 2026-07-27T07:28:50.593Z
---

Smart-Logistics dual-mode gate verification (added 2026-07-27, branch feature/facial-smart-logistics). Relates to [[flowguard-felicia-scope]].

**Two gate routes coexist by design:**
- Canonical/new: `POST /api/bookings/gate-verification` (FM-only) → stateless `server/services/gateVerification.js`. Strict rules: entry needs Confirmed, plate mismatch DENIES, env arrival window (`GATE_EARLY_MINUTES`/`GATE_LATE_MINUTES`), manual override (FM + reason, reviewable codes only), returns `{access, reasonCode, ...}`. Row-locked transaction + audit to `GateAccessLog`; fails CLOSED if a granted decision can't be audited.
- Legacy: `PATCH /api/bookings/:ref/gate-scan` — LEFT UNCHANGED for back-compat (its old tests assert warn-only plate mismatch + Pending→Arrived). Do NOT make it delegate to the strict service; that breaks those tests. Target the new route for future work.

**How to apply:**
- `GateAccessLog` (`server/models/GateAccessLog.js`, table `gate_access_logs`) is auto-created by the per-model `sequelize.sync({alter:false})` in `server/index.js` — NO manual migration needed. All columns nullable/defaulted. Never sets DB_SYNC_ALTER.
- Plate normalisation is duplicated per bundle: `server/utils/plate.js` + `client/src/utils/plate.js` (client/server can't share). QR/OCR: `client/src/utils/gateCamera.js` (@zxing/browser, dynamic import) + `client/src/utils/plateOcr.js` (tesseract.js, dynamic import → lazy chunk). Deps added: `@zxing/browser`, `@zxing/library`, `tesseract.js`. OCR is PoC, not production LPR; barrier opening is simulated.
- FM-only page `client/src/pages/GateVerification.jsx` at route `/logistics/gate-verification` (ACCESS.FM_ONLY). The Logistics "Gate Scan" button now navigates there (was a modal) — adding `useNavigate` to TenantLogistics means any test rendering it must wrap in `<MemoryRouter>`.

**Test-running gotchas:**
- `cd server && npm test` HANGS — teammates' suites need a real Postgres/Python AI service. Run Felicia's scope instead: `npx jest "Tan Xiu Li, Felicia" --runInBand --forceExit --testTimeout=20000` (250 tests, all green).
- Pre-existing BASELINE frontend failures (untouched sources — do NOT chase): `ScanControl.test.jsx` (capture width + JPEG quality 0.74 vs ≤0.70), `ScannerPerformance.test.jsx` (JPEG quality), `UserManagement.test.jsx` (self-tag count). Everything else in Felicia's frontend scope passes.
