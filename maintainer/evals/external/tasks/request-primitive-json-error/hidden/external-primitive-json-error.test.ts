import { describe, expect, it } from "vitest";

import { request } from "../src/index.ts";

describe("primitive JSON error responses", () => {
  for (const [body, expectedMessage] of [
    ["null", "Unknown error: null"],
    ["42", "Unknown error: 42"],
    ["false", "Unknown error: false"],
  ] as const) {
    it(`wraps ${body} in an HTTP error with request and response metadata`, async () => {
      const fetch = async () =>
        new Response(body, {
          status: 400,
          headers: { "content-type": "application/json" },
        });

      const error: any = await request("GET /demo", {
        baseUrl: "https://request-errors-test.com",
        request: { fetch },
      }).catch((error) => error);

      expect(error.name).toBe("HttpError");
      expect(error.status).toBe(400);
      expect(error.message).toBe(expectedMessage);
      expect(error.request.method).toBe("GET");
      expect(error.request.url).toBe("https://request-errors-test.com/demo");
      expect(error.response.status).toBe(400);
      expect(error.response.data).toBe(JSON.parse(body));
    });
  }
});
