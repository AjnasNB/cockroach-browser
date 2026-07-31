import assert from "node:assert/strict";
import test from "node:test";
import {
  requestAuthorizedChallengeResolution,
  type ChallengeResolutionRequest
} from "../src/challenge.js";

const REQUEST: ChallengeResolutionRequest = {
  sessionId: "session-1",
  origin: "https://example.com",
  purpose: "Ask the authorized operator to complete the active challenge",
  report: {
    detected: true,
    kind: "captcha",
    provider: "Turnstile",
    evidence: ["selector:.cf-turnstile"],
    requiresHuman: true
  },
  requestedAt: "2026-07-31T00:00:00.000Z",
  deadlineAt: "2026-07-31T00:00:30.000Z"
};

test("passes only a cloned bounded handoff request to an authorized resolver", async () => {
  const result = await requestAuthorizedChallengeResolution(
    {
      async resolve(request, signal) {
        assert.notEqual(request, REQUEST);
        assert.deepEqual(request, REQUEST);
        assert.equal(signal.aborted, false);
        request.report.evidence.push("resolver-local-mutation");
        return { status: "resolved", reference: " operator-ticket-42 " };
      }
    },
    REQUEST,
    5_000
  );

  assert.deepEqual(result, { status: "resolved", reference: "operator-ticket-42" });
  assert.deepEqual(REQUEST.report.evidence, ["selector:.cf-turnstile"]);
});

test("rejects resolver output that could smuggle unbounded control text", async () => {
  await assert.rejects(
    requestAuthorizedChallengeResolution(
      { async resolve() { return { status: "resolved", reference: "bad\nreference" }; } },
      REQUEST,
      5_000
    ),
    (error: unknown) => hasCode(error, "CHALLENGE_RESOLVER_REFERENCE_INVALID")
  );
});

test("requires an active challenge before a resolver can run", async () => {
  await assert.rejects(
    requestAuthorizedChallengeResolution(
      { async resolve() { return { status: "pending" }; } },
      { ...REQUEST, report: { detected: false, evidence: [], requiresHuman: false } },
      5_000
    ),
    (error: unknown) => hasCode(error, "CHALLENGE_NOT_ACTIVE")
  );
});

function hasCode(error: unknown, expected: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === expected);
}
