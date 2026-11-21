import http from "node:http";
import { PassThrough } from "node:stream";
import multer from "multer";
import { describe, expect, it } from "vitest";
import { streamRequestBody } from "../../../../plugins/sandbox/child/request-body.js";

// The request the plugin process builds for its router, fed by a stand-in
// for the body port core streams the upload over.
async function streamedUpload(file: Buffer) {
  const form = new FormData();
  form.append("file", new Blob([file]), "photo.png");
  const sent = new Request("http://termix.test/upload", {
    method: "POST",
    body: form,
  });
  const body = Buffer.from(await sent.arrayBuffer());
  const req = new http.IncomingMessage(new PassThrough() as never);
  req.method = "POST";
  req.url = "/upload";
  req.headers = {
    "content-type": sent.headers.get("content-type") ?? "",
    "content-length": String(body.length),
  };
  const bodyPort = new PassThrough();
  streamRequestBody(req, bodyPort);
  return { req, bodyPort, body };
}

describe("streamRequestBody", () => {
  it("lets multer read a streamed multipart upload to the end", async () => {
    const file = Buffer.alloc(256 * 1024, 7);
    const { req, bodyPort, body } = await streamedUpload(file);
    const parsed = new Promise<unknown>((resolve) => {
      multer({ storage: multer.memoryStorage() }).single("file")(
        req as never,
        {} as never,
        resolve,
      );
    });
    for (let at = 0; at < body.length; at += 16 * 1024) {
      bodyPort.write(body.subarray(at, at + 16 * 1024));
    }
    bodyPort.end();

    expect(await parsed).toBeUndefined();
    const uploaded = (req as unknown as { file: Express.Multer.File }).file;
    expect(uploaded.buffer.equals(file)).toBe(true);
    expect(req.complete).toBe(true);
  });

  it("fails the request when the body stream fails", async () => {
    const { req, bodyPort } = await streamedUpload(Buffer.from("partial"));
    const failed = new Promise<Error>((resolve) => req.on("error", resolve));
    bodyPort.destroy(new Error("core went away"));
    expect((await failed).message).toBe("core went away");
  });
});
