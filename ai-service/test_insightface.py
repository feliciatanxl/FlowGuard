import cv2
import numpy as np
from insightface.app import FaceAnalysis

# 1. Initialize the Model
app = FaceAnalysis(name='buffalo_l')
app.prepare(ctx_id=0, det_size=(640, 640))

print("Loading authorized database...")

# 2. Create a Database of Encodings
known_faces = []

def register_face(image_path, name):
    img = cv2.imread(image_path)
    faces = app.get(img)
    if faces:
        known_faces.append({
            "name": name,
            "embedding": faces[0].embedding
        })
        print(f"Registered: {name}")

# Register your test subjects
register_face("known_faces/donald_trump.jpeg", "Donald Trump (Guest)")
register_face("known_faces/felicia.jpg", "Felicia (Admin)")

print("FlowGuard Live Monitoring Active...")

cap = cv2.VideoCapture(0)

while True:
    ret, frame = cap.read()
    if not ret: break

    live_faces = app.get(frame)

    for face in live_faces:
        bbox = face.bbox.astype(int)
        
        # Default state
        best_name = "UNAUTHORIZED"
        highest_similarity = 0
        color = (0, 0, 255) # Red

        # Compare the live face against EVERYONE in known_faces list
        for known in known_faces:
            # Cosine Similarity calculation
            sim = np.dot(face.embedding, known["embedding"]) / (
                np.linalg.norm(face.embedding) * np.linalg.norm(known["embedding"])
            )
            
            # Keep track of the best match
            if sim > highest_similarity:
                highest_similarity = sim
                if sim > 0.5: # Threshold for a "match"
                    best_name = known["name"]
                    color = (0, 255, 0) # Green

        # Draw UI
        cv2.rectangle(frame, (bbox[0], bbox[1]), (bbox[2], bbox[3]), color, 2)
        cv2.putText(frame, f"{best_name} ({highest_similarity:.2f})", 
                    (bbox[0], bbox[1] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

    cv2.imshow("FlowGuard - Multi-Face Security", frame)
    if cv2.waitKey(1) & 0xFF == ord('q'): break

cap.release()
cv2.destroyAllWindows()