# Frontend Test Cases — Facial Recognition & Access Management (Felicia)

| # | What is tested | Expected outcome |
|---|----------------|------------------|
| FE-1 | FaceEnrollment renders the capture UI | Webcam container + "Capture Front" button appear |
| FE-2 | Capturing the front angle advances the stage | Stage changes front → left; "Front" badge marked done |
| FE-3 | All three angles captured | Stage becomes 'ready'; preview grid shows 3 thumbnails |
| FE-4 | Manual upload fallback sets a photo | Selecting an image file populates the matching angle's photo |
| FE-5 | Non-image file rejected on upload | Error banner shown; photo state unchanged |
| FE-6 | Submit calls the enrol API | POST /user/enroll-face fired with the captured images |
| FE-7 | Backend error surfaces to the user | Error banner displays the returned message |
| FE-8 | ProtectedRoute blocks unauthenticated access | Redirects to /login when no token present |
