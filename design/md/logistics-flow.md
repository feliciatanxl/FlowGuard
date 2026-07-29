# FlowGuard - Smart Logistics & Loading Bay Flow

## Booking to gate to next-in-line

```mermaid
flowchart TB
  A[FM / Tenant / Staff opens Logistics] --> B[Create booking]
  B --> C[POST /api/bookings/create]
  C --> D{Valid required fields and bay slot}
  D -->|Missing or invalid| E[400 validation error]
  D -->|Same-bay slot clash| F[409 conflict]
  D -->|OK| G[Generate booking_ref]
  G --> H[Create Driver Pass link]
  H --> I[Send WhatsApp notification; simulated or real mode]
  I --> J[Driver opens /driver-pass/:ref]
  J --> K[FM Gate Verification]
  K --> K1[Local QR: BarcodeDetector or ZXing]
  K1 -->|No QR| K2[Node to private FastAPI cloud decode]
  K2 -->|Still unavailable| K3[Manual reference entry]
  K1 --> L{Entry or exit}
  K2 --> L
  K3 --> L
  L -->|entry| M[PoC plate OCR or manual correction]
  M --> M1{Status, time and plate valid}
  M1 -->|Denied| M2[Write denied GateAccessLog]
  M1 -->|Granted or audited override| N[Write granted GateAccessLog then status = Arrived]
  N --> O[Arrival notification]
  L -->|exit| P[status = Completed; completed_at set]
  P --> Q[Find next eligible booking in same bay]
  Q --> R[Notify next driver]
  S[FM or owning Tenant cancels] --> T[PATCH /api/bookings/:id/cancel]
  T --> U[status = Cancelled]
  U --> V[Cancellation notification]
```

## Role gate on canonical Gate Verification

```mermaid
flowchart LR
  FM[FM] -->|allowed| GS[POST /api/bookings/gate-verification]
  TEN[Tenant] -->|403| GS
  STF[Staff] -->|403| GS
```

## Notes

- Booking creation validates required fields, enforces role/ownership rules, detects same-bay slot conflicts, generates `booking_ref`, creates a public Driver Pass link and sends a mock-safe WhatsApp notification.
- Gate verification is FM-authoritative and checks status, arrival window and plate. Every final decision is audited; reviewable manual overrides require a reason.
- Repeated entry/exit is idempotent. The older `PATCH /:ref/gate-scan` route remains for compatibility but is not the canonical audited workflow.
- Gate exit sets `status = Completed` and `completed_at`, then locates the next eligible booking in the same bay for notification.
- Cancellation is logical cancellation through status: `PATCH /api/bookings/:id/cancel` sets `status = Cancelled` and sends a cancellation notification. It is not the manual UI path for Sequelize paranoid soft delete.
- Plate OCR is a proof of concept, and the on-screen barrier is simulated rather than a physical actuator.
