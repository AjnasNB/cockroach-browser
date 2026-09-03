# Qarinah integration

Turn browser outcomes into cited memory without turning memory into a dispatcher.

The optional Qarinah adapters emit versioned metadata-only outcomes to a host sink and can retrieve a bounded cited history pack for the built-in agent without granting browser authority.

Public manual: https://cockroachbrowser.com/docs/qarinah/

## Record metadata, not browser secrets

The recorder emits cockroach.browser-memory.v2 with event type, session ID, optional actor, a SHA-256 purposeDigest instead of raw purpose, timestamp, optional input and output digests, evidence IDs, optional receipt hash, and filtered metadata. The metadata allowlist is action, status, input/output digest, receipt hash/ID, evidence IDs, policy digest, mode, effect, risk, and completion time. Values are depth-, length-, and count-bounded; authorization, cookie, credential, password, passphrase, secret, token, storage, form-value, and API-key fields are removed recursively.

The envelope contains no sourceUrl, raw page content, browser-profile content, hidden reasoning, or raw session purpose. The host supplies the persistence callback supported by its installed Qarinah release. BrowserRuntime.contextRecorderTimeoutMs bounds the recorder wait, defaults to 1,000 ms, and accepts integers from 1 through 120,000 ms; rejection or timeout is reported operationally without replacing browser work.

## Keep memory read-only with respect to the browser

Qarinah never creates a session, changes policy, approves an action, or dispatches a browser operation. A later memory query may inform a proposal, but Maqam and the browser boundary still decide execution.

## Link a causal receipt chain when it exists

A read outcome needs citations and receipt metadata, not a synthetic mutation chain. For consequential mutations, a host may connect public evidence, browser observation, Qarinah memory, Maqam decision, approved tool execution, observed result, and permanent receipt when every stage exists. The integration does not invent missing stages or require one cross-system transaction.

## Retrieve bounded context for the browser agent

createQarinahAgentContextProvider forwards the current session ID, agent task as query, an agent-selected character ceiling, a configured result limit from 1 to 128, and optional cancellation to a host-owned retrieveBrowserContext callback. The callback returns a summary plus citation IDs with optional receipt hashes and evidence IDs.

The browser agent validates citation counts and identifier sizes, preserves citation anchors when truncating, and serializes the bounded pack as an untrusted user-role observation behind a trusted system boundary. Qarinah content never becomes a system instruction or authority. Runtime origin, action, effect, approval, and resource policy still decides every browser operation.

```
const contextProvider = createQarinahAgentContextProvider(
  hostProvidedQarinahMemorySource,
  { limit: 24 }
);

const agent = new BrowserAgent({
  runtime,
  gateway,
  contextProvider
});
```


## Source status

This manual is generated from current `main` for the next Cockroach Browser release. Package examples still identify published line 0.5.0-rc.1 where shown; verify npm provenance and the matching tag before production use. Available means implemented in the current source tree, not necessarily published in 0.5.0-rc.1. Adapter means another authority or package is required. Planned means the surface is not implemented here.
