import os
import cv2
import numpy as np
import psycopg2
import json
import base64
import threading
import time
from collections import defaultdict
from typing import Optional
import zone_rules
from fastapi import FastAPI, UploadFile, File, HTTPException, Header, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from insightface.app import FaceAnalysis
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

try:
    import requests as http_requests
    _REQUESTS_OK = True
except ImportError:
    _REQUESTS_OK = False
    print("⚠️  'requests' not installed — alert POSTing will be disabled.")

try:
    from ultralytics import YOLO as _YOLO
    _ULTRALYTICS_AVAILABLE = True
except Exception as _yolo_import_err:
    _YOLO = None
    _ULTRALYTICS_AVAILABLE = False
    print(f"⚠️  Ultralytics YOLO not available: {_yolo_import_err}")


def _load_yolo_model(path, label):
    if not _ULTRALYTICS_AVAILABLE:
        return None
    try:
        model = _YOLO(path)
        print(f"{label} YOLO Engine Loaded: {path}")
        return model
    except Exception as err:
        print(f"{label} YOLO model not available ({path}): {err}")
        return None


_YOLO_MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "yolov8n.pt")
_YOLO_WEBCAM_MODEL_PATH = os.getenv("YOLO_WEBCAM_MODEL_PATH", "").strip()
_yolo_model = _load_yolo_model(_YOLO_MODEL_PATH, "Default")
_yolo_webcam_model = (
    _load_yolo_model(_YOLO_WEBCAM_MODEL_PATH, "Webcam")
    if _YOLO_WEBCAM_MODEL_PATH
    else None
)
YOLO_AVAILABLE = _yolo_model is not None or _yolo_webcam_model is not None

app = FastAPI()

# --- Service-to-service authentication -------------------------------------
# The Node backend (and only the Node backend) may call the AI endpoints. It sends
# the shared secret in an X-AI-Service-Key header.
# For local development the key may be left unset (a warning is printed and the
# check is skipped) — never deploy without AI_SERVICE_KEY configured.
_AI_SERVICE_KEY = os.getenv("AI_SERVICE_KEY", "")
if not _AI_SERVICE_KEY:
    print("⚠️  AI_SERVICE_KEY not set — face endpoints are UNPROTECTED (dev mode only).")

def require_service_key(x_ai_service_key: str = Header(default=None, alias="X-AI-Service-Key")):
    if not _AI_SERVICE_KEY:
        return  # dev mode — no key configured
    if x_ai_service_key != _AI_SERVICE_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing AI service key.")

# 1. Initialize AI
print("Loading InsightFace Engine...")
_FACE_MODEL_NAME = os.getenv("FACE_MODEL_NAME", "buffalo_l")
_FACE_DET_SIZE = int(os.getenv("FACE_DET_SIZE", "320"))
_FACE_CTX_ID = int(os.getenv("FACE_CTX_ID", "-1"))
face_app = FaceAnalysis(name=_FACE_MODEL_NAME)
face_app.prepare(ctx_id=_FACE_CTX_ID, det_size=(_FACE_DET_SIZE, _FACE_DET_SIZE))
print(f"InsightFace ready: {_FACE_MODEL_NAME}, det_size={_FACE_DET_SIZE}, ctx_id={_FACE_CTX_ID}")


@app.get("/health")
async def health():
    """Safe Cloud Run health response; no credentials, paths, or camera access."""
    return {
        "status": "ok",
        "face_model_ready": face_app is not None,
        "yolo_model_ready": bool(YOLO_AVAILABLE),
        "yolo_default_model_ready": bool(_yolo_model is not None),
        "yolo_webcam_model_ready": bool(_yolo_webcam_model is not None),
        "server_camera_enabled": os.getenv("USE_SERVER_CAMERA", "false").lower() == "true",
    }

# 2. Database Connection Helper
def get_db_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT", "5432"),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PWD")
    )

# 3. Memory bank for the "Security Scan"
#
# The cache is replaced only after a successful database read. A temporary
# Cloud SQL error must not erase an already-working cache and make every person
# appear as an unknown 0% match.
known_faces = []
_known_faces_lock = threading.Lock()
_face_cache_last_attempt = 0.0
_FACE_CACHE_RETRY_SECONDS = float(os.getenv("FACE_CACHE_RETRY_SECONDS", "15"))
_FACE_MATCH_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD", "0.45"))


@app.on_event("startup")
def load_authorized_faces():
    """Load normalized enrolled-user embeddings from PostgreSQL.

    Returns the number of usable templates. Invalid/empty vectors are skipped,
    and the active cache is swapped atomically only after the query succeeds.
    """
    global known_faces, _face_cache_last_attempt
    _face_cache_last_attempt = time.time()
    conn = None
    cur = None

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            'SELECT id, name, "faceVector" FROM users '
            'WHERE "isEnrolled" = TRUE AND "faceVector" IS NOT NULL'
        )
        rows = cur.fetchall()
        loaded_faces = []

        for user_id, name, embedding_json in rows:
            raw_embedding = json.loads(embedding_json) if isinstance(embedding_json, str) else embedding_json
            embedding = np.asarray(raw_embedding, dtype=np.float32).reshape(-1)
            norm = float(np.linalg.norm(embedding))

            if embedding.size == 0 or not np.isfinite(embedding).all() or norm <= 0:
                print(f"⚠️  Skipping invalid face template for user #{user_id}.")
                continue

            loaded_faces.append({
                "user_id": user_id,
                "name": name,
                "embedding": embedding / norm,
            })

        with _known_faces_lock:
            known_faces = loaded_faces

        print(f"✅ Security Scan Ready: {len(loaded_faces)} enrolled members loaded.")
        return len(loaded_faces)
    except Exception as e:
        # Keep the previous good cache instead of replacing it with [].
        print(f"❌ DB Load Error: {e}")
        with _known_faces_lock:
            return len(known_faces)
    finally:
        if cur is not None:
            cur.close()
        if conn is not None:
            conn.close()


def _known_faces_snapshot():
    """Return a stable copy for one recognition request."""
    with _known_faces_lock:
        return list(known_faces)


def _ensure_face_cache():
    """Retry an empty cache without hammering Cloud SQL on every frame."""
    with _known_faces_lock:
        cache_ready = bool(known_faces)

    if cache_ready:
        return True

    if time.time() - _face_cache_last_attempt >= _FACE_CACHE_RETRY_SECONDS:
        load_authorized_faces()

    with _known_faces_lock:
        return bool(known_faces)


# --- Phase 2 - Biometric Enrollment Endpoint ---

class FaceImages(BaseModel):
    front: str
    left: str
    right: str

def base64_to_cv2(base64_string):
    """Helper to convert React's Base64 image into OpenCV format"""
    if ',' in base64_string:
        encoded_data = base64_string.split(',')[1]
    else:
        encoded_data = base64_string

    nparr = np.frombuffer(base64.b64decode(encoded_data), np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)

@app.post("/api/encode-faces", dependencies=[Depends(require_service_key)])
async def encode_faces(images: FaceImages):
    """Takes 3 images from React, extracts vectors, and averages them."""
    try:
        vectors = []
        
        for img_str in [images.front, images.left, images.right]:
            img = base64_to_cv2(img_str)
            faces = face_app.get(img)
            
            if len(faces) == 0:
                raise HTTPException(status_code=400, detail="No face detected in one of the images.")
            if len(faces) > 1:
                raise HTTPException(status_code=400, detail="Multiple faces detected. Please ensure you are alone.")
                
            vectors.append(faces[0].embedding)
            
        avg_vector = np.mean(vectors, axis=0)
        avg_vector = avg_vector / np.linalg.norm(avg_vector)
        
        return {"status": "success", "vector": avg_vector.tolist()}

    except HTTPException:
        # Re-raise intentional client errors (e.g. 400 "No face detected") unchanged,
        # so the broad handler below does not convert them into a 500.
        raise
    except Exception as e:
        # Unexpected failure — log the real error for developers, return a safe message.
        print(f"Encode Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to process facial images.")


# CORS: the frontend no longer calls the AI endpoints directly (they go through
# the Node backend), including the YOLO endpoints that were once browser-fetched in
# development. Origins are restricted to an env-configured allowlist — never a
# wildcard combined with credentials.
_allowed_origins = [
    o.strip() for o in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Phase 3 - The CCTV Scan Endpoint (With Head Turn Liveness) ---

def calculate_head_turn(kps):
    """Calculates 3D head turn ratio using the 5 major facial keypoints"""
    if kps is None or len(kps) < 3:
        return 0.5 # 0.5 means looking perfectly straight ahead

    left_eye = kps[0]
    right_eye = kps[1]
    nose = kps[2]

    # Measure the horizontal distance from the nose to each eye
    dist_left = abs(nose[0] - left_eye[0])
    dist_right = abs(right_eye[0] - nose[0])
    
    total_dist = dist_left + dist_right
    if total_dist == 0: return 0.5

    return float(dist_left / total_dist)

class RecognitionRequest(BaseModel):
    image: str

@app.post("/user/recognize", dependencies=[Depends(require_service_key)])
async def recognize(request: RecognitionRequest):
    """Matches a temporary frame against the known-face cache and returns ONLY the
    matched user ID + biometric telemetry. Role, account status, and the access
    decision are resolved by the Node backend from PostgreSQL — the database is
    the source of truth, not this cache."""
    try:
        header, encoded = request.image.split(",", 1)
        data = base64.b64decode(encoded)
        nparr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid image data")

    # Development telemetry: inference duration only — never images/templates.
    _inference_started = time.time()
    live_faces = face_app.get(img)
    inference_ms = int((time.time() - _inference_started) * 1000)

    if not live_faces:
        return {
            "matchedUserId": None,
            "confidence": 0.0,
            "box": None,
            "liveness_ratio": 0.5,
            "faceDetected": False,
            "registry_ready": _ensure_face_cache(),
            "enrolled_face_count": len(_known_faces_snapshot()),
            "inference_ms": inference_ms,
        }

    # Retry an empty/stale startup cache before classifying a detected face.
    registry_ready = _ensure_face_cache()
    face_registry = _known_faces_snapshot()

    # Prefer the largest face in-frame. InsightFace's returned order is not a
    # promise, and choosing a small/background face can produce an incorrect
    # unknown result even when the intended subject is centred.
    face = max(
        live_faces,
        key=lambda item: max(0.0, float(item.bbox[2] - item.bbox[0]))
        * max(0.0, float(item.bbox[3] - item.bbox[1]))
    )

    best_match = None
    highest_similarity = 0.0
    live_norm = float(np.linalg.norm(face.embedding))
    live_embedding = face.embedding / live_norm if live_norm > 0 else face.embedding

    for known in face_registry:
        sim = float(np.dot(live_embedding, known["embedding"]))
        if sim > highest_similarity:
            highest_similarity = sim
            best_match = known if sim >= _FACE_MATCH_THRESHOLD else None

    bbox = face.bbox
    x = int(bbox[0])
    y = int(bbox[1])
    width = int(bbox[2] - bbox[0])
    height = int(bbox[3] - bbox[1])
    liveness_ratio = calculate_head_turn(face.kps)

    # Name stays in the developer log only — never in the response.
    if best_match:
        print(
            f"Recognize: matched user #{best_match['user_id']} "
            f"({best_match['name']}) sim={highest_similarity:.3f}"
        )
    elif registry_ready:
        print(
            f"Recognize: unknown face, best similarity={highest_similarity:.3f}, "
            f"threshold={_FACE_MATCH_THRESHOLD:.3f}, templates={len(face_registry)}"
        )
    else:
        print("Recognize: face detected but the enrolled-face registry is empty.")

    return {
        "matchedUserId": best_match["user_id"] if best_match else None,
        "confidence": round(max(0.0, highest_similarity), 4),
        "box": [x, y, width, height],
        "liveness_ratio": liveness_ratio,
        "faceDetected": True,
        "registry_ready": registry_ready,
        "enrolled_face_count": len(face_registry),
        "inference_ms": inference_ms,
    }


# --- Lightweight face tracking (detection + keypoints ONLY, no identity) ----
# Powers the scanners' real-time face box + head-turn movement sampling. It
# reuses InsightFace's already-loaded detector at a smaller input size and
# NEVER runs the embedding model, matches identities, touches the database,
# or persists the frame. Safe transient telemetry only.
_TRACK_DET_SIZE = int(os.getenv("TRACK_DET_SIZE", "256"))
_TRACK_MAX_FACES = 2

_NO_FACE_TRACK = {"faceDetected": False, "faceCount": 0, "box": None, "headTurnRatio": None}


@app.post("/user/track", dependencies=[Depends(require_service_key)])
async def track(request: RecognitionRequest):
    try:
        header, encoded = request.image.split(",", 1)
        data = base64.b64decode(encoded)
        nparr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("decode failed")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image data")

    det_model = face_app.models.get("detection")
    if det_model is None:
        raise HTTPException(status_code=503, detail="Face detector unavailable.")

    _detect_started = time.time()
    bboxes, kpss = det_model.detect(
        img,
        input_size=(_TRACK_DET_SIZE, _TRACK_DET_SIZE),
        max_num=_TRACK_MAX_FACES,
        metric="default",
    )
    inference_ms = int((time.time() - _detect_started) * 1000)

    if bboxes is None or len(bboxes) == 0:
        return {**_NO_FACE_TRACK, "inferenceMs": inference_ms}

    # Largest face is the primary tracking subject.
    areas = [(b[2] - b[0]) * (b[3] - b[1]) for b in bboxes]
    primary = int(np.argmax(areas))
    x1, y1, x2, y2 = bboxes[primary][:4]

    head_turn_ratio = None
    if kpss is not None and len(kpss) > primary:
        head_turn_ratio = calculate_head_turn(kpss[primary])

    return {
        "faceDetected": True,
        "faceCount": int(len(bboxes)),
        "box": [int(x1), int(y1), int(x2 - x1), int(y2 - y1)],
        "headTurnRatio": head_turn_ratio,
        "inferenceMs": inference_ms,
    }


# Helper to refresh the list manually if a new staff joins
@app.get("/refresh", dependencies=[Depends(require_service_key)])
def refresh():
    loaded = load_authorized_faces()
    return {
        "message": "Staff list updated from database",
        "enrolled_face_count": loaded,
        "registry_ready": loaded > 0,
    }


# ============================================================
# SMART LOGISTICS — CLOUD QR SNAPSHOT DECODE (candidate only)
# ============================================================
# Authenticated OpenCV QR decoder used as the SNAPSHOT fallback when the
# browser/Raspberry Pi laptop-webcam scanner can't lock a QR locally. It returns
# a CANDIDATE FlowGuard booking reference ONLY — it never verifies the booking,
# approves entry/exit, updates booking status, writes GateAccessLog, or opens a
# barrier. The Node gate-verification endpoint remains authoritative.
#
# Input: one base64 JPEG/PNG still (data-URL) via the project's existing
# authenticated image-payload convention (same shape as /user/recognize). The
# image is decoded in memory and never persisted to disk, the repository, or
# Cloud Run storage; raw image bytes are never logged.

import re

_QR_BOOKING_REF_RE = re.compile(r"^FG-[A-Z0-9]{4,12}$")

# Strict request-size cap (bytes of the decoded image). Overridable per-deploy.
_QR_MAX_IMAGE_BYTES = int(os.getenv("QR_MAX_IMAGE_BYTES", str(6 * 1024 * 1024)))
_QR_ALLOWED_CONTENT_TYPES = {
    t.strip().lower()
    for t in os.getenv("QR_ALLOWED_CONTENT_TYPES", "image/jpeg,image/jpg,image/png").split(",")
    if t.strip()
}


class QRDecodeRequest(BaseModel):
    image: str


def _normalize_booking_ref(raw):
    return re.sub(r"\s+", "", str(raw or "")).upper()


def _decode_qr_candidate(img):
    """Bounded OpenCV QR-decode sequence: original → grayscale → upscale-if-small
    → Otsu threshold. Returns the first non-empty decoded string, or "". Stops as
    soon as anything decodes; deliberately avoids expensive brute-forcing."""
    detector = cv2.QRCodeDetector()

    def _try(mat):
        try:
            data, _points, _straight = detector.detectAndDecode(mat)
            if data:
                return data
            # A frame can hold more than one code — cheap multi pass as a backup.
            ok, decoded, _pts, _straight = detector.detectAndDecodeMulti(mat)
            if ok and decoded:
                for d in decoded:
                    if d:
                        return d
        except cv2.error:
            return ""
        return ""

    # 1. Original colour image.
    data = _try(img)
    if data:
        return data
    # 2. Grayscale.
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    data = _try(gray)
    if data:
        return data
    # 3. Upscale small stills (preserve aspect ratio) — helps a low-res webcam frame.
    h, w = gray.shape[:2]
    longest = max(h, w)
    if longest and longest < 640:
        scale = 640.0 / longest
        resized = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)
        data = _try(resized)
        if data:
            return data
    # 4. Otsu threshold (single safe pass).
    _t, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return _try(thresh)


@app.post("/api/qr/decode", dependencies=[Depends(require_service_key)])
async def decode_qr(request: QRDecodeRequest):
    """Decode a QR still into a CANDIDATE FlowGuard booking reference. This
    endpoint is intentionally powerless: it cannot verify a booking, grant or
    deny access, mutate booking status, write GateAccessLog, or open a barrier —
    it only reports what reference (if any) the image appears to contain."""
    started = time.time()

    raw = request.image or ""
    # Reject an oversized payload before any decode work. Base64 expands bytes
    # ~4/3, so bound the string length against the byte cap first.
    if len(raw) > int(_QR_MAX_IMAGE_BYTES * 4 / 3) + 1024:
        raise HTTPException(status_code=413, detail="Image exceeds the maximum allowed size.")

    # Validate the declared content type when a data-URL header is present.
    if raw.startswith("data:"):
        try:
            mime = raw[5:raw.index(";")].lower()
        except ValueError:
            raise HTTPException(status_code=400, detail="Malformed image payload.")
        if mime not in _QR_ALLOWED_CONTENT_TYPES:
            raise HTTPException(status_code=415, detail="Unsupported image type. Use JPEG or PNG.")

    # Decode base64 → bytes. There is no supplied filename to trust.
    try:
        encoded = raw.split(",", 1)[1] if "," in raw else raw
        img_bytes = base64.b64decode(encoded)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image data.")

    if not img_bytes:
        raise HTTPException(status_code=400, detail="Invalid image data.")
    if len(img_bytes) > _QR_MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the maximum allowed size.")

    # Decode bytes → OpenCV image; reject malformed images.
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Malformed or unreadable image.")

    try:
        raw_text = _decode_qr_candidate(img)
    except HTTPException:
        raise
    except Exception as e:
        # Log the error class only — never the image bytes.
        print(f"QR decode error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail="Failed to decode the QR image.")

    decode_ms = int((time.time() - started) * 1000)
    candidate = _normalize_booking_ref(raw_text)

    if raw_text and _QR_BOOKING_REF_RE.match(candidate):
        return {
            "success": True,
            "bookingRef": candidate,
            "decodeMs": decode_ms,
            "decoder": "opencv-cloud",
        }
    return {
        "success": False,
        "bookingRef": None,
        "decodeMs": decode_ms,
        "decoder": "opencv-cloud",
        "message": "No valid FlowGuard QR code detected",
    }


# ============================================================
# YOLO OBJECT DETECTION — Module 2
# ============================================================

_UNATTENDED_CLASSES = {
    'bottle', 'cup', 'book', 'backpack', 'handbag',
    'suitcase', 'cell phone', 'laptop', 'bag'
}
_FOOD_CLASSES = {'banana', 'apple', 'orange'}
_VEHICLE_CLASSES = {'truck'}
_PEST_CLASSES = {'rat', 'mouse'}
_DEFAULT_RESTRICTED_MOTION_CLASSES = {'person', 'cat', 'dog', 'rat', 'mouse'}
# COCO ids: 0 person, 7 truck, 24 backpack, 26 handbag, 28 suitcase, 39 bottle,
# 41 cup, 46 banana, 47 apple, 49 orange, 63 laptop, 67 cell phone, 73 book
_YOLO_CLASS_IDS_RAW = os.getenv("YOLO_CLASS_IDS", "").strip().lower()
if _YOLO_CLASS_IDS_RAW in {"", "all", "*"}:
    _YOLO_CLASS_IDS = None
else:
    _YOLO_CLASS_IDS = [
        int(x.strip()) for x in _YOLO_CLASS_IDS_RAW.split(",") if x.strip()
    ] or None
_YOLO_WEBCAM_CLASS_IDS_RAW = os.getenv("YOLO_WEBCAM_CLASS_IDS", "").strip().lower()
if _YOLO_WEBCAM_CLASS_IDS_RAW in {"", "all", "*"}:
    _YOLO_WEBCAM_CLASS_IDS = None
else:
    _YOLO_WEBCAM_CLASS_IDS = [
        int(x.strip()) for x in _YOLO_WEBCAM_CLASS_IDS_RAW.split(",") if x.strip()
    ] or None

_CAMERA_WIDTH = int(os.getenv("CAMERA_WIDTH", "640"))
_CAMERA_HEIGHT = int(os.getenv("CAMERA_HEIGHT", "360"))
# Slightly larger inference input + lower threshold help retain small office
# objects (monitor/TV, chair, bottle, laptop, keyboard, mouse) in compressed
# browser/video frames while staying practical for CPU-only Cloud Run.
_YOLO_IMG_SIZE = int(os.getenv("YOLO_IMG_SIZE", "768"))
_YOLO_CONFIDENCE = float(os.getenv("YOLO_CONFIDENCE", "0.18"))
_YOLO_WEBCAM_CONFIDENCE = float(os.getenv("YOLO_WEBCAM_CONFIDENCE", str(_YOLO_CONFIDENCE)))
_YOLO_FPS = float(os.getenv("YOLO_FPS", "8"))
_STREAM_FPS = float(os.getenv("STREAM_FPS", "12"))
_FACE_RECOG_EVERY_N_FRAMES = int(os.getenv("FACE_RECOG_EVERY_N_FRAMES", "5"))
_FACE_RECOG_MAX_PEOPLE = int(os.getenv("FACE_RECOG_MAX_PEOPLE", "2"))
_PERSON_CRITICAL_COUNT = int(os.getenv("PERSON_CRITICAL_COUNT", "2"))
_PERSON_ALERT_COOLDOWN = int(os.getenv("PERSON_ALERT_COOLDOWN", "30"))
_PEST_ALERT_COOLDOWN = int(os.getenv("PEST_ALERT_COOLDOWN", "30"))
_RESTRICTED_MOTION_ALERT_COOLDOWN = int(os.getenv("RESTRICTED_MOTION_ALERT_COOLDOWN", "60"))
_RESTRICTED_AFTER_HOURS_MOTION_ENABLED = os.getenv("RESTRICTED_AFTER_HOURS_MOTION_ENABLED", "true").lower() == "true"
_AFTER_HOURS_START = os.getenv("EDGE_AFTER_HOURS_START", os.getenv("RESTRICTED_AFTER_HOURS_START", "19:00"))
_AFTER_HOURS_END = os.getenv("EDGE_AFTER_HOURS_END", os.getenv("RESTRICTED_AFTER_HOURS_END", "07:00"))
_RESTRICTED_MOTION_CLASSES_RAW = os.getenv("RESTRICTED_MOTION_CLASSES", "").strip()
_RESTRICTED_MOTION_CLASSES = (
    {item.strip().lower() for item in _RESTRICTED_MOTION_CLASSES_RAW.split(",") if item.strip()}
    if _RESTRICTED_MOTION_CLASSES_RAW
    else set(_DEFAULT_RESTRICTED_MOTION_CLASSES)
)
_PROXIMITY_PX = 160      # centroid distance threshold (pixels at 640-wide frame)
_TRACK_MATCH_DISTANCE_PX = int(os.getenv("PERSON_TRACK_MATCH_DISTANCE_PX", "90"))
_TRACK_TTL_SECONDS = float(os.getenv("PERSON_TRACK_TTL_SECONDS", "8"))
_NODE_URL = os.getenv("NODE_SERVER_URL", "http://localhost:5001")
print(
    "YOLO config: "
    f"imgsz={_YOLO_IMG_SIZE}, conf={_YOLO_CONFIDENCE}, "
    f"webcam_conf={_YOLO_WEBCAM_CONFIDENCE}, "
    f"classes={_YOLO_CLASS_IDS if _YOLO_CLASS_IDS is not None else 'ALL'}, "
    f"webcam_classes={_YOLO_WEBCAM_CLASS_IDS if _YOLO_WEBCAM_CLASS_IDS is not None else 'ALL'}"
)

# A browser-submitted analyse-frame request may only claim to be one of these two
# sources — never "SecurePi Edge Node", which is reserved for the authenticated
# EDGE_INGEST_TOKEN route in server/routes/edgeDetectionAlerts.js. Keep in sync with
# client/src/pages/ObjectDetection.jsx's ALERT_SOURCE_BY_MODE.
_ALLOWED_BROWSER_SOURCES = {"Browser Webcam", "Uploaded Video"}


def _normalize_browser_source(source):
    """Whitelists a browser-supplied analyse-frame source; anything else (missing,
    unrecognized, or an impersonation attempt) resolves to None so the Node alert
    route falls back to its own default instead of trusting arbitrary client text."""
    return source if source in _ALLOWED_BROWSER_SOURCES else None


def _select_yolo_for_source(source):
    """Use the optional custom checkpoint only for browser webcam frames.

    Uploaded video keeps the default COCO YOLO model so demos retain the richer
    bottle/cup/book/laptop/etc. coverage.
    """
    if source == "Browser Webcam" and _yolo_webcam_model is not None:
        return _yolo_webcam_model, _YOLO_WEBCAM_CLASS_IDS, _YOLO_WEBCAM_CONFIDENCE
    return _yolo_model, _YOLO_CLASS_IDS, _YOLO_CONFIDENCE

# Shared state written by detection thread, read by endpoints
_frame_lock = threading.Lock()
_latest_frame = None
_people_count = 0
_detection_active = False
_camera_status = "starting"

# Unattended object tracker
# key: (grid_x, grid_y, class_name)  — centroid snapped to 50 px grid for stability
# value: {person_last_seen, unattended_since, alerted}
_tracked_objects: dict = {}
_person_name_cache = defaultdict(lambda: ("UNKNOWN", 0.0))
_person_alert_state = {
    "level": None,
    "last_sent_at": 0.0,
}
_pest_alert_state = defaultdict(float)
_restricted_motion_alert_state = defaultdict(float)
_person_track_state = {
    "next_id": 1,
    "tracks": {},
}

# Zone threshold cache — refreshed from DB every 60 s
_zone_threshold_sec = 300   # default 5 min
_zone_name_cache = "Zone A"
_zone_density_cache = None   # zone's configured max-occupancy rule, None = unset
_threshold_fetched_at = 0.0
_THRESHOLD_TTL = 60


def _make_status_frame(message, detail=""):
    frame = np.zeros((_CAMERA_HEIGHT, _CAMERA_WIDTH, 3), dtype=np.uint8)
    cv2.putText(frame, message, (28, max(70, _CAMERA_HEIGHT // 2 - 20)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 220, 255), 2)
    if detail:
        cv2.putText(frame, detail, (28, max(110, _CAMERA_HEIGHT // 2 + 20)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (170, 170, 170), 1)
    return frame


def _is_usable_frame(frame):
    if frame is None or frame.size == 0:
        return False
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return float(gray.mean()) > 6.0 and float(gray.std()) > 2.0


def _open_camera():
    camera_index = int(os.getenv("CAMERA_INDEX", "0"))
    indexes = [camera_index] + [i for i in range(3) if i != camera_index]
    backends = [cv2.CAP_DSHOW, cv2.CAP_MSMF, 0]

    for index in indexes:
        for backend in backends:
            cap = cv2.VideoCapture(index, backend) if backend else cv2.VideoCapture(index)
            if not cap.isOpened():
                cap.release()
                continue

            cap.set(cv2.CAP_PROP_FRAME_WIDTH, _CAMERA_WIDTH)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, _CAMERA_HEIGHT)
            cap.set(cv2.CAP_PROP_FPS, _YOLO_FPS)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

            for _ in range(5):
                cap.read()

            ret, frame = cap.read()
            if ret and _is_usable_frame(frame):
                print(f"Camera opened: index={index}, backend={backend or 'default'}")
                return cap

            cap.release()

    return None


def _refresh_zone_info():
    global _zone_threshold_sec, _zone_name_cache, _zone_density_cache, _threshold_fetched_at
    now = time.time()
    if now - _threshold_fetched_at < _THRESHOLD_TTL:
        return _zone_threshold_sec, _zone_name_cache, _zone_density_cache
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT zone_name, time_threshold, unattended_threshold_seconds, density_threshold
            FROM monitoring_zones
            WHERE "deletedAt" IS NULL
            ORDER BY time_threshold ASC
            LIMIT 1
        """)
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row:
            _zone_name_cache = row[0]
            # Detection Setup's seconds-based threshold takes precedence when configured;
            # otherwise fall back to the legacy minutes-based time_threshold.
            _zone_threshold_sec = row[2] if row[2] is not None else int(row[1]) * 60
            _zone_density_cache = row[3]
    except Exception as e:
        print(f"Zone info fetch error: {e}")
    _threshold_fetched_at = now
    return _zone_threshold_sec, _zone_name_cache, _zone_density_cache


def _fetch_camera_zone_id(camera_id):
    """(found, zone_id) — found=False means no such (non-deleted) camera row."""
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            'SELECT zone_id FROM cameras WHERE id = %s AND "deletedAt" IS NULL',
            (camera_id,)
        )
        row = cur.fetchone()
        cur.close()
        if row is None:
            return False, None
        return True, row[0]
    finally:
        conn.close()


def _fetch_zone_row(zone_id):
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, zone_name, time_threshold, unattended_threshold_seconds, detection_enabled,
                   density_threshold
            FROM monitoring_zones
            WHERE id = %s AND "deletedAt" IS NULL
            """,
            (zone_id,)
        )
        row = cur.fetchone()
        cur.close()
        return row
    finally:
        conn.close()


def resolve_zone_for_request(camera_id=None, zone_id=None):
    """Resolves the exact Detection Setup rule for a selected camera/zone.

    Thin DB-backed wrapper around zone_rules.resolve_zone_config (the actual branching
    logic, unit tested in isolation — see ai-service/tests/test_zone_resolution.py).
    When neither id is given, falls back to the legacy global-smallest-threshold cache
    (_refresh_zone_info) so callers that never send an id (e.g. the background
    webcam-loop thread) keep their old behaviour.
    """
    if camera_id is None and zone_id is None:
        threshold_sec, zone_name, density_threshold = _refresh_zone_info()
        return {
            "applied_camera_id": None,
            "applied_zone_id": None,
            "applied_zone_name": zone_name,
            "applied_threshold_seconds": threshold_sec,
            "applied_density_threshold": density_threshold,
            "detection_enabled": True,
            "zone_error": None,
        }

    try:
        return zone_rules.resolve_zone_config(camera_id, zone_id, _fetch_camera_zone_id, _fetch_zone_row)
    except Exception as e:
        print(f"Zone resolution error: {e}")
        return zone_rules.error_config(camera_id, zone_id, "lookup_failed")


def _get_nearby_person(person_entries, ox, oy):
    """Returns (is_nearby, person_name) for the first person within _PROXIMITY_PX."""
    for box, pname in person_entries:
        px = (box[0] + box[2]) / 2
        py = (box[1] + box[3]) / 2
        if ((px - ox) ** 2 + (py - oy) ** 2) ** 0.5 < _PROXIMITY_PX:
            return True, pname
    return False, None


def _parse_hhmm(value, fallback):
    raw = str(value or fallback).strip()
    try:
        hour, minute = raw.split(":", 1)
        hour = int(hour)
        minute = int(minute)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour * 60 + minute
    except Exception:
        pass
    fallback_hour, fallback_minute = fallback.split(":", 1)
    return int(fallback_hour) * 60 + int(fallback_minute)


def _is_after_hours_now():
    start = _parse_hhmm(_AFTER_HOURS_START, "19:00")
    end = _parse_hhmm(_AFTER_HOURS_END, "07:00")
    now = time.localtime()
    minutes = now.tm_hour * 60 + now.tm_min
    if start == end:
        return True
    if start < end:
        return start <= minutes < end
    return minutes >= start or minutes < end


def _motion_key(class_name, zone_name, track_id=None, cx=None, cy=None):
    if track_id is not None:
        subject = f"track:{track_id}"
    elif cx is not None and cy is not None:
        subject = f"cell:{cx // 100 * 100}:{cy // 100 * 100}"
    else:
        subject = "zone"
    return (str(zone_name or "").lower(), str(class_name or "").lower(), subject)


def _maybe_fire_restricted_motion_alert(class_name, zone_name, source, conf, person_name=None, track_id=None, cx=None, cy=None):
    if source == "Browser Webcam":
        # Browser Webcam Restricted-Zone Motion MUST be sensor-gated on frontend using Pi telemetry
        return
    if not _RESTRICTED_AFTER_HOURS_MOTION_ENABLED:
        return
    normalized_class = str(class_name or "").lower()
    if normalized_class not in _RESTRICTED_MOTION_CLASSES:
        return
    if not _is_after_hours_now():
        return

    key = _motion_key(normalized_class, zone_name, track_id, cx, cy)
    now = time.time()
    if now - _restricted_motion_alert_state[key] < _RESTRICTED_MOTION_ALERT_COOLDOWN:
        return

    _restricted_motion_alert_state[key] = now
    threading.Thread(
        target=_fire_alert,
        args=(normalized_class, zone_name, None, person_name, "Critical", source, "Restricted-Zone Motion", conf),
        daemon=True
    ).start()


def _assign_person_track(box, now):
    x1, y1, x2, y2 = box
    cx = (x1 + x2) / 2
    cy = (y1 + y2) / 2
    tracks = _person_track_state["tracks"]
    expired = [
        track_id for track_id, track in tracks.items()
        if now - track["last_seen"] > _TRACK_TTL_SECONDS
    ]
    for track_id in expired:
        tracks.pop(track_id, None)
        _person_name_cache.pop(track_id, None)

    best_id = None
    best_distance = None
    for track_id, track in tracks.items():
        distance = ((track["cx"] - cx) ** 2 + (track["cy"] - cy) ** 2) ** 0.5
        if distance <= _TRACK_MATCH_DISTANCE_PX and (best_distance is None or distance < best_distance):
            best_id = track_id
            best_distance = distance

    if best_id is None:
        best_id = _person_track_state["next_id"]
        _person_track_state["next_id"] += 1

    tracks[best_id] = {"cx": cx, "cy": cy, "box": box, "last_seen": now}
    return best_id


def _fire_alert(class_name, zone_name, duration_sec, person_name=None, severity=None, source=None, alert_type=None, confidence=None):
    if not _REQUESTS_OK:
        return
    try:
        payload = {
            "zone_name": zone_name,
            "camera_location": os.getenv("AI_CAMERA_LOCATION", "Webcam Feed"),
            "status": "Active",
            "object_class": class_name,
            "duration_seconds": duration_sec,
            "person_name": person_name,
            "severity": severity
        }
        if source:
            payload["source"] = source
        if alert_type:
            payload["alert_type"] = alert_type
        if confidence is not None:
            payload["confidence"] = round(float(confidence), 3)
        res = http_requests.post(
            f"{_NODE_URL}/api/detection-alerts",
            json=payload,
            headers={"x-service-key": os.getenv("AI_SERVICE_KEY", "")},
            timeout=5
        )
        if 200 <= res.status_code < 300:
            duration_str = f" unattended {duration_sec}s" if duration_sec is not None else ""
            person_str = f" (last seen: {person_name})" if person_name else ""
            print(f"🚨 Alert sent: {class_name}{duration_str} in {zone_name}{person_str}")
        else:
            print(f"[DetectionAlert] POST rejected HTTP {res.status_code}")
    except Exception as e:
        print(f"[DetectionAlert] POST failed: {e}")


def _maybe_fire_person_alert(person_count, zone_name, source=None, density_threshold=None):
    """Create one warning/critical alert per cooldown window based on detected people.

    density_threshold is the zone's own Detection Setup "Density threshold" (max
    occupancy) rule; falls back to the global PERSON_CRITICAL_COUNT default when the
    zone has none configured.
    """
    if person_count <= 0:
        _person_alert_state["level"] = None
        return

    critical_count = density_threshold if density_threshold is not None else _PERSON_CRITICAL_COUNT
    now = time.time()
    level = "Critical" if person_count >= critical_count else "Warning"
    recently_sent = now - _person_alert_state["last_sent_at"] < _PERSON_ALERT_COOLDOWN
    if recently_sent and _person_alert_state["level"] == level:
        return

    _person_alert_state["level"] = level
    _person_alert_state["last_sent_at"] = now
    label = (
        f"{level}: {person_count} People Detected"
        if person_count > 1
        else f"{level}: Person Detected"
    )
    severity = "Critical" if level == "Critical" else "Medium"
    threading.Thread(
        target=_fire_alert,
        args=(label, zone_name, None, None, severity, source),
        daemon=True
    ).start()


def _maybe_fire_pest_alert(class_name, zone_name, source, conf, cx, cy):
    now = time.time()
    key = (class_name, cx // 100 * 100, cy // 100 * 100)
    if now - _pest_alert_state[key] < _PEST_ALERT_COOLDOWN:
        return

    _pest_alert_state[key] = now
    threading.Thread(
        target=_fire_alert,
        args=(class_name, zone_name, None, None, "High", source, "Pest Detection", conf),
        daemon=True
    ).start()


def _recognize_person_crop(frame, x1, y1, x2, y2):
    fh, fw = frame.shape[:2]
    crop = frame[max(y1, 0):min(y2, fh), max(x1, 0):min(x2, fw)]
    if crop.size == 0:
        return "UNKNOWN", 0.0

    try:
        faces = face_app.get(crop)
        if not faces:
            return "UNKNOWN", 0.0

        live_emb = faces[0].embedding
        live_emb = live_emb / np.linalg.norm(live_emb)
        best_sim, best_name = 0.0, "UNKNOWN"
        for known in known_faces:
            sim = float(np.dot(live_emb, known["embedding"]))
            if sim > best_sim:
                best_sim = sim
                if sim > 0.45:
                    best_name = known["name"]
        return best_name, best_sim
    except Exception:
        return "UNKNOWN", 0.0


def _annotate_detection_frame(frame, recognize_faces=True, zone_config=None, source=None):
    global _people_count, _tracked_objects

    if not YOLO_AVAILABLE:
        return frame, 0, []

    yolo_model, yolo_class_ids, yolo_confidence = _select_yolo_for_source(source)
    if yolo_model is None:
        return frame, 0, []

    results = yolo_model(
        frame,
        imgsz=_YOLO_IMG_SIZE,
        conf=yolo_confidence,
        iou=0.45,
        classes=yolo_class_ids,
        verbose=False
    )[0]
    if zone_config is None:
        # No camera/zone id supplied (e.g. the background webcam-loop thread) — keep the
        # legacy global-smallest-threshold behaviour, always enabled.
        threshold_sec, zone_name, density_threshold = _refresh_zone_info()
        detection_enabled = True
    else:
        threshold_sec = zone_config["applied_threshold_seconds"]
        zone_name = zone_config["applied_zone_name"] or _zone_name_cache
        detection_enabled = zone_config["detection_enabled"]
        density_threshold = zone_config.get("applied_density_threshold")

    person_boxes = []
    object_detections = []
    detections = []
    people_count = 0
    now = time.time()

    for box in results.boxes:
        cls_id = int(box.cls[0])
        class_name = results.names[cls_id]
        conf = float(box.conf[0])
        x1, y1, x2, y2 = map(int, box.xyxy[0])

        if class_name == 'person':
            people_count += 1
            track_id = _assign_person_track([x1, y1, x2, y2], now)
            recog_name = "UNKNOWN"
            cached_name, cached_sim = _person_name_cache[track_id]
            display_label = f"Person #{track_id} {conf:.2f}"
            box_color = (0, 200, 200)
            label_color = (0, 200, 200)

            if recognize_faces and people_count <= _FACE_RECOG_MAX_PEOPLE:
                recognized_name, best_sim = _recognize_person_crop(frame, x1, y1, x2, y2)
                if recognized_name != "UNKNOWN":
                    _person_name_cache[track_id] = (recognized_name, best_sim)
                    cached_name, cached_sim = recognized_name, best_sim

            if cached_name != "UNKNOWN":
                recog_name = cached_name
                display_label = f"#{track_id} {cached_name} {cached_sim:.2f}"
                box_color = (0, 200, 80)
                label_color = (0, 200, 80)
            elif cached_sim:
                recog_name = cached_name

            detections.append({
                "type": "person",
                "label": display_label,
                "confidence": round(conf, 3),
                "box": [x1, y1, x2, y2],
                "status": "person",
                "track_id": track_id,
                "identity_status": "VERIFIED" if recog_name != "UNKNOWN" else "UNKNOWN",
                "person_name": None if recog_name == "UNKNOWN" else recog_name,
            })
            person_boxes.append(([x1, y1, x2, y2], recog_name))
            if detection_enabled:
                _maybe_fire_restricted_motion_alert(
                    class_name, zone_name, source, conf, recog_name, track_id=track_id
                )
            cv2.rectangle(frame, (x1, y1), (x2, y2), box_color, 2)
            cv2.putText(frame, display_label,
                        (x1, max(y1 - 8, 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, label_color, 2)

        elif class_name in _RESTRICTED_MOTION_CLASSES and class_name != "person":
            cx = (x1 + x2) // 2
            cy = (y1 + y2) // 2
            is_pest = class_name in _PEST_CLASSES
            detections.append({
                "type": "animal" if not is_pest else "pest",
                "label": f"{class_name} {conf:.2f}",
                "confidence": round(conf, 3),
                "box": [x1, y1, x2, y2],
                "status": "alert"
            })
            if detection_enabled:
                if source == "Browser Webcam" and _yolo_webcam_model is not None and is_pest:
                    _maybe_fire_pest_alert(class_name, zone_name, source, conf, cx, cy)
                _maybe_fire_restricted_motion_alert(class_name, zone_name, source, conf, cx=cx, cy=cy)
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 220), 3)
            cv2.putText(frame, f"MOTION: {class_name} {conf:.2f}",
                        (x1, max(y1 - 8, 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 220), 2)

        elif class_name in _UNATTENDED_CLASSES:
            cx = (x1 + x2) // 2
            cy = (y1 + y2) // 2
            key = (cx // 50 * 50, cy // 50 * 50, class_name)
            object_detections.append((key, [x1, y1, x2, y2], class_name, cx, cy))
            detections.append({
                "type": "object",
                "label": f"{class_name} {conf:.2f}",
                "confidence": round(conf, 3),
                "box": [x1, y1, x2, y2],
                "status": "object"
            })
            cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 140, 0), 2)
            cv2.putText(frame, f"{class_name} {conf:.2f}",
                        (x1, max(y1 - 8, 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 140, 0), 2)

        elif class_name in _FOOD_CLASSES:
            detections.append({
                "type": "food_item",
                "label": f"{class_name} {conf:.2f}",
                "confidence": round(conf, 3),
                "box": [x1, y1, x2, y2],
                "status": "normal"
            })
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 200, 200), 2)
            cv2.putText(frame, f"{class_name} {conf:.2f}",
                        (x1, max(y1 - 8, 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 200, 200), 2)

        elif class_name in _VEHICLE_CLASSES:
            detections.append({
                "type": "vehicle",
                "label": f"{class_name} {conf:.2f}",
                "confidence": round(conf, 3),
                "box": [x1, y1, x2, y2],
                "status": "normal"
            })
            cv2.rectangle(frame, (x1, y1), (x2, y2), (200, 200, 0), 2)
            cv2.putText(frame, f"{class_name} {conf:.2f}",
                        (x1, max(y1 - 8, 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 0), 2)

        else:
            detections.append({
                "type": "object",
                "label": f"{class_name} {conf:.2f}",
                "confidence": round(conf, 3),
                "box": [x1, y1, x2, y2],
                "status": "normal"
            })
            cv2.rectangle(frame, (x1, y1), (x2, y2), (120, 180, 255), 2)
            cv2.putText(frame, f"{class_name} {conf:.2f}",
                        (x1, max(y1 - 8, 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (120, 180, 255), 2)

    seen_keys = set()
    for (key, box, class_name, cx, cy) in object_detections:
        seen_keys.add(key)
        nearby, nearby_name = _get_nearby_person(person_boxes, cx, cy)

        if key not in _tracked_objects:
            _tracked_objects[key] = {
                'person_last_seen': now if nearby else None,
                'unattended_since': None if nearby else now,
                'alerted': False,
                'last_person_name': nearby_name
            }
        else:
            obj = _tracked_objects[key]
            if nearby:
                obj['person_last_seen'] = now
                obj['unattended_since'] = None
                obj['alerted'] = False
                obj['last_person_name'] = nearby_name
            else:
                if obj['unattended_since'] is None and obj['person_last_seen'] is not None:
                    obj['unattended_since'] = now
                if (detection_enabled
                        and obj['unattended_since'] is not None
                        and not obj['alerted']
                        and now - obj['unattended_since'] >= threshold_sec):
                    obj['alerted'] = True
                    duration = int(now - obj['unattended_since'])
                    threading.Thread(
                        target=_fire_alert,
                        args=(class_name, zone_name, duration, obj.get('last_person_name'), None, source),
                        daemon=True
                    ).start()
                    cv2.rectangle(frame, (box[0], box[1]), (box[2], box[3]), (0, 0, 220), 3)
                    cv2.putText(frame, "UNATTENDED!",
                                (box[0], max(box[1] - 20, 12)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 220), 2)

    _tracked_objects = {k: v for k, v in _tracked_objects.items() if k in seen_keys}
    # Detection Setup's "detection enabled" toggle only gates ALERT CREATION — YOLO still
    # annotates/counts so the live console stays informative while a rule is paused.
    if detection_enabled:
        _maybe_fire_person_alert(people_count, zone_name, source, density_threshold)
    cv2.putText(frame, f"People: {people_count}", (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2)
    _people_count = people_count
    return frame, people_count, detections


def _yolo_detection_loop():
    global _latest_frame, _people_count, _tracked_objects, _detection_active, _camera_status

    if not YOLO_AVAILABLE:
        _camera_status = "yolo_unavailable"
        with _frame_lock:
            _latest_frame = _make_status_frame("YOLO unavailable", "Check yolov8n.pt and ultralytics")
        print("YOLO unavailable — detection loop skipped.")
        return

    # CAP_DSHOW (DirectShow) is more reliable than MSMF on Windows
    cap = _open_camera()
    if cap is None:
        print("⚠️  Webcam not found — YOLO stream will show blank feed.")
        _detection_active = False
        _camera_status = "camera_unavailable"
        with _frame_lock:
            _latest_frame = _make_status_frame("Camera unavailable", "Close other camera pages/apps and restart AI")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, _CAMERA_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, _CAMERA_HEIGHT)
    cap.set(cv2.CAP_PROP_FPS, _YOLO_FPS)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    _detection_active = True
    _camera_status = "active"
    frame_index = 0
    unusable_frame_count = 0
    target_frame_delay = 1.0 / max(_YOLO_FPS, 1)

    while True:
        loop_started_at = time.time()
        ret, frame = cap.read()
        if not ret:
            _camera_status = "read_failed"
            time.sleep(0.1)
            continue

        if not _is_usable_frame(frame):
            unusable_frame_count += 1
            if unusable_frame_count >= max(3, int(_YOLO_FPS)):
                _people_count = 0
                _camera_status = "black_frame"
                with _frame_lock:
                    _latest_frame = _make_status_frame("Camera feed is black", "Camera may be busy, covered, or wrong index")
                time.sleep(target_frame_delay)
                continue
        else:
            unusable_frame_count = 0
            _camera_status = "active"

        frame_index += 1
        results = _yolo_model(
            frame,
            imgsz=_YOLO_IMG_SIZE,
            conf=_YOLO_CONFIDENCE,
            iou=0.45,
            classes=_YOLO_CLASS_IDS,
            verbose=False
        )[0]
        threshold_sec, zone_name, density_threshold = _refresh_zone_info()

        person_boxes = []
        object_detections = []
        people_count = 0
        now = time.time()

        for box in results.boxes:
            cls_id = int(box.cls[0])
            class_name = results.names[cls_id]
            conf = float(box.conf[0])
            x1, y1, x2, y2 = map(int, box.xyxy[0])

            if class_name == 'person':
                people_count += 1

                # --- Face recognition on this person's bounding-box crop ---
                track_id = _assign_person_track([x1, y1, x2, y2], now)
                recog_name = "UNKNOWN"
                box_color = (0, 200, 200)
                label_color = (0, 200, 200)
                display_label = f"Person #{track_id} {conf:.2f}"

                cached_name, cached_sim = _person_name_cache[track_id]
                should_recognize_face = (
                    people_count <= _FACE_RECOG_MAX_PEOPLE
                    and frame_index % max(_FACE_RECOG_EVERY_N_FRAMES, 1) == 0
                )

                if should_recognize_face:
                    fh, fw = frame.shape[:2]
                    crop = frame[max(y1, 0):min(y2, fh), max(x1, 0):min(x2, fw)]
                    if crop.size > 0:
                        try:
                            faces = face_app.get(crop)
                            if faces:
                                live_emb = faces[0].embedding
                                live_emb = live_emb / np.linalg.norm(live_emb)
                                best_sim, best_name = 0.0, "UNKNOWN"
                                for known in known_faces:
                                    sim = float(np.dot(live_emb, known["embedding"]))
                                    if sim > best_sim:
                                        best_sim = sim
                                        if sim > 0.45:
                                            best_name = known["name"]
                                _person_name_cache[track_id] = (best_name, best_sim)
                                cached_name, cached_sim = best_name, best_sim
                        except Exception:
                            pass

                if cached_name != "UNKNOWN":
                    recog_name = cached_name
                    display_label = f"#{track_id} {cached_name} {cached_sim:.2f}"
                    box_color = (0, 200, 80)   # green = identified
                    label_color = (0, 200, 80)

                person_boxes.append(([x1, y1, x2, y2], recog_name))
                _maybe_fire_restricted_motion_alert(
                    class_name, zone_name, None, conf, recog_name, track_id=track_id
                )
                cv2.rectangle(frame, (x1, y1), (x2, y2), box_color, 2)
                cv2.putText(frame, display_label,
                            (x1, max(y1 - 8, 12)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, label_color, 2)

            elif class_name in _RESTRICTED_MOTION_CLASSES and class_name != "person":
                cx = (x1 + x2) // 2
                cy = (y1 + y2) // 2
                _maybe_fire_restricted_motion_alert(class_name, zone_name, None, conf, cx=cx, cy=cy)
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 220), 3)
                cv2.putText(frame, f"MOTION: {class_name} {conf:.2f}",
                            (x1, max(y1 - 8, 12)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 220), 2)

            elif class_name in _UNATTENDED_CLASSES:
                cx = (x1 + x2) // 2
                cy = (y1 + y2) // 2
                key = (cx // 50 * 50, cy // 50 * 50, class_name)
                object_detections.append((key, [x1, y1, x2, y2], class_name, cx, cy))
                cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 140, 0), 2)
                cv2.putText(frame, f"{class_name} {conf:.2f}",
                            (x1, max(y1 - 8, 12)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 140, 0), 2)

            else:
                cv2.rectangle(frame, (x1, y1), (x2, y2), (120, 180, 255), 2)
                cv2.putText(frame, f"{class_name} {conf:.2f}",
                            (x1, max(y1 - 8, 12)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (120, 180, 255), 2)

        # --- Unattended object timer logic ---
        seen_keys = set()
        for (key, box, class_name, cx, cy) in object_detections:
            seen_keys.add(key)
            nearby, nearby_name = _get_nearby_person(person_boxes, cx, cy)

            if key not in _tracked_objects:
                _tracked_objects[key] = {
                    'person_last_seen': now if nearby else None,
                    'unattended_since': None if nearby else now,
                    'alerted': False,
                    'last_person_name': nearby_name
                }
            else:
                obj = _tracked_objects[key]
                if nearby:
                    obj['person_last_seen'] = now
                    obj['unattended_since'] = None
                    obj['alerted'] = False
                    obj['last_person_name'] = nearby_name
                else:
                    # Person just left → start timer
                    if obj['unattended_since'] is None and obj['person_last_seen'] is not None:
                        obj['unattended_since'] = now
                    # Timer expired → fire alert once
                    if (obj['unattended_since'] is not None
                            and not obj['alerted']
                            and now - obj['unattended_since'] >= threshold_sec):
                        obj['alerted'] = True
                        duration = int(now - obj['unattended_since'])
                        threading.Thread(
                            target=_fire_alert,
                            args=(class_name, zone_name, duration, obj.get('last_person_name')),
                            daemon=True
                        ).start()
                        # Red box for alerted objects
                        cv2.rectangle(frame, (box[0], box[1]), (box[2], box[3]), (0, 0, 220), 3)
                        cv2.putText(frame, "UNATTENDED!",
                                    (box[0], max(box[1] - 20, 12)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 220), 2)

        # Evict objects that left the frame
        _tracked_objects = {k: v for k, v in _tracked_objects.items() if k in seen_keys}
        _maybe_fire_person_alert(people_count, zone_name, density_threshold=density_threshold)

        # People count HUD
        cv2.putText(frame, f"People: {people_count}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2)

        _people_count = people_count
        with _frame_lock:
            _latest_frame = frame.copy()

        elapsed = time.time() - loop_started_at
        time.sleep(max(0.0, target_frame_delay - elapsed))


@app.on_event("startup")
def start_yolo_thread():
    if os.getenv("USE_SERVER_CAMERA", "false").lower() != "true":
        print("Server camera stream disabled; using browser-captured frames for YOLO.")
        return
    t = threading.Thread(target=_yolo_detection_loop, daemon=True)
    t.start()


def _frame_generator():
    blank = np.zeros((_CAMERA_HEIGHT, _CAMERA_WIDTH, 3), dtype=np.uint8)
    cv2.putText(blank, "Initializing camera...", (140, 240),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (100, 100, 100), 2)
    _, blank_buf = cv2.imencode('.jpg', blank)
    blank_bytes = blank_buf.tobytes()

    while True:
        with _frame_lock:
            frame = _latest_frame

        if frame is None:
            jpg_bytes = blank_bytes
        else:
            ret, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 65])
            jpg_bytes = buf.tobytes() if ret else blank_bytes

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' +
               jpg_bytes +
               b'\r\n')
        time.sleep(1.0 / max(_STREAM_FPS, 1))


@app.get("/api/yolo/stream", dependencies=[Depends(require_service_key)])
async def yolo_stream():
    """MJPEG stream of annotated webcam feed with YOLO bounding boxes."""
    return StreamingResponse(
        _frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )


class AnalyzeFrameRequest(BaseModel):
    image: str
    # Selected Detection Setup camera/zone from the Object Detection page — optional and
    # additive so older callers that only send `image` keep the previous global-fallback
    # behaviour (see resolve_zone_for_request).
    camera_id: Optional[int] = None
    zone_id: Optional[int] = None
    # Browser-reported alert source ("Browser Webcam" / "Uploaded Video") — whitelisted
    # by _normalize_browser_source before it ever reaches the alert bridge, so a caller
    # cannot claim the SecurePi edge source through this endpoint.
    source: Optional[str] = None


@app.post("/api/yolo/analyze-frame", dependencies=[Depends(require_service_key)])
async def yolo_analyze_frame(request: AnalyzeFrameRequest):
    """Analyze a browser-captured frame and return an annotated JPEG."""
    global _latest_frame, _detection_active, _camera_status

    try:
        img = base64_to_cv2(request.image)
        if img is None:
            raise ValueError("Could not decode image")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image data")

    zone_config = resolve_zone_for_request(request.camera_id, request.zone_id)
    resolved_source = _normalize_browser_source(request.source)
    annotated, people_count, detections = _annotate_detection_frame(
        img, recognize_faces=True, zone_config=zone_config, source=resolved_source
    )
    selected_yolo_model, _, _ = _select_yolo_for_source(resolved_source)
    _detection_active = selected_yolo_model is not None
    _camera_status = "browser_camera"

    with _frame_lock:
        _latest_frame = annotated.copy()

    return {
        "count": people_count,
        "detections": detections,
        "frame_width": int(img.shape[1]),
        "frame_height": int(img.shape[0]),
        "detection_active": _detection_active,
        "camera_status": _camera_status,
        # Additive debug fields — see resolve_zone_for_request for zone_error meanings
        # (camera_not_found / camera_has_no_zone / zone_not_found / lookup_failed / None).
        "applied_camera_id": zone_config["applied_camera_id"],
        "applied_zone_id": zone_config["applied_zone_id"],
        "applied_zone_name": zone_config["applied_zone_name"],
        "applied_threshold_seconds": zone_config["applied_threshold_seconds"],
        "applied_density_threshold": zone_config["applied_density_threshold"],
        "zone_detection_enabled": zone_config["detection_enabled"],
        "zone_error": zone_config["zone_error"]
    }


@app.get("/api/yolo/people-count", dependencies=[Depends(require_service_key)])
async def yolo_people_count():
    """Returns the current people count from the latest YOLO frame."""
    return {
        "count": _people_count,
        "detection_active": _detection_active,
        "camera_status": _camera_status
    }


if __name__ == "__main__":
    import uvicorn
    # Port 8501 to match FACE_AI_URL and the frontend Vite "/ai" proxy.
    # NOTE: this single service hosts BOTH the face-recognition endpoints
    # (/api/encode-faces, /refresh, /user/recognize) and the YOLO endpoints
    # (/api/yolo/*), so the whole "/ai" proxy resolves here on one port.
    uvicorn.run("main:app", host="0.0.0.0", port=8501, reload=False)
