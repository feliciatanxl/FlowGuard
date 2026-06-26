# Frontend Test Cases — Facial Recognition & Access Management (Felicia)

## Create — Face Enrollment

| # | What is tested | Expected outcome |
|---|----------------|------------------|
| FE-1 | FaceEnrollment renders the capture UI | Webcam container + "Capture Front" button appear |
| FE-2 | Capturing the front angle advances the stage | Stage changes front → left; "Front" badge marked done |
| FE-3 | All three angles captured | Stage becomes 'ready'; preview grid shows 3 thumbnails |
| FE-4 | Manual upload fallback sets a photo | Selecting an image file populates the matching angle's photo |
| FE-5 | Non-image file rejected on upload | Error banner shown; photo state unchanged |
| FE-6 | Submit calls the enrol API | POST /user/enroll-face fired with the captured images |
| FE-7 | Backend error surfaces to the user | Error banner displays the returned message |

## Read — Auth & Protected Routes

| # | What is tested | Expected outcome |
|---|----------------|------------------|
| FE-8 | ProtectedRoute blocks unauthenticated access | Redirects to /login when no token present |

## Update — Face Re-enrollment

| # | What is tested | Expected outcome |
|---|----------------|------------------|
| FE-9 | Re-enroll Face button visible in User Management | Button appears for each enrolled user row |
| FE-10 | Re-enroll Face opens enrollment modal | Clicking the button opens the FaceEnrollment modal for that user |
| FE-11 | Manual upload mode works during re-enrollment | Selecting an image file populates the angle photo inside the re-enrollment modal |
| FE-12 | Auto webcam mode works during re-enrollment | Webcam capture advances through front → left → right stages |
| FE-13 | New face vector overwrites old vector | PUT /user/:id/enroll-face called (not POST); success response updates the table row |
| FE-14 | Success message appears after re-enrollment | Toast/banner confirms "Face re-enrolled successfully" |

## Delete — User Removal

| # | What is tested | Expected outcome |
|---|----------------|------------------|
| FE-15 | Delete User button visible to Facility Manager only | Button shown when logged-in role is FM; hidden for regular users |
| FE-16 | Delete confirmation dialog shown | Clicking Delete opens a confirmation modal before proceeding |
| FE-17 | User removed from table after delete | On confirm, DELETE /user/:id called; row disappears from the user table |
| FE-18 | Deleted user cannot login | Attempting login with deleted credentials returns an error; redirected to /login |
