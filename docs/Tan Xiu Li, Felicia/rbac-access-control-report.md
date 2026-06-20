# RBAC Access-Control Report — FlowGuard

**Branch:** `feature/facial-recognition-access`
**Scope:** Dashboard/route access control for roles. No teammate module *logic* was rewritten;
only route wrappers, sidebar visibility, shared auth middleware, and tests were changed.
**Date:** 2026-06-21

---

## A. Summary of RBAC changes

1. **Roles normalised into constants.** New `client/src/constants/roles.js` (`ROLES`, `ACCESS`
   groups, `roleLabel`) and `ROLES` + `requireRole()` exported from `server/middlewares/auth.js`.
   Canonical values are **`FM` / `Staff` / `Tenant`** everywhere (matches the DB ENUM and the
   value `Login.jsx` stores) — no `Admin` / `Security` / `Client` aliases exist.
2. **Frontend route wrappers corrected** in `App.jsx`: live-monitoring pages locked to FM+Staff,
   admin/settings to FM-only, attendance/logistics/own-staff to FM+Tenant, and the previously
   **public** `/cameras`, `/object-detection`, `/logistics` are now authenticated.
3. **Sidebar visibility aligned to the route rules** so no role sees a link that would only
   bounce it to 403.
4. **Backend gap closed:** `GET /user/logs/:id` was readable by any logged-in user → now FM-only
   via the new reusable `requireRole('FM')` middleware.
5. **Tests added** (frontend RBAC + backend middleware) and **honest risk list** for the
   teammate-owned API routes that are still unprotected (not changed, to avoid breaking them).

---

## B. Role definitions

| Role | Meaning | Access summary |
|------|---------|----------------|
| **FM** (Facilities Manager) | Highest internal access | Everything: global dashboard, all monitoring, user/tenant/staff admin, facial enrolment, security review, settings, logs. |
| **Staff** (Security) | Operational monitoring | Live monitoring (Cameras, V-Patrol, Object Detection), Gate Scanner. **No** user/tenant admin, **no** settings, **no** destructive admin config. |
| **Tenant** | Own unit only | Tenant dashboard, own attendance, own logistics, own staff. **No** global CCTV/V-Patrol, **no** admin, **no** other tenants' data. |
| **Public** | Unauthenticated | Landing, mission/tech/roadmap, contact, login, register, forgot-password, driver pass/portal. **No** dashboard routes. |

---

## C. Frontend route access matrix

| Route | Page | Public | FM | Staff | Tenant | Notes |
|-------|------|:--:|:--:|:--:|:--:|-------|
| `/` | Home | ✅ | ✅ | ✅ | ✅ | Landing |
| `/innovation` | AIInnovation | ✅ | ✅ | ✅ | ✅ | Marketing |
| `/contact` | Contact | ✅ | ✅ | ✅ | ✅ | |
| `/system-health` | SystemHealth | ✅ | ✅ | ✅ | ✅ | Public status page (see risks) |
| `/login` `/register` `/forgot-password` | Auth | ✅ | ✅ | ✅ | ✅ | |
| `/driver-pass/:id` | DriverPass | ✅ | – | – | – | Driver special (QR) |
| `/driver-portal` | DriverPortal | ✅ | – | – | – | Driver special |
| `/error/400\|401\|403\|500` | SystemError | ✅ | ✅ | ✅ | ✅ | Error pages |
| `*` | NotFound | ✅ | ✅ | ✅ | ✅ | |
| `/dashboard` | Dashboard | ❌ | ✅ | ✅ | ✅ | Content adapts by role |
| `/enrollment` | FaceEnrollment | ❌ | ✅ | ✅ | ✅ | Self-enrol own face |
| `/cameras` | Cameras | ❌ | ✅ | ✅ | ❌ | Live monitoring |
| `/object-detection` | ObjectDetection | ❌ | ✅ | ✅ | ❌ | Live monitoring |
| `/vpatrol` | VPatrol | ❌ | ✅ | ✅ | ❌ | Security command centre |
| `/gate-scanner` | GateScanner | ❌ | ✅ | ✅ | ❌ | Operational kiosk |
| `/attendance` | Attendance | ❌ | ✅ | ❌ | ✅ | Tenant sees own staff (backend-filtered) |
| `/staff` | StaffManagement | ❌ | ✅ | ❌ | ✅ | Tenant's own staff |
| `/logistics` | TenantLogistics | ❌ | ✅ | ❌ | ✅ | Tenant logistics |
| `/users` | Users | ❌ | ✅ | ❌ | ❌ | User admin |
| `/security-review` | SecurityReview | ❌ | ✅ | ❌ | ❌ | FM manual review |
| `/tenant-management` | TenantManagement | ❌ | ✅ | ❌ | ❌ | Tenant onboarding |
| `/user-logs/:id` | UserLogs | ❌ | ✅ | ❌ | ❌ | Personnel logs |
| `/settings` | Settings | ❌ | ✅ | ❌ | ❌ | System config + Danger Zone |

> **Changed this pass:** `/cameras`, `/object-detection`, `/logistics` (public → protected);
> `/vpatrol`, `/gate-scanner` (now FM+Staff); `/settings` (any-auth → FM-only).

---

## D. Backend API access matrix

🟢 = enforced in code · 🟡 = enforced but note · 🔴 = **NOT enforced** (teammate-owned, documented risk)

| API Route | Public | FM | Staff | Tenant | Status | Notes |
|-----------|:--:|:--:|:--:|:--:|:--:|-------|
| `POST /user/register` | ✅ | ✅ | ✅ | ✅ | 🟢 | reCAPTCHA; FM self-register blocked |
| `POST /user/login` | ✅ | ✅ | ✅ | ✅ | 🟢 | |
| `POST /user/invite-tenant` | ❌ | ✅ | ❌ | ❌ | 🟢 | inline FM check |
| `PUT /user/generate-code` | ❌ | ❌ | ❌ | ✅ | 🟢 | Tenant only |
| `GET /user/my-code`, `/my-staff` | ❌ | ✅ | ✅ | ✅ | 🟢 | Caller's own data |
| `GET /user/` (list) | ❌ | ✅ | ❌ | ❌ | 🟢 | inline FM check |
| `PUT /user/suspend/:id` | ❌ | ✅ | ❌ | ❌ | 🟢 | inline FM check |
| `GET /user/logs/:id` | ❌ | ✅ | ❌ | ❌ | 🟢 | **FIXED** → `requireRole('FM')` |
| `DELETE /user/:id` | ❌ | ✅ | ❌ | ◑ | 🟢 | FM, or Tenant deleting own staff |
| `POST /user/enroll-face` | ❌ | ✅ | ✅ | ✅ | 🟢 | self, or FM for others |
| `* /api/security/*` | ❌ | ✅ | ✅ | ✅ | 🟢 | JWT router-wide |
| `PATCH /api/security/logs/:id/review` | ❌ | ✅ | ❌ | ❌ | 🟢 | inline FM check |
| `GET /api/attendance/logs` | ❌ | ✅ | ❌ | ✅ | 🟢 | Staff denied; Tenant scoped to own staff |
| `POST /api/attendance/scan` | ✅ | – | – | – | 🟡 | Public **by design** (camera kiosk); no PII in/out |
| `GET /api/bookings/:ref` | ✅ | – | – | – | 🟡 | Public **by design** (driver portal) |
| `POST /api/bookings/create`, `GET /api/bookings/all` | ✅ | – | – | – | 🔴 | Teammate (logistics) — no auth |
| `GET/POST/DELETE /api/incident/*` | ✅ | – | – | – | 🔴 | Teammate (incident) — no auth |
| `GET/POST/PUT /api/detection-alerts` | ✅ | – | – | – | 🔴 | Teammate (object-detection); POST used by Python AI |
| `GET/POST/PUT/DELETE /api/zones` | ✅ | – | – | – | 🔴 | Teammate (object-detection) — no auth |

---

## E. Sidebar / menu visibility rules

`Sidebar.jsx` now mirrors the route matrix (so links never lead to a 403):

| Link | FM | Staff | Tenant |
|------|:--:|:--:|:--:|
| Dashboard | ✅ | ✅ | ✅ |
| Cameras / V-Patrol / Object Detection / Gate Scanner | ✅ | ✅ | ❌ |
| Daily Attendance | ✅ | ❌ | ✅ |
| Logistics & Bays | ✅ | ❌ | ✅ |
| My Staff | ❌ | ❌ | ✅ |
| User Management / Security Review / Tenant Onboarding / Settings | ✅ | ❌ | ❌ |

The "Launch Gate Terminal" button on the Attendance page is now FM-only (Tenants viewing
attendance can no longer reach the FM/Staff gate kiosk).

---

## F. 401 vs 403 behaviour

- **401 (not logged in):** No `accessToken` in localStorage → `ProtectedRoute` redirects to
  `/error/401` ("Authentication Required", link back to login). Backend returns `401` when no/
  invalid JWT is supplied.
- **403 (logged in, wrong role):** Valid token but role not in the route's allow-list →
  `ProtectedRoute` redirects to `/error/403` ("Clearance Denied"). Backend `requireRole` /
  inline checks return `403`.
- A genuine FM will **not** see 403 on FM pages: the stored `userRole` is the canonical `FM`
  string from login, compared against the same constant — no alias mismatch exists.

---

## G. Manual test checklist

**Logged out**
- [ ] Visit `/dashboard`, `/vpatrol`, `/users`, `/settings` directly → each redirects to `/error/401`.
- [ ] Public pages (`/`, `/login`, `/contact`, `/driver-portal`) load normally.

**FM** (`admin@harrison.com` / seeded)
- [ ] Sidebar shows all sections incl. User Management, Security Review, Tenant Onboarding, Settings.
- [ ] Can open every protected route without a 403.

**Staff**
- [ ] Sidebar shows Cameras, V-Patrol, Object Detection, Gate Scanner — but **not** admin/settings/My Staff.
- [ ] Direct-URL `/users`, `/settings`, `/tenant-management` → `/error/403`.
- [ ] `/vpatrol`, `/gate-scanner` open fine.

**Tenant**
- [ ] Sidebar shows Dashboard, Daily Attendance, Logistics & Bays, My Staff only.
- [ ] Direct-URL `/vpatrol`, `/cameras`, `/users`, `/security-review` → `/error/403`.
- [ ] `/attendance`, `/staff`, `/logistics` open; attendance shows only own staff.

**Direct URL access** — repeat the above by typing URLs (not just clicking links).
**Sidebar visibility** — confirm hidden links match the table in §E for each role.

---

## H. Tests added / updated

**Frontend (Vitest) — `client/tests/Tan Xiu Li, Felicia/`**
- `RBAC.test.jsx` (**new**, 10 tests): unauth→401, Tenant/Staff→403 on FM-only, FM allowed,
  Staff allowed on FM+Staff, Tenant blocked from FM+Staff, Tenant allowed on FM+Tenant, and
  Sidebar link visibility for FM / Staff / Tenant.
- `ProtectedRoute.test.jsx` (existing, 5 tests): allow-list logic.
- `FaceEnrollment.test.jsx` (existing, 5 tests).

**Backend (Jest) — `server/tests/`**
- `Tan Xiu Li, Felicia/rbac.test.js` (**new**, 6 tests): `requireRole` 401/403/200 across FM-only
  and FM+Staff gates.
- `Tan Xiu Li, Felicia/security.test.js` (8), `user.test.js` (3) — unchanged, still pass.

---

## I. Commands run and results

```
cd server && npx jest      → Test Suites: 3 passed · Tests: 17 passed ✅
cd client && npx vitest run → Test Files: 4 passed · Tests: 23 passed ✅
cd client && npx vite build → ✓ built (149 modules) ✅
```

---

## J. Remaining risks / not implemented yet

1. **Teammate backend routes are unauthenticated** (🔴 in §D): `/api/incident/*`, `/api/zones/*`,
   `/api/detection-alerts` (GET/PUT), `/api/bookings/create` + `/all`. These are owned by other
   modules and were **intentionally not changed** to avoid breaking their demos. Recommended fix:
   add `verifyToken` + `requireRole('FM','Staff')` (and a service key for the AI's
   `POST /api/detection-alerts`). **Until then, those APIs are reachable without a login.**
2. **Tenant data isolation is only partial.** `/api/attendance/logs` genuinely scopes a Tenant to
   their own staff (server-side `where managerId`). But the **Dashboard tenant view uses hardcoded
   mock numbers**, and `/logistics` / `/staff` pages are role-gated at the route level only — true
   per-tenant row filtering for logistics is **not fully implemented**. Do not claim full tenant
   isolation in the demo.
3. **`POST /api/attendance/scan` is public by design** (camera kiosk). Acceptable for the PoC but
   should use a device/service token in production.
4. **`/system-health` left public.** It currently shows non-sensitive status; protect it if it
   later exposes infrastructure detail.
5. **No token-refresh / expiry UX.** Expired JWT → next API call 401/403; the SPA does not
   proactively redirect mid-session until a guarded navigation occurs.

---

## K. Suggested git commit message

```
feat(rbac): normalize roles, fix route/sidebar/API access control

- add ROLES/ACCESS constants (client) + requireRole middleware + ROLES (server)
- App.jsx: lock cameras/object-detection/vpatrol/gate-scanner to FM+Staff,
  attendance/staff/logistics to FM+Tenant, users/security-review/tenant-mgmt/
  user-logs/settings to FM-only; make previously-public pages authenticated
- Sidebar: show only links each role may open; FM-only admin block; label via roleLabel
- backend: GET /user/logs/:id now FM-only via requireRole('FM')
- tests: add RBAC route+sidebar tests (client) and requireRole tests (server)
- docs: docs/rbac-access-control-report.md (matrices, 401/403, manual checklist, risks)

Note: teammate-owned APIs (incident/zones/detection-alerts/bookings) left unauthenticated
on purpose — documented as known risks to avoid breaking their modules.
```
