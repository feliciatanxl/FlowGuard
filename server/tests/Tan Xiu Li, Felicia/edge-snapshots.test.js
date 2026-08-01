// Backend tests for POST/GET /api/edge/snapshots — SecurePi snapshot upload + serving.
// The Pi uploads the actual JPEG/PNG bytes with the edge token; the backend stores it
// under a SERVER-GENERATED filename and returns a browser-openable http(s) URL. A local
// Pi path is never trusted, invalid types/oversized files are rejected, and serving
// validates the filename so no arbitrary filesystem path is exposed.
const request = require("supertest");
const express = require("express");
const fs = require("fs");
const path = require("path");

process.env.EDGE_INGEST_TOKEN = "test-edge-token";

const snapshotsRouter = require("../../routes/edgeSnapshots");
const UPLOAD_DIR = snapshotsRouter.UPLOAD_DIR;

const app = express();
app.use("/api/edge/snapshots", snapshotsRouter);

// A tiny valid JPEG (SOI ... EOI). Content is irrelevant to the tests; the type is.
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

const created = [];
afterAll(() => {
  // Clean up any files the tests wrote (they are git-ignored, but keep the dir tidy).
  for (const name of created) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, name)); } catch { /* already gone */ }
  }
});

describe("POST /api/edge/snapshots (upload)", () => {
  test("rejects missing bearer token (401)", async () => {
    const res = await request(app)
      .post("/api/edge/snapshots")
      .attach("file", JPEG_BYTES, { filename: "x.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(401);
  });

  test("rejects wrong bearer token (401)", async () => {
    const res = await request(app)
      .post("/api/edge/snapshots")
      .set("Authorization", "Bearer nope")
      .attach("file", JPEG_BYTES, { filename: "x.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(401);
  });

  test("returns 503 when EDGE_INGEST_TOKEN is unconfigured", async () => {
    const saved = process.env.EDGE_INGEST_TOKEN;
    delete process.env.EDGE_INGEST_TOKEN;
    try {
      const res = await request(app)
        .post("/api/edge/snapshots")
        .set("Authorization", "Bearer test-edge-token")
        .attach("file", JPEG_BYTES, { filename: "x.jpg", contentType: "image/jpeg" });
      expect(res.status).toBe(503);
    } finally {
      process.env.EDGE_INGEST_TOKEN = saved;
    }
  });

  test("rejects an unsupported file type (415)", async () => {
    const res = await request(app)
      .post("/api/edge/snapshots")
      .set("Authorization", "Bearer test-edge-token")
      .attach("file", Buffer.from("not an image"), { filename: "evil.txt", contentType: "text/plain" });
    expect(res.status).toBe(415);
  });

  test("rejects an oversized file (413)", async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 0); // 6 MB > 5 MB limit
    const res = await request(app)
      .post("/api/edge/snapshots")
      .set("Authorization", "Bearer test-edge-token")
      .attach("file", big, { filename: "big.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(413);
  });

  test("accepts a JPEG and returns a server-generated http URL (201)", async () => {
    const res = await request(app)
      .post("/api/edge/snapshots")
      .set("Authorization", "Bearer test-edge-token")
      // A hostile client filename must be ignored — the server names the file.
      .attach("file", JPEG_BYTES, { filename: "../../../../etc/evil.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(201);
    expect(res.body.snapshot_url).toMatch(/^https?:\/\/[^/]+\/api\/edge\/snapshots\/edge_[0-9a-f]{32}\.jpg$/);
    expect(res.body.filename).toMatch(/^edge_[0-9a-f]{32}\.jpg$/);
    expect(res.body.filename).not.toContain("evil");     // client name never used
    expect(res.body.filename).not.toContain("..");        // no traversal
    created.push(res.body.filename);
    // The bytes really landed on disk under the generated name.
    expect(fs.existsSync(path.join(UPLOAD_DIR, res.body.filename))).toBe(true);
  });
});

describe("GET /api/edge/snapshots/:filename (serve)", () => {
  test("serves a previously uploaded snapshot (200)", async () => {
    const up = await request(app)
      .post("/api/edge/snapshots")
      .set("Authorization", "Bearer test-edge-token")
      .attach("file", JPEG_BYTES, { filename: "x.jpg", contentType: "image/jpeg" });
    created.push(up.body.filename);
    const res = await request(app).get(`/api/edge/snapshots/${up.body.filename}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/jpeg/);
  });

  test("rejects a filename that is not a server-minted snapshot (404)", async () => {
    const res = await request(app).get("/api/edge/snapshots/evil.txt");
    expect(res.status).toBe(404);
  });

  test("rejects a path-traversal filename (404)", async () => {
    const res = await request(app).get("/api/edge/snapshots/..%2f..%2fpackage.json");
    expect(res.status).toBe(404);
  });
});
