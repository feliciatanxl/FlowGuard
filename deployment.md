# Deployment

FlowGuard is deployed across the following cloud services. Replace the placeholder URLs
with your live ones before submission. Do **not** put real secret values here — describe
them as placeholders only.

| Tier | Service | Public URL |
|------|---------|------------|
| Frontend | Vercel | https://your-app.vercel.app |
| Backend API | Render | https://your-backend.onrender.com |
| AI service | Render | https://your-ai-service.onrender.com |
| Database | Neon / Supabase PostgreSQL (with pgvector) | (internal connection string) |
| Image storage | Cloudinary (optional) | (hosted asset URLs) |

## Environment variables

**Render — Backend**
`APP_PORT`, `APP_SECRET`, `CLIENT_URL`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
`DB_PWD`, `PYTHON_AI_URL`, `RECAPTCHA_SECRET_KEY`, `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`

**Render — AI service**
`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PWD`

**Vercel — Frontend**
`VITE_RECAPTCHA_SITE_KEY`, `VITE_API_URL`

## Notes
- Deploy the backend before the frontend (the frontend needs the backend URL).
- Set the backend `CLIENT_URL` to the Vercel URL so CORS allows the frontend.
- Render free-tier services sleep after ~15 min idle and take ~30s to wake — warn the
  client/tutor before a demo.
- The `pgvector` extension must be enabled on the database for face embeddings.
