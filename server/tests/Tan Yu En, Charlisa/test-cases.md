# Backend test cases - Charlisa

Final focused result on 28 July 2026: **7/7 suites and 143/143 tests passed**. These suites are also included in the green repository total of 36/36 suites and 501/501 tests.

| Area | Representative cases | Expected result |
|---|---|---|
| Camera inventory | FM CRUD, Staff read, Tenant/unauthenticated rejection, validation, soft delete, zone inclusion. | Role-correct 2xx/4xx responses and current Sequelize field names. |
| Monitoring zones/detection setup | Zone CRUD, settings fields/units, camera assignment, one-camera-per-zone conflict, enabled/type serialization. | Deterministic settings round-trip and 409 conflict behavior. |
| Alert creation bridge | DetectionAlert and IncidentLog creation in one transaction with `incident_log_id`. | Both records commit together or roll back together. |
| Alert lifecycle | Status/severity/person updates, FM-only mutations, clear/false-alarm behavior, soft delete. | Linked incident mirrors supported fields and deletion. |
| Reverse incident sync | Incident resolution/severity/person/delete changes propagate back to the linked alert. | Bidirectional state remains consistent without recursion. |
| Edge ingestion | Service/edge authentication, payload validation, camera/zone resolution, alert mapping. | Trusted callers accepted; missing/invalid credentials and malformed input rejected. |
| Incident integration auth | FM incident operations, Staff/Tenant denial, authenticated service frame scan. | Shared RBAC remains consistent with the frontend. |
| Frame upload security | Multipart image MIME and byte limits. | Only JPEG/PNG/WebP up to 8 MiB; unsupported input returns 415 and oversized input returns 413 before AI forwarding. |

The shared YOLO-proxy suite additionally covers FM/Staff JWTs, raster data URLs up to 8 MiB, positive optional camera/zone IDs, field allowlisting, private AI credentials, timeouts, and upstream error mapping.
