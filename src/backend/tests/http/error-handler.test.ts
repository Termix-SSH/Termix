import { describe, expect, it, vi } from "vitest";
import express from "express";
import multer from "multer";
import request from "supertest";

vi.mock("../../utils/logger.js", () => ({
  apiLogger: { error: vi.fn() },
}));

const { finalErrorHandler } = await import("../../http/error-handler.js");

function app() {
  const server = express();
  server.use(express.json({ limit: "10b" }));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4, files: 1 },
  });
  server.post("/json", (_req, res) => res.json({ ok: true }));
  server.post("/upload", upload.single("key"), (_req, res) =>
    res.json({ ok: true }),
  );
  server.get("/boom", () => {
    throw new Error("ENOENT: no such file, open '/app/data/secret.key'");
  });
  server.use(finalErrorHandler);
  return server;
}

describe("final error handler", () => {
  it("never sends the error text, stack or a path", async () => {
    const res = await request(app()).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal Server Error" });
    expect(res.text).not.toContain("/app/data");
    expect(res.text).not.toContain("at ");
  });

  it("answers bad JSON with 400, not 500", async () => {
    const res = await request(app())
      .post("/json")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid request" });
  });

  it("answers a too large body with 413", async () => {
    const res = await request(app())
      .post("/json")
      .send({ much: "longer than ten bytes" });
    expect(res.status).toBe(413);
  });

  it("answers a too large upload with 413", async () => {
    const res = await request(app())
      .post("/upload")
      .attach("key", Buffer.from("way too big"), "id_rsa");
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "Request is too large" });
  });

  it("answers a broken multipart body with 400", async () => {
    for (const body of [
      "--b\r\nbroken header line\r\n\r\nx\r\n--b--\r\n",
      '--b\r\nContent-Disposition: form-data; name="key"; filename="k"\r\n\r\npart',
    ]) {
      const res = await request(app())
        .post("/upload")
        .set("Content-Type", "multipart/form-data; boundary=b")
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid request" });
    }
  });
});
