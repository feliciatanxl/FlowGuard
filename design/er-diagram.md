# FlowGuard – Entity Relationship Diagram

```mermaid
erDiagram
    USERS ||--o{ ATTENDANCE : records
    USERS ||--o{ USERS : manages
    USERS ||..o{ SECURITY_LOGS : "name match"
    USERS ||..o{ INCIDENT_LOGS : "name match"

    USERS {
        int id PK
        string name
        string email UK
        string password
        enum role "FM | Tenant | Staff"
        string companyCode UK
        datetime codeCreatedAt
        int codeMaxUsage
        int codeCurrentUsage
        int managerId FK "self to users.id"
        boolean isEnrolled
        vector faceVector "512-dim pgvector"
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }
    ATTENDANCE {
        int id PK
        enum type "IN | OUT"
        datetime timestamp
        int userId FK "to users.id CASCADE"
        datetime createdAt
        datetime updatedAt
    }
    SECURITY_LOGS {
        string id PK
        string time
        string type
        text desc
        string severity
        string icon
        string personnelName "soft link to users.name"
        datetime createdAt
        datetime updatedAt
    }
    INCIDENT_LOGS {
        int id PK
        string camera_location
        string status
        string person_name
        decimal confidence_score "precision 5,4"
        datetime deletedAt "soft delete"
    }
    BOOKINGS {
        int id PK
        string booking_ref UK
        string transport_company
        string license_plate
        string driver_phone
        string loading_bay
        string status
        datetime deletedAt "soft delete"
    }
    INVITES {
        int id PK
        string code UK
        enum role "Tenant"
        boolean isUsed
        datetime expiresAt
    }
    STAFF_MEMBERS {
        int id PK
        string name
        string role
        text face_embedding
        datetime deletedAt "soft delete"
    }
```

**Solid line** = enforced foreign key. **Dotted line** = soft link by name (no DB-level FK).
Tables shown are those present in the access-management codebase; teammates' tables
(Support_Tickets, Chat_Transcripts, Monitoring_Zones, etc.) should be added to complete
the full-system ER.