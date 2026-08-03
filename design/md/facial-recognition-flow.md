# FlowGuard - Facial Recognition & Access Management Flow

## Recognition flow

```mermaid
flowchart TB
  subgraph Capture[Camera and browser]
    direction LR
    A[Raspberry Pi Camera Module 3<br/>or laptop webcam] --> B[Browser captures current frame]
  end

  subgraph Track[Detector-only tracking]
    direction LR
    B --> C[POST Node<br/>/api/facial-recognition/track]
    C --> D[Node proxies to private FastAPI]
    D --> E[Face presence, box, count<br/>and head-turn ratio]
    E --> F{Exactly one face?}
  end

  F -->|No| X[Fail closed<br/>deny and create no Attendance]
  F -->|Yes| G[POST Node<br/>/api/facial-recognition/recognize]

  subgraph Identity[Identity and account policy]
    direction LR
    G --> H[FastAPI matches embedding<br/>and returns candidate + confidence]
    H --> I[Node re-reads PostgreSQL user]
    I --> J{Active, enrolled<br/>candidate returned?}
  end

  J -->|No: unknown or suspended| X
  J -->|Yes| K[Collect baseline tracking ratios]

  subgraph Liveness[Head-turn liveness challenge]
    direction LR
    K --> L[Prompt head turn and hold]
    L --> M[Require movement delta<br/>for consecutive samples]
    M --> N[Final /recognize]
    N --> O{Same user ID as<br/>initial candidate?}
  end

  O -->|No or timeout| X
  O -->|Yes| P{Scanner mode}
  subgraph Outcomes[Authorised outcomes]
    direction LR
    P -->|Gate Scanner| Q[POST /api/attendance/scan]
    Q --> R[Attendance IN or OUT<br/>and simulated turnstile outcome]
    P -->|V-Patrol| S[POST /api/facial-recognition/access-event]
    S --> T[SecurityLog access event<br/>Attendance unchanged]
  end
```

Motion liveness uses head-turn verification. It is a proof-of-concept challenge, not a complete anti-spoofing model.

## Enrolment flow

```mermaid
flowchart TB
  subgraph Entry[Entry to enrolment]
    direction LR
    A[Successful login] --> B{Face already enrolled?}
    B -->|Yes| Z[Continue to Dashboard]
    B -->|No| C[Face Enrollment]
    R[Re-enrolment<br/>self; FM any user; Tenant own Staff] --> C
  end
  subgraph CaptureFlow[Three-orientation capture]
    direction LR
    C --> D[Choose Pi camera, webcam<br/>or image upload]
    D --> E[Capture front, left and right]
    E --> F[POST /user/enroll-face<br/>three in-memory data URLs]
    F --> G{Authenticated scope<br/>and three images valid?}
    G -->|No| X[400, 403 or 404<br/>nothing stored]
  end
  subgraph Encoding[Private AI encoding]
    direction LR
    G -->|Yes| H[Node sends images to private FastAPI<br/>/api/encode-faces]
    H --> I[InsightFace returns<br/>512-number vector]
    I --> J{Vector valid?}
    J -->|No| Y[502 or 503<br/>enrolment not saved]
  end
  subgraph Persistence[Persist protected template]
    direction LR
    J -->|Yes| K[Discard source images<br/>save User.faceVector and isEnrolled = true]
    K --> L[Assign stable evaluation label]
    L --> M[Refresh AI known-face cache<br/>non-fatal if temporarily unavailable]
    M --> Z2[Return to requested page<br/>or Dashboard]
  end
```

## Off-boarding flow

```mermaid
flowchart TB
  subgraph Choice[Authorised account management]
    direction LR
    A[FM manages any user<br/>Tenant manages own Staff] --> B{Suspend or<br/>permanently remove?}
  end
  subgraph Suspension[Reversible suspension]
    direction LR
    B -->|Suspend| C[Set isActive = false<br/>increment tokenVersion]
    C --> D[Existing sessions revoked<br/>login and recognition fail closed]
    D --> E[Retain account, Attendance<br/>and audit records for reactivation]
  end
  subgraph DeleteStart[Permanent removal checks]
    direction LR
    B -->|Permanently remove| F{Deletion guards pass?}
    F -->|Self-delete or Tenant has linked Staff| G[Reject request<br/>400 or 409]
    F -->|Yes| H[Begin database transaction]
  end
  subgraph Minimise[Transactional data minimisation]
    direction LR
    H --> I[Wipe faceVector<br/>set isEnrolled = false]
    I --> J[Hard-delete Attendance]
    J --> K[Retain SecurityLogs but anonymise<br/>name, matched user and description]
  end
  subgraph DeleteFinish[Retained history and account deletion]
    direction LR
    K --> L[Retain bookings but clear<br/>personal tenant linkage]
    L --> M[Retire evaluation participant<br/>and reserve historical label]
    M --> N[Hard-delete User row]
    N --> O[Commit transaction]
    O --> P[Refresh AI face cache<br/>non-fatal after commit]
  end
```

## Notes

- Tracking (`/api/facial-recognition/track`) is detector-only and has no identity, database, Attendance or SecurityLog side effects.
- Recognition (`/api/facial-recognition/recognize`) uses the AI match and confidence result, then treats the PostgreSQL user ID, active state and enrolment state as authoritative.
- Gate Scanner performs tracking, initial recognition, a baseline head-turn challenge, final same-ID recognition and then `/api/attendance/scan`.
- V-Patrol applies the same access policy but writes `/api/facial-recognition/access-event`; Attendance is unchanged.
- Unknown, suspended, multiple-face and timeout cases fail closed. Where the recognition/access routes audit a denial, they write `SecurityLog` access or intrusion events, not `IncidentLog` records.
- Enrolment images remain in request memory and are not written to PostgreSQL, disk, cloud storage or logs; only the generated biometric vector is stored.
- Suspension is reversible and retains records. Permanent off-boarding is transactional: the user and Attendance rows are hard-deleted, while operational/security history is retained only after unlinking or anonymisation.
