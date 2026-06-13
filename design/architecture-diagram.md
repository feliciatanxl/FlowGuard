# FlowGuard – System Architecture Diagram

```mermaid
flowchart TB
    subgraph EDGE["Data Sources"]
        CAM["Webcam / CCTV frame<br/>(base64 image)"]
    end

    subgraph CLIENT["Frontend — React (Vite) · hosted on Vercel"]
        WEB["Public Website<br/>Home / Contact / Login"]
        DASH["FM Dashboard<br/>V-Patrol · Cameras · Incidents · Users"]
        ENR["Face Enrollment<br/>webcam scan + manual upload"]
        GATE["Gate Scanner<br/>live recognition"]
    end

    subgraph BACKEND["Backend — Node.js + Express · hosted on Render"]
        AUTH["Auth & RBAC<br/>JWT · protected routes"]
        API["REST API<br/>users · attendance · booking · incident · security"]
        ORM["Sequelize ORM"]
    end

    subgraph AI["AI Service — Python + FastAPI · port 8500"]
        FACE["InsightFace<br/>/encode-faces · /recognize"]
        YOLO["YOLO object detection<br/>teammate service"]:::future
    end

    subgraph DATA["Data Storage"]
        PG[("PostgreSQL + pgvector<br/>Neon / Render")]
        CLD["Cloudinary<br/>image storage (optional)"]:::future
    end

    RECAP["Google reCAPTCHA"]:::ext

    CAM --> ENR
    CAM --> GATE
    WEB --> API
    DASH --> API
    ENR --> API
    GATE --> API
    API --> AUTH
    AUTH --> RECAP
    API --> ORM
    ORM --> PG
    API -->|"image base64"| FACE
    FACE -->|"512-d vector / match JSON"| API
    FACE -.reads embeddings.-> PG
    YOLO -.-> API
    API -.-> CLD

    classDef future stroke-dasharray: 5 5,opacity:0.55;
    classDef ext fill:#eeeeee,stroke:#999999;
```

**Dashed = future / simulated for this PoC** (YOLO object-detection is a teammate's separate
service; Cloudinary is only needed if photo files are persisted).