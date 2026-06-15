import os
import cv2
import numpy as np
import psycopg2
import json
import base64
import threading
import time
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from insightface.app import FaceAnalysis
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware

try:
    import requests as http_requests
    _REQUESTS_OK = True
except ImportError:
    _REQUESTS_OK = False
    print("⚠️  'requests' not installed — alert POSTing will be disabled.")

try:
    from ultralytics import YOLO as _YOLO
    _yolo_model = _YOLO('yolov8n.pt')
    YOLO_AVAILABLE = True
    print("✅ YOLOv8n Engine Loaded.")
except Exception as _yolo_err:
    YOLO_AVAILABLE = False
    print(f"⚠️  YOLO not available: {_yolo_err}")

load_dotenv()
app = FastAPI()

# 1. Initialize AI
print("Loading InsightFace Engine...")
face_app = FaceAnalysis(name='buffalo_l')
face_app.prepare(ctx_id=0, det_size=(640, 640))

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
known_faces = []

@app.on_event("startup")
def load_authorized_faces():
    """Fetches all staff embeddings from Postgres on startup"""
    global known_faces
    known_faces = []
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute('SELECT name, "faceVector" FROM users WHERE "faceVector" IS NOT NULL')
        rows = cur.fetchall()
        
        for name, embedding_json in rows:
            embedding = np.array(json.loads(embedding_json), dtype=np.float32)
            known_faces.append({"name": name, "embedding": embedding})
            
        cur.close()
        conn.close()
        print(f"✅ Security Scan Ready: {len(known_faces)} enrolled members loaded.")
    except Exception as e:
        print(f"❌ DB Load Error: {e}")


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

@app.post("/api/encode-faces")
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
        
    except Exception as e:
        print(f"Encode Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
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

@app.post("/user/recognize")
async def recognize(request: RecognitionRequest):
    try:
        header, encoded = request.image.split(",", 1)
        data = base64.b64decode(encoded)
        nparr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception as e:
        return {"error": "Invalid image data"}

    live_faces = face_app.get(img)
    
    for face in live_faces:
        best_name = "UNAUTHORIZED"
        highest_similarity = 0.0
        live_embedding = face.embedding / np.linalg.norm(face.embedding)
        
        for known in known_faces:
            sim = np.dot(live_embedding, known["embedding"])
            if sim > highest_similarity:
                highest_similarity = float(sim)
                if sim > 0.45: 
                    best_name = known["name"]
        
        bbox = face.bbox
        x = int(bbox[0])
        y = int(bbox[1])
        width = int(bbox[2] - bbox[0])
        height = int(bbox[3] - bbox[1])

        # 🎯 Calculate the Head Turn Ratio
        liveness_ratio = calculate_head_turn(face.kps)

        # Return both the user, the box, and the 3D liveness ratio
        return {
            "user": {
                "name": best_name,
                "status": "AUTHORIZED" if best_name != "UNAUTHORIZED" else "DENIED",
                "confidence": round(highest_similarity, 4)
            },
            "box": [x, y, width, height],
            "liveness_ratio": liveness_ratio 
        }
        
    return {"user": None, "box": None, "liveness_ratio": 0.5}

# Helper to refresh the list manually if a new staff joins
@app.get("/refresh")
def refresh():
    load_authorized_faces()
    return {"message": "Staff list updated from database"}


# ============================================================
# YOLO OBJECT DETECTION — Module 2
# ============================================================

_UNATTENDED_CLASSES = {
    'bottle', 'cup', 'book', 'backpack', 'handbag',
    'suitcase', 'cell phone', 'laptop', 'bag'
}
_PROXIMITY_PX = 160      # centroid distance threshold (pixels at 640-wide frame)
_NODE_URL = os.getenv("NODE_SERVER_URL", "http://localhost:5000")

# Shared state written by detection thread, read by endpoints
_frame_lock = threading.Lock()
_latest_frame = None
_people_count = 0
_detection_active = False

# Unattended object tracker
# key: (grid_x, grid_y, class_name)  — centroid snapped to 50 px grid for stability
# value: {person_last_seen, unattended_since, alerted}
_tracked_objects: dict = {}

# Zone threshold cache — refreshed from DB every 60 s
_zone_threshold_sec = 300   # default 5 min
_zone_name_cache = "Zone A"
_threshold_fetched_at = 0.0
_THRESHOLD_TTL = 60


def _refresh_zone_info():
    global _zone_threshold_sec, _zone_name_cache, _threshold_fetched_at
    now = time.time()
    if now - _threshold_fetched_at < _THRESHOLD_TTL:
        return _zone_threshold_sec, _zone_name_cache
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT zone_name, time_threshold
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
            _zone_threshold_sec = int(row[1]) * 60
    except Exception as e:
        print(f"Zone info fetch error: {e}")
    _threshold_fetched_at = now
    return _zone_threshold_sec, _zone_name_cache


def _get_nearby_person(person_entries, ox, oy):
    """Returns (is_nearby, person_name) for the first person within _PROXIMITY_PX."""
    for box, pname in person_entries:
        px = (box[0] + box[2]) / 2
        py = (box[1] + box[3]) / 2
        if ((px - ox) ** 2 + (py - oy) ** 2) ** 0.5 < _PROXIMITY_PX:
            return True, pname
    return False, None


def _fire_alert(class_name, zone_name, duration_sec, person_name=None):
    if not _REQUESTS_OK:
        return
    try:
        http_requests.post(
            f"{_NODE_URL}/api/detection-alerts",
            json={
                "zone_name": zone_name,
                "camera_location": "Webcam Feed",
                "status": "Active",
                "object_class": class_name,
                "duration_seconds": duration_sec,
                "person_name": person_name
            },
            timeout=5
        )
        print(f"🚨 Alert sent: {class_name} unattended {duration_sec}s in {zone_name} (last seen: {person_name})")
    except Exception as e:
        print(f"Alert POST failed: {e}")


def _yolo_detection_loop():
    global _latest_frame, _people_count, _tracked_objects, _detection_active

    if not YOLO_AVAILABLE:
        print("YOLO unavailable — detection loop skipped.")
        return

    # CAP_DSHOW (DirectShow) is more reliable than MSMF on Windows
    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap = cv2.VideoCapture(0)   # fallback to default backend
    if not cap.isOpened():
        print("⚠️  Webcam not found — YOLO stream will show blank feed.")
        _detection_active = False
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    _detection_active = True

    while True:
        ret, frame = cap.read()
        if not ret:
            time.sleep(0.1)
            continue

        results = _yolo_model(frame, verbose=False)[0]
        threshold_sec, zone_name = _refresh_zone_info()

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
                recog_name = "UNKNOWN"
                box_color = (0, 0, 200)    # red  = unidentified
                label_color = (0, 0, 200)
                display_label = "UNKNOWN"

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
                            if best_name != "UNKNOWN":
                                recog_name = best_name
                                display_label = f"{best_name} {best_sim:.2f}"
                                box_color = (0, 200, 80)   # green = identified
                                label_color = (0, 200, 80)
                    except Exception:
                        pass

                person_boxes.append(([x1, y1, x2, y2], recog_name))
                cv2.rectangle(frame, (x1, y1), (x2, y2), box_color, 2)
                cv2.putText(frame, display_label,
                            (x1, max(y1 - 8, 12)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, label_color, 2)

            elif class_name in _UNATTENDED_CLASSES:
                cx = (x1 + x2) // 2
                cy = (y1 + y2) // 2
                key = (cx // 50 * 50, cy // 50 * 50, class_name)
                object_detections.append((key, [x1, y1, x2, y2], class_name, cx, cy))
                cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 140, 0), 2)
                cv2.putText(frame, f"{class_name} {conf:.2f}",
                            (x1, max(y1 - 8, 12)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 140, 0), 2)

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

        # People count HUD
        cv2.putText(frame, f"People: {people_count}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2)

        _people_count = people_count
        with _frame_lock:
            _latest_frame = frame.copy()

        time.sleep(0.04)   # ~25 fps cap


@app.on_event("startup")
def start_yolo_thread():
    t = threading.Thread(target=_yolo_detection_loop, daemon=True)
    t.start()


def _frame_generator():
    blank = np.zeros((480, 640, 3), dtype=np.uint8)
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
            ret, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
            jpg_bytes = buf.tobytes() if ret else blank_bytes

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' +
               jpg_bytes +
               b'\r\n')
        time.sleep(0.04)


@app.get("/api/yolo/stream")
async def yolo_stream():
    """MJPEG stream of annotated webcam feed with YOLO bounding boxes."""
    return StreamingResponse(
        _frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )


@app.get("/api/yolo/people-count")
async def yolo_people_count():
    """Returns the current people count from the latest YOLO frame."""
    return {"count": _people_count, "detection_active": _detection_active}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8500, reload=True)
