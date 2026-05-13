import os
import cv2
import numpy as np
import psycopg2
import json
from fastapi import FastAPI, UploadFile, File
from insightface.app import FaceAnalysis
from dotenv import load_dotenv

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
        # We assume you have a 'staff' table with a 'face_embedding' column
        cur.execute("SELECT name, face_embedding FROM staff_members")
        rows = cur.fetchall()
        
        for name, embedding_json in rows:
            # Convert the stored JSON string back into a NumPy array
            embedding = np.array(json.loads(embedding_json), dtype=np.float32)
            known_faces.append({"name": name, "embedding": embedding})
            
        cur.close()
        conn.close()
        print(f"✅ Security Scan Ready: {len(known_faces)} staff members loaded.")
    except Exception as e:
        print(f"❌ DB Load Error: {e}")

# 4. The Scan Endpoint
@app.post("/recognize")
async def recognize(file: UploadFile = File(...)):
    # Read the incoming CCTV frame
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    # Run the scan
    live_faces = face_app.get(img)
    results = []
    
    for face in live_faces:
        best_name = "UNAUTHORIZED"
        highest_similarity = 0.0
        
        for known in known_faces:
            # Mathematical similarity check
            sim = np.dot(face.embedding, known["embedding"]) / (
                np.linalg.norm(face.embedding) * np.linalg.norm(known["embedding"])
            )
            if sim > highest_similarity:
                highest_similarity = float(sim)
                # Slightly lower threshold for hairnets/dull lighting
                if sim > 0.45: 
                    best_name = known["name"]
                    
        results.append({
            "status": "AUTHORIZED" if best_name != "UNAUTHORIZED" else "UNAUTHORIZED_ACCESS",
            "name": best_name,
            "confidence": round(highest_similarity, 4),
            "box": face.bbox.astype(int).tolist()
        })
        
    return {"faces": results}

# Helper to refresh the list manually if a new staff joins
@app.get("/refresh")
def refresh():
    load_authorized_faces()
    return {"message": "Staff list updated from database"}