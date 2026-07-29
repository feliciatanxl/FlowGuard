# Backend test cases - Felicia

Felicia's 25 Jest files account for **315 passing assertions** in the verified full server run. The repository total is **36/36 suites and 501/501 tests passed** (28 July 2026). The full command runs six bounded Jest processes because a single large Windows Node/Jest process can terminate natively before reporting; no suite is omitted.

| Area | Current cases/evidence | Expected result |
|---|---|---|
| Authentication/RBAC | Missing/invalid JWT, DB-authoritative role/active/tokenVersion, role gates, account security, rate limits, CORS. The reset test uses a deterministic limiter key reset rather than a short real-time sleep. | 401 missing, 403 invalid/wrong role/suspended, current DB state overrides token claims, 429 safely shaped. |
| Manual users | FM creates Tenant; Tenant creates own Staff; tampered roles rejected; unique/validation errors. | 201 safe user DTO; no hash; 400/403 as applicable. |
| Enrolment/privacy | Three images required; AI vector stored; cache refresh; self/FM/Tenant-own-Staff permissions; image non-persistence. | `faceVector`/`isEnrolled` update; 400/403/404/502/503 paths. |
| Tracking/recognition | Side-effect-free `/track`; authoritative recognised/unknown/stale/suspended behavior; timings and safe DTO. | No identity/DB write from track; recognition writes only defined audit cases. |
| Liveness/access audit | Attendance and V-Patrol events only after final policy; denied reasons/field whitelist/dedup. | No attendance on denied or V-Patrol; server-owned audit metadata. |
| Attendance | Role-scoped reads; SG-day window; IN/OUT/update; inactive/un-enrolled/unknown. | Correct scoped result and 400/403/404/500 paths. |
| Security review | Authenticated log reads; FM review status/notes; ownership checks. | Valid updates persist reviewer/time; wrong role/target fails. |
| Evaluation participants | Stable labels, sync/list, eligibility, off-boarding retirement. | Vector never returned; label stays reserved. |
| Booking CRUD | Create/list/edit/status/cancel; Tenant/Staff ownership; required/phone validation; SG conversion; overlap 409. | Correct scoped rows and status-based cancellation. |
| Driver Pass | Public safe DTO/link, no-store behavior, no private fields. | 200 safe fields or 404. |
| QR proxy | FM auth, data URL/size validation, private AI headers, candidate-only response, unavailable fallback. | 400/401/403/413/429/503; no booking mutation. |
| Gate verification | Status/time/plate decisions, transaction/row lock behavior, GateAccessLog, fail-closed audit, override reason/allowlist, idempotency, next driver. | Stable reason codes; repeat transition does not resend; manual override audited. |
| WhatsApp | Real/mock-safe config, phone masking/normalisation, Driver Pass links, message events, non-fatal failure. | Booking/gate operation succeeds even if messaging fails. |
| AI/YOLO proxy shared boundary | Google ID token audience/cache, service-key headers, raster data-URL/8 MiB validation, positive optional camera/zone IDs, and field allowlisting. | Browser cannot bypass Node to private FastAPI; malformed/non-raster payloads never reach AI. |

Runner note: Jest still prints its `--forceExit` advisory for each bounded child. Direct repeated single-process combinations remain host-sensitive on Node 24/Windows; the checked-in full runner preserved all tests and passed three consecutive final runs. The rate-limit file itself passed all 16 assertions three consecutive times after numeric headroom checks stopped opening hundreds of unnecessary HTTP sockets.
