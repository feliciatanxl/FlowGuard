import cv2
from ultralytics import YOLO

# 1. Load the FlowGuard AI model
model = YOLO("yolov8n.pt")

# 2. Open the webcam (Corrected method name)
cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 360)
cap.set(cv2.CAP_PROP_FPS, 10)

if not cap.isOpened():
    print("Error: Could not open webcam. Make sure no other app is using it.")
    exit()

print("FlowGuard AI Live Feed Starting... Press 'q' to quit.")

while True:
    # Capture frame-by-frame
    ret, frame = cap.read()
    if not ret:
        print("Failed to grab frame.")
        break

    # 3. Run YOLO detection on the current frame
    # 'stream=True' is more memory-efficient for videos
    results = model(frame, imgsz=416, stream=True, verbose=False)

    # 4. Use the built-in 'plot' method to draw boxes and labels
    # We need to grab the plotted frame from the results generator
    annotated_frame = frame # Default to raw frame if no results
    for r in results:
        annotated_frame = r.plot()

    # 5. Display the resulting frame in a window
    cv2.imshow("FlowGuard - Live AI Monitoring", annotated_frame)

    # Break the loop if the user presses the 'q' key
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# Clean up everything when finished
cap.release()
cv2.destroyAllWindows()
