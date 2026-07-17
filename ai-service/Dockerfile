# FlowGuard Python AI service (FastAPI + InsightFace + YOLOv8) — Cloud Run image.
#
# Key decisions:
#   - CPU-only PyTorch wheels (download.pytorch.org/whl/cpu): Cloud Run has no
#     GPU here, and the default PyPI torch wheel bundles CUDA (~2+ GB saved).
#     main.py already runs everything on CPU (FACE_CTX_ID=-1 default,
#     onnxruntime CPU provider), so CPU execution support is preserved.
#   - insightface==0.7.3 has no prebuilt Linux wheel — it compiles C++/Cython,
#     hence the build-essential builder stage. The runtime stage ships no
#     compiler toolchain.
#   - Models are baked in at BUILD time, never downloaded per request or per
#     cold start:
#       * yolov8n.pt is copied from the repo (standard COCO weights — contains
#         no personal data);
#       * the InsightFace "buffalo_l" model pack is downloaded once during the
#         build into the app user's ~/.insightface cache.
#   - Listens on the Cloud Run-injected PORT, binds 0.0.0.0, started by
#     uvicorn (the __main__ block's hardcoded 8501 is dev-only and unused here).
#   - USE_SERVER_CAMERA stays false: no physical webcam exists on Cloud Run;
#     frames arrive from the browser via /api/yolo/analyze-frame.
#   - No secrets baked in — DB_*, AI_SERVICE_KEY, NODE_SERVER_URL etc. come
#     from Cloud Run env vars / Secret Manager. .env excluded by .dockerignore.

FROM python:3.12-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential g++ \
    && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /build
COPY requirements.txt .
# CPU torch first (satisfies the torch==2.11.0 / torchvision==0.26.0 pins),
# then the rest of the pinned requirements.
RUN pip install --no-cache-dir torch==2.11.0 torchvision==0.26.0 \
        --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim
# OpenCV (cv2) runtime libraries only — no compilers in the final image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1001 appuser
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    # Writable config/cache dirs for ultralytics + matplotlib on a read-only-ish FS.
    YOLO_CONFIG_DIR=/tmp \
    MPLCONFIGDIR=/tmp/matplotlib \
    USE_SERVER_CAMERA=false \
    PYTHONUNBUFFERED=1

USER appuser
WORKDIR /app

# Bake the InsightFace buffalo_l pack into the image at build time so cold
# starts never download models. (~280 MB into /home/appuser/.insightface)
RUN python -c "from insightface.app import FaceAnalysis; FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])"

# Copy only the application files — never .env, .venv, tests, or face images.
COPY --chown=appuser:appuser main.py zone_rules.py yolo_service.py yolov8n.pt ./

# Documentation only — Cloud Run supplies PORT and routes to it.
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
