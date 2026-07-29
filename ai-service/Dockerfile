# FlowGuard Python AI service (FastAPI + InsightFace + YOLOv8)
# Cloud Run CPU-only image.
#
# Key decisions:
#   - CPU-only PyTorch wheels are installed from:
#       https://download.pytorch.org/whl/cpu
#   - Compatible AI runtime pair:
#       torch==2.13.0
#       torchvision==0.28.0
#   - PyTorch dependencies are kept separately in requirements-torch.txt.
#   - InsightFace 0.7.3 is compiled during the builder stage using the pinned
#     Cython, NumPy and setuptools versions already present in requirements.txt.
#   - The runtime image contains no compiler toolchain.
#   - YOLO and InsightFace run on CPU in Cloud Run.
#   - Models are included/downloaded during image build, not during requests.
#   - No secrets are copied into the image. Runtime secrets come from Cloud Run
#     environment variables and Secret Manager.
#
# Required files:
#   requirements-torch.txt
#   requirements.txt
#   main.py
#   zone_rules.py
#   yolo_service.py
#   yolov8n.pt


# ============================================================
# Builder stage
# ============================================================

FROM python:3.12-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

# InsightFace 0.7.3 must be compiled from source on Linux.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        g++ \
    && rm -rf /var/lib/apt/lists/*

# Keep all installed Python packages in a portable virtual environment.
RUN python -m venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /build

# PyTorch is separated so CPU-only wheels come from the PyTorch CPU index.
COPY requirements-torch.txt requirements.txt ./

# Installation sequence:
#   1. Upgrade packaging tools.
#   2. Install the matching CPU-only PyTorch pair.
#   3. Install all pinned dependencies except InsightFace.
#   4. Compile InsightFace using the already-installed pinned build tools.
#   5. Verify the final dependency graph.
RUN python -m pip install --no-cache-dir --upgrade pip wheel \
    && python -m pip install --no-cache-dir "setuptools==83.0.0" \
    && python -m pip install --no-cache-dir -r requirements-torch.txt \
    && grep -vE '^[[:space:]]*insightface==' requirements.txt \
        > requirements-without-insightface.txt \
    && python -m pip install --no-cache-dir \
        -r requirements-without-insightface.txt \
    && python -m pip install --no-cache-dir \
        --no-build-isolation \
        --no-deps \
        "insightface==0.7.3" \
    && python -m pip check


# ============================================================
# Runtime stage
# ============================================================

FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

# Runtime libraries required by OpenCV, ONNX Runtime and AI packages.
# No compiler toolchain is included in the final image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Run as an unprivileged user.
RUN useradd \
    --create-home \
    --uid 1001 \
    appuser

# Copy only the completed virtual environment from the builder.
COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH" \
    HOME="/home/appuser" \
    YOLO_CONFIG_DIR="/tmp/ultralytics" \
    MPLCONFIGDIR="/tmp/matplotlib" \
    USE_SERVER_CAMERA="false" \
    PYTHONUNBUFFERED="1"

USER appuser
WORKDIR /app

# Prepare writable runtime cache/config directories.
RUN mkdir -p \
    /tmp/ultralytics \
    /tmp/matplotlib

# Download and bake the InsightFace buffalo_l model pack into the image.
# This avoids downloading the model during a Cloud Run cold start.
RUN python -c \
    "from insightface.app import FaceAnalysis; \
    FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider']); \
    print('InsightFace buffalo_l model prepared')"

# Copy only runtime application files.
# .env, .venv, tests and private face images must be excluded by .dockerignore.
COPY --chown=appuser:appuser \
    main.py \
    zone_rules.py \
    yolo_service.py \
    yolov8n.pt \
    ./

# Cloud Run supplies PORT at runtime.
EXPOSE 8080

CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
