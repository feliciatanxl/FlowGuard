from ultralytics import YOLO

# Load the model (it will download automatically if don't have it)
model = YOLO("yolo26n.pt") 

# Run inference on the test image
results = model("test.jpg") 

# Print the bounding box coordinates of the detected objects
for r in results:
    print(r.boxes)