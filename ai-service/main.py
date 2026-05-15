import os
import cv2
import numpy as np
import psycopg2
import json
import base64
from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel
from insightface.app import FaceAnalysis
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware

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
        # Ensure the table name matches what you actually use in your Node.js backend
        # E.g., 'users' instead of 'staff_members' if you use a unified table
        cur.execute('SELECT name, "faceVector" FROM users WHERE "faceVector" IS NOT NULL')
        rows = cur.fetchall()
        
        for name, embedding_json in rows:
            # Convert the stored JSON string back into a NumPy array
            embedding = np.array(json.loads(embedding_json), dtype=np.float32)
            known_faces.append({"name": name, "embedding": embedding})
            
        cur.close()
        conn.close()
        print(f"✅ Security Scan Ready: {len(known_faces)} enrolled members loaded.")
    except Exception as e:
        print(f"❌ DB Load Error: {e}")


# --- NEW: Phase 2 - Biometric Enrollment Endpoint ---

class FaceImages(BaseModel):
    front: str
    left: str
    right: str

def base64_to_cv2(base64_string):
    """Helper to convert React's Base64 image into OpenCV format"""
    # Remove the "data:image/jpeg;base64," prefix if it exists
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
        
        # Process all 3 images
        for img_str in [images.front, images.left, images.right]:
            img = base64_to_cv2(img_str)
            faces = face_app.get(img)
            
            if len(faces) == 0:
                raise HTTPException(status_code=400, detail="No face detected in one of the images.")
            if len(faces) > 1:
                raise HTTPException(status_code=400, detail="Multiple faces detected. Please ensure you are alone.")
                
            # Use 'embedding', not 'normed_embedding' as that is what InsightFace provides by default
            vectors.append(faces[0].embedding)
            
        # Average the 3 vectors into one robust profile
        avg_vector = np.mean(vectors, axis=0)
        # Normalize it back (critical for accurate cosine similarity later)
        avg_vector = avg_vector / np.linalg.norm(avg_vector)
        
        # Return as a standard list of floats so Node.js can save it
        return {"status": "success", "vector": avg_vector.tolist()}
        
    except Exception as e:
        print(f"Encode Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins (or use ["http://localhost:5173"])
    allow_credentials=True,
    allow_methods=["*"],  # Allows POST, OPTIONS, etc.
    allow_headers=["*"],  # Allows Authorization headers
)

# --- EXISTING: Phase 3 - The CCTV Scan Endpoint ---

class RecognitionRequest(BaseModel):
    image: str

@app.post("/user/recognize")
async def recognize(request: RecognitionRequest):
    # 2. Decode the Base64 string back into an image
    try:
        header, encoded = request.image.split(",", 1)
        data = base64.b64decode(encoded)
        nparr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception as e:
        return {"error": "Invalid image data"}

    live_faces = face_app.get(img)
    
    # 3. Process faces (Your existing logic)
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
        
        # 4. Return the FIRST face found to match your React logic
        return {
            "user": {
                "name": best_name,
                "status": "AUTHORIZED" if best_name != "UNAUTHORIZED" else "DENIED",
                "confidence": round(highest_similarity, 4)
            }
        }
        
    return {"user": None} # No face detected

# Helper to refresh the list manually if a new staff joins
@app.get("/refresh")
def refresh():
    load_authorized_faces()
    return {"message": "Staff list updated from database"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)