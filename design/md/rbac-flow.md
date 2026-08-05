# FlowGuard - Role-Based Access Control (RBAC)

## Request flow

```mermaid
flowchart LR
  subgraph Client[React client]
    A[User opens page or action] --> B{ProtectedRoute<br/>allows stored role?}
    B -->|No| C[Redirect to login or 403]
    B -->|Yes| D[Axios sends Bearer JWT]
  end

  subgraph Edge[Public client service]
    D --> E[Nginx serves SPA<br/>and proxies /api or /user]
  end

  subgraph API[Node and Express]
    E --> F[Rate limiter and route middleware]
    F --> G{JWT present and valid?}
    G -->|Missing| U401[401 Unauthorized]
    G -->|Invalid or expired| U403A[403 Invalid token]
    G -->|Yes| H[Re-read User from PostgreSQL]
    H --> I{Account exists, active and<br/>tokenVersion current?}
    I -->|No| U401B[401 revoked or missing account<br/>403 suspended]
    I -->|Yes| J{DB role allowed<br/>for route?}
    J -->|No| U403B[403 Forbidden]
    J -->|Yes| K[Validated handler runs]
  end

  subgraph Data[Authoritative services]
    K --> L[Sequelize query or transaction]
    L --> M[(Cloud SQL PostgreSQL)]
    K -. AI route only .-> N[Authenticated server-to-server call<br/>to private FastAPI]
  end

  M --> O[Safe response DTO<br/>no password or face vector]
  N --> O
  O --> A
```

## Role capability map

```mermaid
flowchart LR
  subgraph FM[Facilities Manager - full facility scope]
    FM1[Live Cameras, Object Detection<br/>V-Patrol and Gate Scanner]
    FM2[Camera Inventory and Detection Setup<br/>read and write]
    FM3[Users, tenants, own-staff oversight<br/>suspend, off-board and assisted Face ID]
    FM4[Security Review, Incidents<br/>and Deep Analytics]
    FM5[All Attendance and Logistics<br/>status, cancellation and gate verification]
    FM6[Support tickets, Knowledge Base<br/>and administrative settings]
  end

  subgraph TEN[Tenant - own unit scope]
    T1[Role dashboard]
    T2[Manage own Staff<br/>logs, suspend, off-board and re-enrol]
    T3[Own-unit Logistics<br/>view, create, edit and cancel]
    T4[Attendance for own Staff]
    T5[Own Face ID and account settings]
  end

  subgraph STF[Staff - own and operational scope]
    S1[Role dashboard]
    S2[Own-unit Logistics<br/>view and create]
    S3[Own Attendance records]
    S4[Own Face ID and account settings]
    S5[Camera Inventory and Detection Setup<br/>view-only via authorised routes]
  end

  subgraph PUB[Public or driver]
    P1[Landing, System Health, Contact<br/>Login, Register and Innovation]
    P2[Driver Portal and safe Driver Pass<br/>lookup by booking reference]
  end
```

## Access matrix

| Page / action | FM | Tenant | Staff | Public |
|---|:---:|:---:|:---:|:---:|
| Landing / health / contact / authentication | Yes | Yes | Yes | Yes |
| Driver Portal and Driver Pass `/driver-pass/:ref` | Yes | Yes | Yes | Yes |
| Dashboard | Yes | Yes | Yes | No |
| Own Face ID enrolment / re-enrolment | Yes | Yes | Yes | No |
| Assisted Face ID re-enrolment | any user | own Staff | No | No |
| Live Cameras / Object Detection / V-Patrol / Gate Scanner | Yes | No | No | No |
| Camera Inventory / Detection Setup | read/write | No | view-only | No |
| Daily Attendance | all | own Staff | own only | No |
| Logistics - view / create | all | own unit | own unit | No |
| Logistics - edit / cancel | all | own | No | No |
| Logistics - status changes / canonical Gate Verification | Yes | No | No | No |
| Own Staff management | facility oversight | own Staff | No | No |
| User and tenant administration | Yes | No | No | No |
| Security Review / Incidents / Deep Analytics | Yes | No | No | No |
| Support Dashboard / Knowledge Base administration | Yes | No | No | No |
| Administrative settings | Yes | No | No | No |

## Notes

- React `ProtectedRoute` provides navigation-level gating, but Express `verifyToken` plus `requireRole` is the security boundary. Direct API calls cannot bypass the server role gate.
- `verifyToken` treats the database as authoritative for account existence, active state, role and `tokenVersion`; stale JWT claims do not override current PostgreSQL state.
- **401** means credentials are missing, revoked or reference a deleted account. **403** means the token is invalid/expired, the account is suspended or the current database role lacks permission.
- Staff can directly access `/camera-inventory` and `/detection-settings` and the corresponding read APIs, but create/update/delete controls and endpoints remain FM-only. Those Staff routes are not currently advertised in the Sidebar.
- Tenant and Staff data reads are scoped server-side to their own unit or account where applicable; hiding a sidebar item is never relied on as authorization.
- FM accounts are provisioned through setup/seed operations and cannot be created from the application UI.
