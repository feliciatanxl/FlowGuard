# FlowGuard - Smart Logistics & Loading Bay Flow

## Booking to gate to next-in-line

```mermaid
flowchart TB
  subgraph Booking[Booking and confirmation]
    direction LR
    A[FM, Tenant or Staff<br/>opens Logistics] --> B[POST /api/bookings/create]
    B --> C{Required fields, 1-2 hour<br/>window and same-bay slot valid?}
    C -->|No| C1[400 validation or<br/>409 slot conflict]
    C -->|Yes| D[Create Pending booking<br/>and unique FG reference]
    D --> E[Send booking-created WhatsApp<br/>and expose public Driver Pass]
    E --> F[FM reviews booking]
    F --> G[PATCH status to Confirmed]
    G --> H[Send confirmation WhatsApp]
  end

  subgraph Pass[Driver and reference capture]
    direction LR
    H --> I[Driver opens<br/>/driver-pass/:ref]
    I --> J[FM opens Gate Verification]
    J --> K{Read booking reference}
    K -->|Local| K1[BarcodeDetector or ZXing]
    K -->|Cloud fallback| K2[Node QR proxy to<br/>private FastAPI decoder]
    K -->|Operator fallback| K3[Manual reference entry]
    K1 --> L[Select entry or exit<br/>capture or correct observed plate]
    K2 --> L
    K3 --> L
  end

  subgraph Decision[Canonical audited gate decision]
    direction LR
    L --> M[POST /api/bookings/gate-verification<br/>FM JWT required]
    M --> N[Re-read authoritative booking<br/>inside transaction with row lock]
    N --> O{Status, entry time window<br/>and plate pass?}
    O -->|No| P[Write denied GateAccessLog]
    P --> Q{Manual mode and<br/>reviewable plate/camera failure?}
    Q -->|No| R[Access denied]
    Q -->|FM override + reason| S[Write granted override audit]
    O -->|Yes| T[Write granted GateAccessLog]
  end

  subgraph Outcome[Granted transitions and notifications]
    direction LR
    S --> U{Action}
    T --> U
    U -->|Entry| V[Confirmed to Arrived<br/>set arrived_at]
    V --> W[Send arrival WhatsApp]
    U -->|Exit| X[Arrived to Completed<br/>set completed_at]
    X --> Y[Send completion WhatsApp]
    Y --> Z[Find earliest Pending or Confirmed<br/>booking in the same bay]
    Z --> Z1[Notify next driver]
  end

  subgraph Cancellation[Logical cancellation]
    direction LR
    CA[FM or owning Tenant cancels] --> CB[PATCH /api/bookings/:id/cancel]
    CB --> CC[Set status Cancelled<br/>and send cancellation WhatsApp]
  end
```

## Role gate on canonical Gate Verification

```mermaid
flowchart TB
  subgraph ClientGate[Client navigation gate]
    direction LR
    FM[Facilities Manager] --> PR[React ProtectedRoute<br/>allowedRoles = FM_ONLY]
    TEN[Tenant] --> PR
    STF[Staff] --> PR
    PR -->|FM| PAGE[Gate Verification page]
    PR -->|Tenant or Staff| UI403[Client redirects to 403]
  end
  subgraph ServerGate[Server security boundary]
    direction LR
    PAGE --> REQ[POST /api/bookings/gate-verification<br/>Bearer JWT]
    DIRECT[Tenant or Staff direct API call] --> REQ
    REQ --> JWT{verifyToken<br/>DB account authoritative}
    JWT -->|Missing or invalid| AUTH[401 or 403]
    JWT -->|Valid| ROLE{requireRole FM}
    ROLE -->|Tenant or Staff| API403[403 Forbidden]
    ROLE -->|FM| SERVICE[Audited gate-verification service]
  end
```

## Notes

- Booking creation is available to FM, Tenant and Staff, validates required fields and a one-to-two-hour booking window, rejects same-bay slot conflicts, and creates a `Pending` booking with a unique public Driver Pass reference.
- An FM changes the booking to `Confirmed` before canonical entry verification can grant access. Both creation and confirmation notifications are mock-safe when the real WhatsApp provider is not configured.
- QR decoding only proposes a booking reference. Local browser decoding is attempted first, the authenticated Node QR proxy may call private FastAPI as a fallback, and the gate-verification service always re-reads PostgreSQL before deciding.
- Canonical gate verification is FM-authoritative. It checks status and plate for entry/exit, also checks the arrival window for entry, audits every final decision, and allows only reviewable manual plate/camera failures to be overridden with a reason.
- Granted audits are written before state changes; an audit failure rolls back and fails closed. Repeated arrival/completion requests are idempotent.
- Gate exit sets `status = Completed` and `completed_at`, then locates the earliest eligible `Pending` or `Confirmed` booking in the same bay for notification.
- Cancellation is logical cancellation through status, not a database soft delete. The older `PATCH /:ref/gate-scan` compatibility route is not the canonical audited workflow.
- Plate OCR and the on-screen barrier are proof-of-concept simulations rather than physical access-control hardware.
