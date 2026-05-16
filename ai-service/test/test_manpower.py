import cv2
from ultralytics import YOLO

# 1. Load the model
model = YOLO("yolo26n.pt") 

cap = cv2.VideoCapture(0)

print("Manpower Monitoring Active... Press 'q' to quit.")

while True:
    ret, frame = cap.read()
    if not ret: break

    # 2. Run detection
    results = model(frame, stream=True)
    
    person_count = 0
    annotated_frame = frame

    for r in results:
        # Filter for only 'person' class (ID 0 in COCO dataset)
        # This prevents the counter from counting chairs or dogs
        for box in r.boxes:
            class_id = int(box.cls[0])
            label = model.names[class_id]
            
            if label == 'person':
                person_count += 1
        
        # Draw the boxes
        annotated_frame = r.plot()

    # 3. Add the Counter UI to the frame
    # (Text, Position, Font, Scale, Color, Thickness)
    cv2.putText(annotated_frame, f"MANPOWER COUNT: {person_count}", (20, 50), 
                cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)

    # 4. Display
    cv2.imshow("FlowGuard - Manpower Monitoring", annotated_frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()