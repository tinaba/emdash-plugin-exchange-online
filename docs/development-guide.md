# Development Guide

## EmDash Exchange Online Plugin

> **Status:** Design / Pre-implementation
> **License:** Apache-2.0
> **Target:** EmDash CMS Plugin
> **Implementation starts only after Phase 0 receives a GO decision.**

---

## 1. Purpose

This document defines the development procedure for the EmDash CMS plugin that sends contact-form notifications through Microsoft Exchange Online.

It is intended for both human developers and AI coding agents, including GitHub Copilot.

The primary rule is:

> **Verify first, implement second.**

Do not implement unverified EmDash CMS APIs, security contracts, capabilities, hooks, events, or message types based on assumptions.

---

## 2. Required Reading

Before making any implementation change, read the following files in this order:

1. `README.md`
2. `docs/requirements.md`
3. `docs/basic-design.md`
4. `docs/development-guide.md`
5. `SECURITY.md`
6. `RELEASE_AUDIT.md`
7. `THIRD_PARTY_NOTICES.md`
8. `LICENSE`
9. `NOTICE`

Implementation must remain traceable to the approved requirements and basic design.

If these documents conflict, stop implementation and request a design decision. Do not resolve the conflict by assumption.

---

## 3. Architecture Baseline

The approved baseline architecture is:

```text
Contact Form
    |
    v
EmDash CMS
    |
    v
EmDash CMS Plugin
    |
    v
Cloudflare Workers
    |
    +--> Cloudflare Turnstile
    |
    +--> Cloudflare Queues
    |        |
    |        +--> DLQ
    |
    +--> Cloudflare D1
    |
    v
Microsoft Entra ID
    |
    v
Microsoft Graph sendMail
    |
    v
Exchange Online
```

| Layer | Technology | Responsibility |
|---|---|---|
| CMS | EmDash CMS | Contact form and plugin execution |
| Plugin | EmDash CMS Plugin | EmDash integration and request handoff |
| Edge Runtime | Cloudflare Workers | Server-side processing |
| Abuse Protection | Cloudflare Turnstile | Bot protection |
| Async Processing | Cloudflare Queues | Asynchronous mail processing and retry |
| Dead Letter | Cloudflare Queues DLQ | Failed job isolation |
| State | Cloudflare D1 | Minimal delivery and idempotency state |
| Secret Store | Cloudflare Secrets | Credential protection |
| Identity | Microsoft Entra ID | Application authentication |
| Mail API | Microsoft Graph | `sendMail` operation |
| Mail System | Exchange Online | Mailbox and mail delivery |

Do not introduce additional cloud services unless an architecture review approves the change.

---

## 4. Engineering Principles

### 4.1 Least Privilege

Apply least privilege across:

- EmDash CMS capabilities
- network access
- Cloudflare
- Microsoft Entra ID
- Microsoft Graph
- Exchange Online

Every permission must have a documented reason. A permission without a justified requirement must not be granted.

### 4.2 Data Minimization

Store and log only the information required for operation.

Do not normally log:

- inquiry body
- complete email addresses
- access tokens
- client secrets
- private keys
- credentials
- authentication headers

### 4.3 Fail Closed

If authentication, Turnstile validation, authorization, capability enforcement, destination validation, or another security validation fails, stop processing.

Do not bypass a security control to keep message delivery working.

### 4.4 No API Guessing

Never invent:

- EmDash CMS API methods
- Plugin capabilities
- hook names
- event types
- message types
- context types
- manifest properties

If an interface cannot be confirmed from official documentation or the target runtime, treat it as unresolved.

---

## 5. Git Workflow

### 5.1 Branch Model

```text
main
  ^
  |
develop
  ^
  |
feature/*
```

Additional branch prefixes may be used:

- `fix/*`
- `docs/*`
- `refactor/*`
- `test/*`

### 5.2 Branch Rules

#### `main`

- Direct commits are prohibited.
- Used only for approved releases.

#### `develop`

- Integration branch for development.
- Direct commits are prohibited unless explicitly approved.

#### Work branches

Create each work branch from the latest `develop`.

Examples:

```text
feature/phase0-plugin-validation
feature/cloudflare-mail-worker
feature/graph-sendmail
fix/queue-idempotency
docs/security-update
```

### 5.3 Merge Flow

```text
develop
   |
   +--> feature/*
           |
           +--> implementation
           +--> tests
           +--> documentation
           |
           v
       Pull Request
           |
           +--> CI
           +--> Review
           +--> Security checks
           |
           v
        develop
```

Changes reach `main` only through the release process.

---

## 6. Development Phases

| Phase | Purpose | Implementation |
|---|---|---|
| Phase 0 | EmDash compatibility and security validation | No production implementation |
| Phase 1 | Plugin foundation | Allowed after Phase 0 GO |
| Phase 2 | Cloudflare integration | Implementation |
| Phase 3 | Microsoft 365 integration | Implementation |
| Phase 4 | Integration and failure testing | Testing |
| Phase 5 | Release validation | Release preparation |

Phase 0 is a mandatory gate.

---

## 7. Phase 0: Compatibility Gate

### 7.1 Objective

Confirm that the approved design can be implemented against the target EmDash CMS environment.

Phase 0 must verify rather than assume. Production implementation must not begin during Phase 0.

### G0: EmDash CMS Version

Confirm:

- [ ] Target product is EmDash CMS
- [ ] Target EmDash CMS version is identified
- [ ] Plugin API version is identified
- [ ] Plugin CLI version is identified
- [ ] Sandbox Runner compatibility is confirmed
- [ ] Required Plugin API exists
- [ ] Assumed email-delivery integration matches the actual API
- [ ] Required Message and Context types are confirmed

**NO-GO condition:** The target version or required API cannot be confirmed.

### G1: Plugin Model

Determine whether the plugin can use the sandboxed model.

Default:

> **Sandboxed Plugin**

Confirm whether any of the following requires a Native Plugin:

- [ ] React Admin UI
- [ ] Astro components
- [ ] direct host-process access
- [ ] Portable Text integration
- [ ] native site integration

If sandbox execution satisfies the requirements, do not use Native Plugin. Document any decision to use Native Plugin in an Architecture Decision Record.

### G2: Runtime

Confirm:

- [ ] Node.js version
- [ ] pnpm version
- [ ] EmDash CMS test environment
- [ ] Plugin CLI
- [ ] Sandbox Runner
- [ ] Minimal plugin loads successfully
- [ ] Smoke test passes

Pin runtime versions where practical.

Do not begin Phase 1 if the basic plugin cannot run in the target Sandbox Runner.

### G3: Plugin Identity

Determine:

- [ ] publisher
- [ ] publisher DID
- [ ] slug
- [ ] package name
- [ ] repository
- [ ] author
- [ ] security contact

Confirm that the selected `publisher + slug` combination does not conflict with an existing package. Prefer a stable DID for publisher identity.

### G4: Plugin Manifest

Create and validate:

`emdash-plugin.jsonc`

Review at minimum:

- [ ] `$schema`
- [ ] `slug`
- [ ] `publisher`
- [ ] `license`
- [ ] `author` or `authors`
- [ ] `security`
- [ ] `description`
- [ ] `capabilities`
- [ ] `allowedHosts`
- [ ] `storage`
- [ ] `repo`
- [ ] release compatibility

License:

```text
Apache-2.0
```

Manifest metadata and `package.json` must remain consistent.

### G5: Capability Review

Document every requested capability:

| Capability | Purpose | Consumer | Reason | Alternative | Approved |
|---|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD | No |

For each capability:

- [ ] Official capability name verified
- [ ] Requirement identified
- [ ] Consumer identified
- [ ] Security impact reviewed
- [ ] Alternative considered
- [ ] Minimal scope confirmed

Do not invent capability names.

**NO-GO condition:** Any requested capability lacks a justified requirement.

### G6: Network Boundary

Preferred trust boundary:

```text
EmDash Plugin
      |
      v
Cloudflare Workers
      |
      +--> Microsoft Entra ID
      |
      +--> Microsoft Graph
```

The Plugin should not hold Microsoft credentials unless an approved requirement makes this unavoidable.

Document all external connections:

| Source | Destination | Purpose | Authentication | Secret Location | Approved |
|---|---|---|---|---|---|
| EmDash Plugin | Cloudflare Workers | Request handoff | TBD | TBD | No |
| Cloudflare Workers | Microsoft Entra ID | Token acquisition | Application credential | Cloudflare Secrets | No |
| Cloudflare Workers | Microsoft Graph | `sendMail` | OAuth 2.0 access token | Memory only | No |

Review:

- [ ] `allowedHosts`
- [ ] wildcard usage
- [ ] TLS
- [ ] timeouts
- [ ] authentication
- [ ] failure behavior

Do not grant broad wildcard network access without explicit approval.

### G7: Secrets

Never store secrets in:

- source files
- `emdash-plugin.jsonc`
- `package.json`
- Plugin Storage
- test fixtures
- committed `.env` files
- logs

Use an approved Secret Store such as Cloudflare Secrets.

Define:

- [ ] secret owner
- [ ] storage location
- [ ] rotation process
- [ ] revocation process
- [ ] incident procedure

A leaked credential must be revoked or rotated. Removing it from Git history alone is not sufficient.

### G8: Public API Security

Inventory every endpoint:

| Route | Method | Exposure | Auth | CSRF | Turnstile | Rate Limit | Max Size |
|---|---|---|---|---|---|---|---|
| TBD | TBD | Public / Private | TBD | TBD | TBD | TBD | TBD |

Validate at least:

- [ ] Turnstile token
- [ ] content type
- [ ] request size
- [ ] required fields
- [ ] field length
- [ ] email format
- [ ] malformed JSON
- [ ] unexpected fields
- [ ] CR/LF injection
- [ ] rate limiting

The user must not be allowed to provide arbitrary From, To, CC, or BCC values. Trusted mail destinations must come from server-side configuration.

### G9: Data and PII

Classify every data element:

| Data | PII | Storage | Logging | Retention | Deletion |
|---|---|---|---|---|---|
| `submissionId` | No | D1 | Allowed | TBD | TBD |
| Name | Yes | TBD | Avoid | TBD | TBD |
| Email | Yes | TBD | Mask or hash | TBD | TBD |
| Inquiry body | Yes or potentially sensitive | Avoid persistent storage | Prohibited | Minimum required | TBD |
| Access token | Secret | No persistent storage | Prohibited | Memory only | Automatic |

D1 should hold only the minimum state required for delivery and idempotency. Do not store credentials in D1.

### G10: Retry, Idempotency, and DLQ

Classify Microsoft Graph and network failures:

| Condition | Expected Handling |
|---|---|
| HTTP 202 | Accepted by Graph, not proof of final delivery |
| HTTP 400 | Non-retry unless specifically justified |
| HTTP 401 | Authentication failure, investigate |
| HTTP 403 | Authorization failure, investigate |
| HTTP 429 | Retry according to service guidance |
| HTTP 5xx | Retry transient failures |
| Timeout | Retry based on idempotency guarantees |

Cloudflare Queues must use finite retries.

After retry exhaustion:

```text
Queue -> retry -> retry exhausted -> DLQ
```

#### Idempotency

Recommended logical key:

```text
submissionId + messageType
```

Tests must demonstrate that duplicate queue processing does not produce duplicate messages.

### G11: Validation and CI

Where supported by the generated project, run:

```text
pnpm run validate
pnpm run typecheck
pnpm run test
pnpm run build
```

Before using these commands, confirm that they exist in `package.json`. Never invent a script simply because this guide references the expected operation.

Required CI categories:

- [ ] Manifest validation
- [ ] Type checking
- [ ] Unit tests
- [ ] Build
- [ ] Secret scanning
- [ ] Dependency vulnerability scanning
- [ ] License scanning

A mandatory CI failure blocks merge.

### G12: OSS and Licensing

Repository license:

```text
Apache-2.0
```

Maintain:

- `LICENSE`
- `NOTICE`
- `THIRD_PARTY_NOTICES.md`
- `RELEASE_AUDIT.md`

Before release:

- [ ] Direct dependency licenses reviewed
- [ ] Transitive dependency licenses reviewed
- [ ] Copied source reviewed
- [ ] Required attribution preserved
- [ ] NOTICE obligations reviewed
- [ ] Incompatible dependencies removed

---

## 8. Phase 0 Decision

Allowed decisions:

- `GO`
- `CONDITIONAL GO`
- `NO-GO`

Individual checks use:

- `PASS`
- `CONDITIONAL PASS`
- `FAIL`
- `N/A`
- `NOT REVIEWED`

### 8.1 GO

GO requires:

- all mandatory Gates passed
- no Must item is `FAIL`
- no Must item is `NOT REVIEWED`
- no unresolved Critical risk
- no unresolved High risk
- no blocking issue
- required reviewers have approved

Required review roles:

- Product Manager
- CTO
- Principal Architect
- Security Reviewer

### 8.2 CONDITIONAL GO

Permitted only when:

- no Must item has failed
- no Critical risk exists
- no High risk exists
- remaining work does not affect implementation safety
- every remaining item has an owner
- every remaining item has a due date
- every remaining item has explicit completion criteria

Do not use CONDITIONAL GO to bypass unresolved authentication, authorization, secrets, PII, security, or licensing issues.

### 8.3 NO-GO

NO-GO is mandatory if any of the following remains unresolved:

- EmDash CMS version
- required Plugin API
- Plugin model
- capabilities
- `allowedHosts`
- secret management
- Public Route security
- PII handling
- Critical vulnerability
- High security risk
- Apache-2.0 compatibility

Phase 1 must not begin under NO-GO.

---

## 9. Phase 1 and Later Development Procedure

After Phase 0 GO:

1. Update `develop`.
2. Create a work branch.
3. Identify Requirement IDs.
4. Identify applicable design sections.
5. Identify acceptance criteria.
6. Define tests.
7. Implement the smallest coherent change.
8. Run required tests.
9. Update documentation.
10. Create a Pull Request.
11. Complete CI.
12. Complete review.
13. Merge only after approval.

Every implementation change must be traceable to an approved requirement.

---

## 10. Microsoft 365 Integration

### 10.1 Microsoft Entra ID

Use an approved application identity for machine-to-machine authentication.

Apply minimum permissions. The credential mechanism must be reviewed before production use.

### 10.2 Microsoft Graph

Use Microsoft Graph `sendMail` for mail submission.

Handle at minimum:

- `202`
- `400`
- `401`
- `403`
- `429`
- `5xx`
- timeout

Do not treat `202 Accepted` as confirmation of final Exchange Online delivery.

### 10.3 Exchange Online

Use a dedicated sending mailbox.

Limit the application to the intended mailbox. Prefer Exchange Online RBAC for Applications where applicable.

Do not grant unnecessary organization-wide mailbox access.

---

## 11. Logging and Error Handling

### 11.1 Logging

Never normally log:

- inquiry body
- access token
- secret
- credential
- authentication header
- complete email address

Use non-sensitive identifiers such as `submissionId`.

Mask or hash email addresses when correlation requires them.

### 11.2 User-facing Errors

Never expose:

- stack traces
- sensitive Microsoft Graph response content
- credentials
- authentication tokens
- internal configuration
- secret values

Return generalized errors to the client. Keep diagnostic information server-side.

---

## 12. Testing

### 12.1 Unit Tests

Cover:

- input validation
- message construction
- idempotency
- error classification
- retry decisions

### 12.2 Security Tests

Cover:

- invalid Turnstile token
- missing Turnstile token
- malformed input
- oversized request
- CR/LF injection
- rate-limit violation
- unauthorized access
- destination manipulation

### 12.3 Integration Tests

Cover:

- Cloudflare Queues
- Cloudflare D1
- Microsoft Entra ID authentication
- Microsoft Graph `sendMail`
- Exchange Online RBAC scope

### 12.4 Failure Tests

Cover:

- Graph `400`
- Graph `401`
- Graph `403`
- Graph `429`
- Graph `5xx`
- timeout
- queue retry
- DLQ
- duplicate processing

---

## 13. Pull Request Requirements

Each Pull Request must document:

### Purpose

What changed and why.

### Requirements

Applicable Requirement IDs.

### Design

Applicable sections of `docs/basic-design.md`.

### Security Impact

State impacts to:

- capabilities
- network access
- secrets
- PII
- authentication
- authorization

### Tests

List executed tests and results.

### Breaking Changes

State whether a breaking change exists.

### Documentation

List updated documentation.

---

## 14. Review Checklist

Reviewers verify:

- [ ] Requirement compliance
- [ ] Basic Design compliance
- [ ] Minimal capabilities
- [ ] Minimal network permissions
- [ ] No committed secrets
- [ ] No unnecessary PII
- [ ] Input validation
- [ ] Error handling
- [ ] Retry behavior
- [ ] Idempotency
- [ ] Tests
- [ ] Dependency security
- [ ] Licensing
- [ ] Documentation

Human-written and AI-generated code are reviewed under the same standard.

---

## 15. Dependency Policy

Before adding a dependency, determine:

1. Why is it required?
2. Can a platform or standard API replace it?
3. Is it maintained?
4. Does it contain known vulnerabilities?
5. What license does it use?
6. Which transitive dependencies are introduced?

Do not add a dependency with unresolved licensing or serious security concerns. Dependency changes require PR review.

---

## 16. Security Incident Rule

Follow `SECURITY.md`.

Do not publish vulnerability details in a public issue when the security policy requires private reporting.

If credentials may have leaked:

1. Revoke or rotate the credential.
2. Contain unauthorized access.
3. Investigate usage.
4. Remove the credential from source and history where necessary.
5. Document corrective action.

Code cleanup alone does not invalidate a compromised credential.

---

## 17. Phase 0 Re-review Triggers

Repeat Phase 0 review if any of the following changes:

- EmDash CMS version
- Sandboxed to Native Plugin
- capabilities
- `allowedHosts`
- Public API Routes
- authentication model
- CSRF strategy
- Turnstile strategy
- rate limiting
- Microsoft Graph connection boundary
- Microsoft Entra ID authentication
- secret storage
- PII storage
- data retention
- Queue strategy
- DLQ strategy
- idempotency strategy
- production dependencies
- license obligations

Also repeat the relevant review if a Critical or High vulnerability is discovered.

---

## 18. AI Coding Agent Rules

GitHub Copilot and other coding agents must not:

1. Commit directly to `main`.
2. Bypass the normal `develop` and work-branch workflow.
3. Begin production implementation before Phase 0 GO.
4. Guess undocumented EmDash APIs.
5. Invent capability names.
6. Add unnecessary capabilities.
7. Add broad `allowedHosts` wildcards without approval.
8. Store secrets in source control.
9. Commit `.env` files containing secrets.
10. Add real tenant credentials to fixtures.
11. Permit arbitrary From, To, CC, or BCC destinations.
12. Log inquiry bodies by default.
13. Persist access tokens.
14. Disable security controls to make tests pass.
15. Delete tests merely to make CI pass.
16. Hide type errors with unjustified `any`.
17. Copy code with an unknown or incompatible license.
18. Add dependencies without justification.
19. Change architecture without approval.
20. Bypass Go/No-Go criteria.

---

## 19. Stop Conditions for AI Agents

Stop implementation and request a decision if:

- official documentation conflicts with approved design
- actual EmDash behavior differs from the design
- required capability is unknown
- Public Route security contract is unclear
- additional Microsoft Graph permission is required
- Exchange Online scope must be expanded
- a new secret is required
- PII retention must increase
- architecture must change
- licensing compatibility is unclear

Do not resolve these conditions through assumption.

---

## 20. Definition of Done

A feature is complete only when:

- [ ] Requirement satisfied
- [ ] Acceptance criteria satisfied
- [ ] Basic Design followed
- [ ] Unit tests pass
- [ ] Integration tests pass where applicable
- [ ] Security tests pass
- [ ] Type check passes
- [ ] Build passes
- [ ] Secret scan passes
- [ ] Vulnerability scan passes
- [ ] License scan passes
- [ ] Documentation updated
- [ ] PR approved
- [ ] No unresolved Critical issue
- [ ] No unresolved High issue

---

## 21. GitHub Copilot Session Start Procedure

At the beginning of a development session:

1. Read `README.md`.
2. Read `docs/requirements.md`.
3. Read `docs/basic-design.md`.
4. Read `docs/development-guide.md`.
5. Read `SECURITY.md`.
6. Read `RELEASE_AUDIT.md`.
7. Read `THIRD_PARTY_NOTICES.md`.
8. Inspect the repository structure.
9. Confirm the current Git branch.
10. Confirm Phase 0 status.
11. Identify applicable Requirement IDs.
12. Identify acceptance criteria.
13. Inspect existing tests.
14. Produce an implementation plan.
15. List unresolved assumptions or design conflicts.

If Phase 0 is not GO, do not begin Phase 1 implementation.

---

## 22. Decision Priority

When instructions conflict, use the following priority:

1. Security
2. Approved Requirements
3. Approved Basic Design
4. Phase 0 Go/No-Go Decision
5. Data Protection
6. Least Privilege
7. Testability
8. Reliability
9. Maintainability
10. Implementation Convenience

Implementation convenience is never sufficient justification for weakening security or changing approved requirements.

---

## 23. Core Rules

> **Verify first, implement second.**

> **Least privilege by default.**

> **Fail closed.**

> **Do not guess APIs or security contracts.**

> **No implementation before Phase 0 GO.**

> **No direct commits to `main`.**

> **No secrets in source control.**

> **Every implementation must be traceable to an approved requirement and acceptance criterion.**
