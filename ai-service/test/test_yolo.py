from ultralytics import YOLO

# Load the model (it will download automatically if don't have it)
model = YOLO("yolov8n.pt")

# Run inference on the test image
results = model("test.jpg", imgsz=416, verbose=False)

# Print the bounding box coordinates of the detected objects
for r in results:
    print(r.boxes)
