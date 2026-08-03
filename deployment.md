# FlowGuard deployment and assessment guide

This document is the assessor-facing deployment, test-account, and demonstration checklist for the FlowGuard Google Cloud staging environment. Passwords and other credentials must remain placeholders in the tracked repository.

## Deployed Application

| Item | Value |
|---|---|
| Application name | FlowGuard |
| Environment | Google Cloud staging |
| Public client URL | <https://flowguard-client-staging-590663319889.asia-southeast1.run.app> |
| Login URL | <https://flowguard-client-staging-590663319889.asia-southeast1.run.app/login> |
| Client Cloud Run service | `flowguard-client-staging` |
| Server Cloud Run service | `flowguard-server-staging` |
| AI Cloud Run service | `flowguard-ai-staging` |
| Database | Cloud SQL PostgreSQL |
| Container registry | Artifact Registry |
| Build/deployment | Cloud Build |
| Current deployment status | `<VERIFY BEFORE SUBMISSION>` |
| Last manually verified date | `<YYYY-MM-DD — VERIFY BEFORE SUBMISSION>` |

The client is public and serves the React single-page application through Nginx. Nginx proxies `/api/*` and `/user/*` to the Node server. The AI Cloud Run service is private and is invoked by the Node server. The direct server URL, AI URL, Cloud SQL identifiers, revision names, and build IDs are not verified repository values and must not be guessed.

The canonical application roles are `FM`, `Tenant`, and `Staff`. `FM` is the stored role for a Facilities Manager.

## Test Accounts

| Role | Display name | Email | Password | Status | Main demonstration |
|---|---|---|---|---|---|
| `FM` | System Root Admin — existing single Facilities Manager account | `admin@harrison.com` | `<ENTER EXISTING FLOWGUARD DEMO PASSWORD>` | Existing — verify before submission | Operations Dashboard, Tenant Onboarding, User Management, Gate Verification, object detection, alerts, incidents, security review, and support |
| `Tenant` | FlowGuard Demo Tenant | `tenant.demo@harrison.com` | `<CREATE AND VERIFY DEMO PASSWORD>` | To be created manually | Tenant Dashboard, Staff Management, logistics/bookings, attendance, and Settings |
| `Staff` | FlowGuard Demo Staff | `staff.demo@harrison.com` | `<CREATE AND VERIFY DEMO PASSWORD>` | To be created manually under demo Tenant | Staff Dashboard, own attendance, permitted unit logistics, and Settings |

### Account notes

- FlowGuard has one existing Facilities Manager/System Root Admin account. A second FM test account is not required and the public registration flow does not permit FM registration.
- The FM account email and role are defined by `server/seed.js`. The repository no longer contains or logs a literal seed password: an authorised operator must supply `FLOWGUARD_SEED_FM_PASSWORD` only when explicitly running the seed command.
- The seed uses `findOrCreate`, so it does not create a duplicate or reset an existing FM password when the email already exists. Changing the seed script does not rotate the deployed account; the team must manually verify the deployed FM credential and use **Settings → Account Security → Change Password** if it still uses the old standard value.
- The existing FM password may be documented only if it is a dedicated academic FlowGuard demo password and is not reused for personal, Google Cloud, GitHub, Gmail, database, or API services.
- The current personal Tenant account must not be submitted as the test account.
- Tenant and Staff test accounts must use fake demonstration data. The suggested `@harrison.com` addresses satisfy the application's standard email validation.
- Real passwords must be added manually by the team. Personal, Google Cloud, GitHub, Gmail, database, API, private reCAPTCHA, and other credentials must never appear in this tracked document.
- Passwords should be rotated or the demo accounts disabled after assessment.
- If the repository is public, keep the placeholders in Git and provide actual demo passwords only in the private LMS submission copy.

## Implemented Role Journey

| User | Recommended pages | Access boundary to demonstrate |
|---|---|---|
| `FM` | Operations Dashboard (`/dashboard`), User Management (`/users`), Tenant Onboarding (`/tenant-management`), Loading Bay Logistics (`/logistics`), Gate Verification (`/logistics/gate-verification`), Cameras (`/cameras`), Object Detection (`/object-detection`), Incident Dashboard (`/incidents`), Security Review (`/security-review`), Support Tickets (`/support-dashboard`) | Facility-wide administration, monitoring, booking-status control, gate decisions, and review workflows |
| `Tenant` | Tenant Dashboard (`/dashboard`), My Staff (`/staff`), Loading Bay Logistics (`/logistics`), Daily Attendance (`/attendance`), Settings (`/settings`) | Own Staff, own-unit attendance, and own-unit bookings only; FM-only routes must return the forbidden page |
| `Staff` | Staff Dashboard (`/dashboard`), Daily Attendance (`/attendance`), Loading Bay Logistics (`/logistics`), Settings (`/settings`) | Own attendance and the linked Tenant's bookings; no User Management, My Staff, Gate Verification, or FM monitoring pages |
| Driver | Driver Pass (`/driver-pass/:ref`) | Public pass lookup only; no FlowGuard login account |

## Demo Account Creation Procedure

### Facilities Manager

1. Open the [deployed login page](https://flowguard-client-staging-590663319889.asia-southeast1.run.app/login).
2. Log in with the existing `FM` account, `admin@harrison.com`.
3. Verify privately that its password is a dedicated FlowGuard academic demo password.
4. Test the account in an Incognito window, including logout and a fresh login.
5. If the account is not already enrolled, complete the three-angle Face ID setup reached at `/enrollment` after login.
6. If the FM password must be changed, open **Settings**, use **Account Security → Change Password**, and log in again; this revokes existing sessions.

### Tenant — recommended direct creation

The direct creation flow sets a temporary password immediately. It does not send an invitation email or password-setup link.

1. Log in as the existing `FM`.
2. Open **User Management** (`/users`).
3. Select **+ Add Tenant**.
4. Enter `FlowGuard Demo Tenant`, `tenant.demo@harrison.com`, and a private temporary password of at least eight characters.
5. Select **Create Tenant**. The server assigns the exact role `Tenant`; the form cannot create another `FM` or a `Staff` account from this page.
6. Log out, open an Incognito window, and log in at `/login` with the new Tenant credentials.
7. Complete **Mandatory Biometric Setup** at `/enrollment`. A manually created user starts with `isEnrolled=false`, and the normal login flow redirects to this three-angle enrolment page.
8. Verify the Tenant can use `/dashboard`, `/staff`, `/logistics`, `/attendance`, and `/settings`.
9. Verify the Tenant is denied access to FM-only routes such as `/users`, `/tenant-management`, `/logistics/gate-verification`, `/object-detection`, and `/incidents`.

Alternative invite flow: an `FM` can open **Tenant Onboarding** (`/tenant-management`), select **Generate Invite Code**, and provide the one-time 48-hour code to the demo user. The recipient opens `/register`, selects **Unit Owner / Tenant**, enters their name, email, chosen password, and invitation code, then completes first-login Face ID enrolment. Use only one creation flow so the email is not duplicated.

### Staff — recommended direct creation

The direct creation flow also sets a temporary password immediately; it does not send an invitation email or password-setup link.

1. Log in as `FlowGuard Demo Tenant`.
2. Open **My Staff** (`/staff`), whose page heading is **Staff Management**.
3. Select **+ Add Staff**.
4. Enter `FlowGuard Demo Staff`, `staff.demo@harrison.com`, and a private temporary password of at least eight characters.
5. Select **Create Staff**. The server assigns the exact role `Staff` and links the account to the logged-in Tenant through `managerId`.
6. Log out, open an Incognito window, and log in at `/login` with the new Staff credentials.
7. Complete **Mandatory Biometric Setup** at `/enrollment`.
8. Verify the Staff account can use its Staff Dashboard, its own Daily Attendance, its linked unit's Loading Bay Logistics, and Settings.
9. Verify the Staff account is denied `/users`, `/staff`, `/tenant-management`, `/logistics/gate-verification`, and other FM-only monitoring or administration routes.

Alternative self-registration flow: the Tenant can generate or refresh the 48-hour **Unit Registration Code** on **My Staff**. The Staff user opens `/register`, selects **Factory Staff**, chooses their own password, and enters that code. The code is limited to ten registrations. Use only one creation flow for the demo account.

## Driver Demonstration

No Driver login account is required. The booking reference is also the QR token, and the public Driver Pass fetches the latest safe booking details without exposing the driver's phone number, Tenant ID, or booking notes.

Exact deployed URL format:

`https://flowguard-client-staging-590663319889.asia-southeast1.run.app/driver-pass/<BOOKING_REFERENCE>`

Generated booking references use the `FG-XXXXXX` pattern. Use the actual confirmed booking reference rather than a made-up example.

| Prepared item | Value |
|---|---|
| Booking reference | `<ENTER CONFIRMED BOOKING REFERENCE>` |
| Driver Pass URL | `<ENTER VERIFIED DRIVER PASS URL>` |
| Vehicle plate | `<ENTER DEMONSTRATION VEHICLE PLATE>` |
| Booking date | `<YYYY-MM-DD>` |
| Booking time | `<START–END SGT>` |
| Booking status | `<CONFIRM STATUS — USE Confirmed FOR THE DEMO>` |
| Assigned bay/zone | `<ENTER Bay A OR Bay B>` |

Prepare the booking through **Loading Bay Logistics** (`/logistics`), then have the `FM` move it from `Pending` to `Confirmed`. Verify the public pass, its QR/reference, and the matching plate before the lesson. Use **Gate Verification** (`/logistics/gate-verification`) for the FM-only QR and plate demonstration.

## Health Checks

The server health routes exist in `server/routes/health.js` and are mounted at `/health` by `server/index.js`. The client Nginx configuration does not proxy `/health`, so use the verified direct server Cloud Run URL rather than appending these paths to the client URL.

| Check | URL | Expected outcome | Result |
|---|---|---|---|
| Client | <https://flowguard-client-staging-590663319889.asia-southeast1.run.app> | HTTP 200 and the FlowGuard application | `<RUN AND RECORD BEFORE SUBMISSION>` |
| Server liveness | `<SERVER_CLOUD_RUN_URL>/health/live` | HTTP 200 with `{"status":"live"}` | `<RUN AND RECORD BEFORE SUBMISSION>` |
| Server readiness | `<SERVER_CLOUD_RUN_URL>/health/ready` | HTTP 200 with `{"status":"ready","database":true}` | `<RUN AND RECORD BEFORE SUBMISSION>` |

Readiness returns HTTP 503 with `{"status":"not_ready","database":false}` when startup is incomplete or the database check fails. Do not mark a check as passed until it has been executed against the deployed service.

## Demo Test Data Checklist

- [ ] Existing FM account verified
- [ ] New demo Tenant created
- [ ] New demo Staff created
- [ ] All three login credentials verified in Incognito
- [ ] Face enrolment completed where required
- [ ] One confirmed booking
- [ ] One Driver Pass reference/QR
- [ ] One demonstration vehicle plate
- [ ] One attendance record
- [ ] One camera
- [ ] One monitoring zone
- [ ] One detection alert
- [ ] One linked incident
- [ ] One support ticket
- [ ] Webcam permission granted
- [ ] Raspberry Pi URL configured where used
- [ ] Pi `/health` verified
- [ ] Pi `/snapshot` verified
- [ ] Pi `/video_feed` verified
- [ ] Laptop webcam fallback verified
- [ ] All demo data remains available after refresh

## Deployment Verification Checklist

- [ ] Deployed client loads without localhost
- [ ] Login works for FM
- [ ] Login works for Tenant
- [ ] Login works for Staff
- [ ] Logout works
- [ ] Refreshing protected React routes does not return 404
- [ ] Server liveness passes
- [ ] Server readiness passes
- [ ] Latest client Cloud Run revision is healthy
- [ ] Latest server Cloud Run revision is healthy
- [ ] Database-backed pages load
- [ ] FM-only pages reject Tenant and Staff
- [ ] Tenant cannot access another Tenant's information
- [ ] Staff access is limited correctly
- [ ] Booking CRUD works
- [ ] Driver Pass works
- [ ] QR scanning works
- [ ] Plate capture works
- [ ] Laptop webcam works
- [ ] Raspberry Pi camera works where demonstrated
- [ ] Object detection works
- [ ] Alert-to-incident linking works
- [ ] Support Ticket flow works

## Security and Privacy Rules

- Do not store actual passwords, personal account passwords, Google Cloud credentials, database passwords, JWT secrets, API keys, private reCAPTCHA secrets, biometric images, personal phone numbers, or personal Tenant data in this document.
- The known FM email may be included only because it is the repository-defined academic demo account.
- Keep all facial images transient. Only the protected face vector and enrolment state belong in the application database.
- Use fake names, fake email addresses, a demonstration vehicle plate, and non-personal driver information for assessment data.
- Keep the AI service private. Do not expose its URL as a public demonstration endpoint.
- Do not place secrets in Docker build arguments or `VITE_` variables because client build variables are public.

## Repository-backed Deployment Notes

- Google Cloud project/region documented by `deployment/cloud-run/README.md`: `flowguard-502613`, `asia-southeast1`.
- The normal staging architecture is Browser → public client/Nginx → Node server → private AI service, with Node and AI using Cloud SQL PostgreSQL.
- Cloud Run configuration uses runtime environment names and Secret Manager bindings; actual values must remain outside Git.
- `DB_SYNC_ALTER` is false for normal deployment. Database migrations or schema alteration are outside this document's verification procedure.
- SecurePi is a separate local edge-AI subsystem: see the [SecurePi and FlowGuard architecture reference](docs/securepi-flowguard-edge-ai.md) before configuring IMX500 streaming or edge alert ingestion.
- Revision names, image digests, build IDs, the direct server URL, and live IAM state must be copied from Google Cloud by an authorised team member; do not infer them from service names.
- Detailed build, deployment, IAM, environment-variable, resource-sizing, and rollback guidance remains in [`deployment/cloud-run/README.md`](deployment/cloud-run/README.md).

## Implementation References

| Fact | Source |
|---|---|
| Roles and default enrolment state | `server/models/User.js`, `server/middlewares/auth.js`, `client/src/constants/roles.js` |
| Existing FM seed identity | `server/seed.js` |
| Login and first-login enrolment redirect | `server/routes/user.js`, `client/src/pages/Login.jsx` |
| Direct Tenant/Staff creation and password handling | `server/routes/user.js`, `client/src/pages/Users.jsx`, `client/src/pages/StaffManagement.jsx` |
| Tenant/Staff invite alternatives | `server/routes/user.js`, `client/src/pages/TenantManagement.jsx`, `client/src/pages/Register.jsx` |
| Protected page permissions | `client/src/App.jsx`, `client/src/components/ProtectedRoute.jsx`, `server/middlewares/auth.js` |
| Booking roles, isolation, and gate permissions | `server/routes/booking.js`, `client/src/pages/TenantLogistics.jsx` |
| Driver Pass route and public booking DTO | `client/src/App.jsx`, `client/src/pages/DriverPass.jsx`, `server/routes/booking.js` |
| Liveness and readiness routes | `server/index.js`, `server/routes/health.js` |
