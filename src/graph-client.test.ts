import assert from "node:assert/strict";
import test from "node:test";

import {
  GraphAuthenticationError,
  GraphClient,
  parseRetryAfter,
} from "./graph-client.ts";

const config = {
  tenantId: "11111111-2222-3333-4444-555555555555",
  clientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  clientSecret: "test-secret",
  mailbox: "sender@example.test",
  saveToSentItems: true,
};

const mail = {
  to: ["admin@example.test"],
  replyTo: "visitor@example.test",
  subject: "Contact request",
  body: { contentType: "Text" as const, content: "Message body" },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

test("token request uses the tenant endpoint and Graph .default scope", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new GraphClient(config, async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input).includes("/token")) {
      return jsonResponse({ access_token: "mock-token", expires_in: 3600 });
    }
    return new Response(null, {
      status: 202,
      headers: { "request-id": "graph-request-id" },
    });
  });

  const result = await client.sendMail(mail);

  assert.deepEqual(result, { kind: "accepted", requestId: "graph-request-id" });
  assert.equal(
    calls[0]?.url,
    `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
  );
  const tokenBody = new URLSearchParams(String(calls[0]?.init?.body));
  assert.equal(tokenBody.get("scope"), "https://graph.microsoft.com/.default");
  assert.equal(tokenBody.get("grant_type"), "client_credentials");

  const graphPayload = JSON.parse(String(calls[1]?.init?.body)) as {
    message: Record<string, unknown>;
    saveToSentItems: boolean;
  };
  assert.deepEqual(graphPayload.message.toRecipients, [
    { emailAddress: { address: "admin@example.test" } },
  ]);
  assert.deepEqual(graphPayload.message.replyTo, [
    { emailAddress: { address: "visitor@example.test" } },
  ]);
  assert.equal("ccRecipients" in graphPayload.message, false);
  assert.equal("bccRecipients" in graphPayload.message, false);
  assert.equal(graphPayload.saveToSentItems, true);
});

test("401 refreshes the token once and retries Graph", async () => {
  let tokenRequests = 0;
  let graphRequests = 0;
  const client = new GraphClient(config, async (input) => {
    if (String(input).includes("/token")) {
      tokenRequests += 1;
      return jsonResponse({
        access_token: `mock-token-${tokenRequests}`,
        expires_in: 3600,
      });
    }
    graphRequests += 1;
    return new Response(null, { status: graphRequests === 1 ? 401 : 202 });
  });

  const result = await client.sendMail(mail);

  assert.equal(result.kind, "accepted");
  assert.equal(tokenRequests, 2);
  assert.equal(graphRequests, 2);
});

test("401 is retried only once", async () => {
  let tokenRequests = 0;
  let graphRequests = 0;
  const client = new GraphClient(config, async (input) => {
    if (String(input).includes("/token")) {
      tokenRequests += 1;
      return jsonResponse({
        access_token: `mock-token-${tokenRequests}`,
        expires_in: 3600,
      });
    }
    graphRequests += 1;
    return new Response(null, { status: 401 });
  });

  assert.deepEqual(await client.sendMail(mail), {
    kind: "permanent-failure",
    status: 401,
    reason: "unauthorized",
  });
  assert.equal(tokenRequests, 2);
  assert.equal(graphRequests, 2);
});

test("concurrent sends share the Entra token request", async () => {
  let tokenRequests = 0;
  const client = new GraphClient(config, async (input) => {
    if (String(input).includes("/token")) {
      tokenRequests += 1;
      await Promise.resolve();
      return jsonResponse({ access_token: "mock-token", expires_in: 3600 });
    }
    return new Response(null, { status: 202 });
  });

  const results = await Promise.all([
    client.sendMail(mail),
    client.sendMail(mail),
  ]);

  assert.equal(tokenRequests, 1);
  assert.deepEqual(results.map((result) => result.kind), [
    "accepted",
    "accepted",
  ]);
});

test("429 honors Retry-After and 5xx is retryable", async () => {
  let graphRequest = 0;
  const client = new GraphClient(config, async (input) => {
    if (String(input).includes("/token")) {
      return jsonResponse({ access_token: "mock-token", expires_in: 3600 });
    }
    graphRequest += 1;
    return new Response(null, {
      status: graphRequest === 1 ? 429 : 503,
      headers: graphRequest === 1 ? { "retry-after": "45" } : undefined,
    });
  });

  assert.deepEqual(await client.sendMail(mail), {
    kind: "retryable",
    status: 429,
    retryAfterSeconds: 45,
    reason: "throttled",
  });
  assert.deepEqual(await client.sendMail(mail), {
    kind: "retryable",
    status: 503,
    reason: "server-error",
  });
});

test("Graph network failures are retryable without exposing error details", async () => {
  const client = new GraphClient(config, async (input) => {
    if (String(input).includes("/token")) {
      return jsonResponse({ access_token: "mock-token", expires_in: 3600 });
    }
    throw new Error("private request details");
  });

  assert.deepEqual(await client.sendMail(mail), {
    kind: "retryable",
    reason: "network-error",
  });
});

test("4xx is permanent and Graph response bodies are not exposed", async () => {
  const client = new GraphClient(config, async (input) => {
    if (String(input).includes("/token")) {
      return jsonResponse({ access_token: "mock-token", expires_in: 3600 });
    }
    return new Response("sensitive provider response", { status: 403 });
  });

  assert.deepEqual(await client.sendMail(mail), {
    kind: "permanent-failure",
    status: 403,
    reason: "unauthorized",
  });
});

test("invalid identity settings and header injection are rejected", async () => {
  assert.throws(
    () => new GraphClient({ ...config, tenantId: "common" }),
    /UUIDs/,
  );

  const client = new GraphClient(config);
  await assert.rejects(
    client.sendMail({ ...mail, subject: "Subject\r\nBcc: attacker@example.test" }),
    /CR\/LF/,
  );
  await assert.rejects(
    client.sendMail({ ...mail, replyTo: "first,second@example.test" }),
    /Reply-To/,
  );
});

test("token failures surface as sanitized authentication errors", async () => {
  const client = new GraphClient(config, async (input) => {
    if (String(input).includes("/token")) {
      return new Response("provider error containing private values", {
        status: 401,
      });
    }
    return new Response(null, { status: 202 });
  });

  await assert.rejects(client.sendMail(mail), (error: unknown) => {
    assert.ok(error instanceof GraphAuthenticationError);
    assert.equal(error.status, 401);
    assert.equal(error.message, "Microsoft Entra token request failed");
    return true;
  });
});

test("Retry-After accepts seconds and HTTP dates", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  assert.equal(parseRetryAfter("1.5", now), 2);
  assert.equal(parseRetryAfter("Thu, 01 Jan 2026 00:00:03 GMT", now), 3);
  assert.equal(parseRetryAfter("invalid", now), undefined);
});
