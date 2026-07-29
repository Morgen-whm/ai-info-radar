import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("api-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

const testEnv = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const testContext = {
  waitUntil() {},
  passThroughOnException() {},
};

test("health endpoint reports connector readiness without exposing secrets", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/health"),
    testEnv,
    testContext,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.status, "ok");
  assert.equal(payload.service, "trendhub");
  assert.equal(payload.connectors.linuxdo, true);
  assert.equal(payload.connectors.idcflare, true);
  assert.equal(payload.connectors.gitlab, true);
  assert.equal(JSON.stringify(payload).includes("TIKHUB_TOKEN"), false);
});

test("feed endpoint falls back to clearly defined demo content", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/feed?platform=x&sort=hot&q=codex"),
    testEnv,
    testContext,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.total >= 1);
  assert.ok(payload.items.every((item) => item.platform === "x"));
  assert.ok(
    payload.items.some((item) => item.title.toLowerCase().includes("codex")),
  );
});

test("personal TikHub keys are validated and returned only as encrypted HttpOnly cookies", async () => {
  const worker = await loadWorker();
  const apiKey = "tikhub_personal_test_key_123456";
  const originalFetch = globalThis.fetch;
  const originalEncryptionSecret =
    process.env.TIKHUB_KEY_ENCRYPTION_SECRET;
  process.env.TIKHUB_KEY_ENCRYPTION_SECRET =
    "test-only-encryption-secret-with-more-than-24-characters";
  globalThis.fetch = async (input, init) => {
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : String(input);
    if (url === "https://api.tikhub.io/api/v1/tikhub/user/get_user_info") {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        `Bearer ${apiKey}`,
      );
      return Response.json({
        code: 200,
        api_key_data: {
          api_key_name: "Team member key",
          expires_at: "2027-01-01T00:00:00Z",
        },
        user_data: {
          email: "member@example.com",
          balance: 12.34,
          free_credit: 0.5,
        },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const env = testEnv;
    const saveResponse = await worker.fetch(
      new Request("http://localhost/api/settings/tikhub", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({ apiKey }),
      }),
      env,
      testContext,
    );
    assert.equal(saveResponse.status, 200);
    const setCookie = saveResponse.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.doesNotMatch(setCookie, new RegExp(apiKey));

    const savePayload = await saveResponse.json();
    assert.equal(savePayload.configured, true);
    assert.equal(savePayload.keyHint, "•••• 3456");
    assert.equal(JSON.stringify(savePayload).includes(apiKey), false);
    assert.equal(
      JSON.stringify(savePayload).includes("member@example.com"),
      false,
    );

    const cookie = setCookie.split(";")[0];
    const statusResponse = await worker.fetch(
      new Request("http://localhost/api/settings/tikhub", {
        headers: { cookie },
      }),
      env,
      testContext,
    );
    assert.equal(statusResponse.status, 200);
    const statusPayload = await statusResponse.json();
    assert.equal(statusPayload.configured, true);
    assert.equal(statusPayload.keyHint, "•••• 3456");
    assert.equal(JSON.stringify(statusPayload).includes(apiKey), false);

    const deleteResponse = await worker.fetch(
      new Request("http://localhost/api/settings/tikhub", {
        method: "DELETE",
        headers: { origin: "http://localhost" },
      }),
      env,
      testContext,
    );
    assert.equal(deleteResponse.status, 200);
    assert.match(deleteResponse.headers.get("set-cookie") ?? "", /Max-Age=0/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEncryptionSecret === undefined) {
      delete process.env.TIKHUB_KEY_ENCRYPTION_SECRET;
    } else {
      process.env.TIKHUB_KEY_ENCRYPTION_SECRET = originalEncryptionSecret;
    }
  }
});
