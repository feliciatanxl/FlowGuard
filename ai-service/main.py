from fastapi import FastAPI, UploadFile, File
from ultralytics import YOLO
import shutil
import os

app = FastAPI()

# Load the AI brain just like in the test script
model = YOLO("yolo26n.pt") 

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    # 1. Save the uploaded image temporarily
    temp_path = f"temp_{file.filename}"
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # 2. Run the AI on the image
    results = model(temp_path)
    
    # 3. Create a clean list of what the AI found
    detections = []
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls.item())
            conf = float(box.conf.item())
            label = model.names[cls_id] # Translates math into words (e.g., "teddy bear")
            
            detections.append({
                "label": label,
                "confidence": round(conf, 4)
            })
            
    # 4. Delete the temporary image so hard drive doesn't get full
    os.remove(temp_path)
    
    # 5. Send the results back as JSON!
    return {"detections": detections}