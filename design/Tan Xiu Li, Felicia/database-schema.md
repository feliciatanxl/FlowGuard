# Felicia database schema

Source of truth: current Sequelize models in `server/models`. Sequelize supplies implicit integer `id` primary keys and `createdAt`/`updatedAt` unless a model declares another key. Omitted `allowNull` values below are identified rather than guessed.

## `users` / User

| Field | Sequelize/PostgreSQL type | Null/constraint/default | Purpose |
|---|---|---|---|
| `id` | INTEGER | implicit PK, auto increment | User identity. |
| `name` | STRING(100) | not null | Display/person name. |
| `email` | STRING(100) | not null, unique | Login identity. |
| `password` | STRING(100) | not null | Bcrypt hash. |
| `role` | ENUM(`FM`,`Tenant`,`Staff`) | default `Tenant`; `allowNull` not explicitly set | Current RBAC role. No VIP value exists. |
| `companyCode` | STRING(50) | nullable, unique | Tenant staff-registration code. |
| `codeCreatedAt` | DATE | nullable | Code expiry reference. |
| `codeMaxUsage` | INTEGER | not null, default 10 | Maximum registrations. |
| `codeCurrentUsage` | INTEGER | not null, default 0 | Current registrations. |
| `managerId` | INTEGER | nullable, self association | Tenant manager for Staff. |
| `isEnrolled` | BOOLEAN | not null, default false | Face enrolment state. |
| `faceVector` | `ARRAY(FLOAT)` / PostgreSQL `FLOAT[]` | nullable | Protected facial embedding. The application does not use pgvector. |
| `isActive` | BOOLEAN | not null, default true | Suspension state. |
| `tokenVersion` | INTEGER | not null, default 0 | Session revocation version. |
| `passwordResetTokenHash` | STRING(64) | nullable | SHA-256 reset-token digest. |
| `passwordResetExpiresAt` | DATE | nullable | Reset expiry. |
| `createdAt`, `updatedAt` | DATE | Sequelize timestamps | Audit timestamps. |

Associations: User belongs to User as `Manager` through `managerId`; User has many `StaffMembers` and Attendance; User has one EvaluationParticipant. `paranoid:false`: user deletion is a hard delete after the explicit transaction.

## `evaluation_participants` / EvaluationParticipant

| Field | Type | Constraint/default |
|---|---|---|
| `id` | INTEGER | implicit PK |
| `userId` | INTEGER | nullable, unique, FK to User, `ON DELETE SET NULL` |
| `evaluationLabel` | STRING(32) | not null, unique |
| `active` | BOOLEAN | not null, default true |
| `assignedAt` | DATE | not null, default now |
| `retiredAt` | DATE | nullable |
| timestamps | DATE | enabled |

The service retires rather than deletes the mapping so labels such as P01 remain reserved. Eligibility is computed from active User enrolment/vector state; the vector is never returned by the participant API.

## `security_logs` / SecurityLog

| Field | Type | Constraint/default |
|---|---|---|
| `id` | STRING | primary key, not null; route/service generates UUID |
| `time` | STRING | not null |
| `type` | STRING | not null |
| `desc` | TEXT | not null |
| `severity` | STRING | not null, default `safe` |
| `icon` | STRING | not null |
| `personnelName` | STRING | nullable soft reference |
| `matchedUserId` | INTEGER | nullable soft reference; no FK/association |
| `confidence` | FLOAT | nullable |
| `cameraLocation` | STRING | nullable |
| `reviewStatus` | STRING | not null, default `Pending Review`; route accepts Pending Review/False Positive/Escalated/Resolved |
| `reviewNotes` | TEXT | nullable |
| `reviewedBy` | STRING | nullable |
| `reviewedAt` | DATE | nullable |
| timestamps | DATE | enabled |

Off-boarding clears `personnelName`/`matchedUserId` and neutralises descriptions containing the removed name while retaining the audit event.

## `attendance` / Attendance

| Field | Type | Constraint/default |
|---|---|---|
| `id` | INTEGER | implicit PK |
| `userId` | INTEGER | association FK to User; `ON DELETE CASCADE`; nullability not explicitly declared in model field list |
| `type` | ENUM(`IN`,`OUT`) | not null |
| `timestamp` | DATE | default now; `allowNull` not explicitly set |
| timestamps | DATE | enabled |

Gate Scanner writes Attendance after final same-person/liveness confirmation. V-Patrol never writes Attendance.

## `bookings` / Booking

| Field | Type | Constraint/default |
|---|---|---|
| `id` | INTEGER | implicit PK |
| `booking_ref` | STRING(50) | not null, unique |
| `tenant_name` | STRING(255) | nullable |
| `tenantId` | INTEGER | nullable soft User reference; no declared association/FK |
| `driver_name` | STRING(255) | nullable |
| `transport_company` | STRING(255) | not null |
| `license_plate` | STRING(20) | not null |
| `driver_phone` | STRING(20) | not null |
| `loading_bay` | STRING(50) | not null |
| `slot_start`, `slot_end` | DATE | nullable |
| `status` | STRING(50) | default `Pending`; route values Pending/Confirmed/Arrived/Completed/Cancelled |
| `notes` | TEXT | nullable |
| `arrived_at`, `completed_at` | DATE | nullable |
| `deletedAt` | DATE | implicit because `paranoid:true` |
| timestamps | DATE | enabled |

The current cancel endpoint sets `status=Cancelled`; it does not call `destroy()`. Bay conflict checks are application queries, not a database exclusion constraint.

## `gate_access_logs` / GateAccessLog

| Field | Type | Constraint/default |
|---|---|---|
| `id` | UUID | PK, default UUIDV4 |
| `bookingRef` | STRING(50) | not null, indexed; soft reference to Booking reference |
| `action` | STRING(10) | not null, indexed; `entry`/`exit` by service validation |
| `decision` | STRING(10) | not null; `granted`/`denied` |
| `reasonCode` | STRING(40) | not null |
| `verificationMode` | STRING(20) | nullable; automatic/manual |
| `plateSource` | STRING(20) | nullable; ocr/simulation/manual |
| `plateConfidence` | FLOAT | nullable |
| `expectedPlate`, `observedPlate` | STRING(20) | nullable |
| `plateMatched` | BOOLEAN | nullable |
| `loadingBay` | STRING(50) | nullable |
| `overrideUsed` | BOOLEAN | not null, default false |
| `overrideReason` | TEXT | nullable; service requires text for an accepted override |
| `fmId` | INTEGER | nullable soft User reference |
| `fmEmail` | STRING(255) | nullable |
| `createdAt` | DATE | enabled and indexed; decision time |
| `updatedAt` | DATE | enabled |

Confirmed indexes: `bookingRef`, `action`, and `createdAt`. No Sequelize association/foreign key to Booking or User is declared.

## Deletion, retention, and images

- User off-boarding transaction: set `faceVector=null`/`isEnrolled=false`; delete Attendance; anonymise SecurityLog; clear Booking `tenantId`; retire EvaluationParticipant; destroy User. Tenant deletion is blocked with 409 while linked Staff remain.
- Booking supports paranoid deletion but the current workflow uses status-based cancellation. GateAccessLog has no delete route and is retained as decision audit metadata.
- Facial enrolment/recognition, QR, and plate images are transient. No owned model has an image column. The persisted biometric is a `FLOAT[]` embedding; GateAccessLog stores plate strings/confidence and audit metadata only.
- AI models live in the container image. The current PoC does not require persistent user-upload object storage.
