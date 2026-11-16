export interface GraphClientConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailbox: string;
  saveToSentItems: boolean;
}

export interface GraphMail {
  to: string[];
  replyTo?: string;
  subject: string;
  body: {
    contentType: "Text" | "HTML";
    content: string;
  };
}

export type GraphSendResult =
  | { kind: "accepted"; requestId?: string }
  | {
      kind: "retryable";
      status?: number;
      requestId?: string;
      retryAfterSeconds?: number;
      reason: "throttled" | "timeout" | "network-error" | "server-error";
    }
  | {
      kind: "permanent-failure";
      status: number;
      requestId?: string;
      reason: "unauthorized" | "client-error" | "unexpected-status";
    };

export class GraphAuthenticationError extends Error {
  readonly status?: number;

  constructor(status?: number) {
    super("Microsoft Entra token request failed");
    this.name = "GraphAuthenticationError";
    this.status = status;
  }
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

const UUID_PATTERN = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

class GraphNetworkError extends Error {}

export class GraphClient {
  private readonly config: GraphClientConfig;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private cachedToken?: { value: string; expiresAt: number };
  private tokenRequest?: Promise<string>;

  constructor(
    config: GraphClientConfig,
    fetcher: typeof fetch = fetch,
    now: () => number = Date.now,
  ) {
    if (!UUID_PATTERN.test(config.tenantId) || !UUID_PATTERN.test(config.clientId)) {
      throw new TypeError("Tenant and client IDs must be UUIDs");
    }
    if (!isEmailAddress(config.mailbox)) {
      throw new TypeError("The sender mailbox must be a single email address");
    }
    if (!config.clientSecret) {
      throw new TypeError("A client credential is required");
    }

    this.config = config;
    this.fetcher = fetcher;
    this.now = now;
  }

  async sendMail(mail: GraphMail): Promise<GraphSendResult> {
    validateMail(mail);

    let response: Response;
    try {
      const first = await this.requestGraph(mail);
      response = first.response;
      if (response.status === 401) {
        if (this.cachedToken?.value === first.token) {
          this.cachedToken = undefined;
        }
        response = (await this.requestGraph(mail)).response;
      }
    } catch (error) {
      if (error instanceof GraphNetworkError) {
        return { kind: "retryable", reason: "network-error" };
      }
      throw error;
    }

    const requestId = response.headers.get("request-id") ?? undefined;
    if (response.status === 202) {
      return { kind: "accepted", ...(requestId ? { requestId } : {}) };
    }
    if (response.status === 408 || response.status === 429) {
      const retryAfterSeconds = parseRetryAfter(
        response.headers.get("retry-after"),
        this.now(),
      );
      return {
        kind: "retryable",
        status: response.status,
        ...(requestId ? { requestId } : {}),
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
        reason: response.status === 429 ? "throttled" : "timeout",
      };
    }
    if (response.status >= 500) {
      return {
        kind: "retryable",
        status: response.status,
        ...(requestId ? { requestId } : {}),
        reason: "server-error",
      };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        kind: "permanent-failure",
        status: response.status,
        ...(requestId ? { requestId } : {}),
        reason: "unauthorized",
      };
    }
    if (response.status >= 400) {
      return {
        kind: "permanent-failure",
        status: response.status,
        ...(requestId ? { requestId } : {}),
        reason: "client-error",
      };
    }
    return {
      kind: "permanent-failure",
      status: response.status,
      ...(requestId ? { requestId } : {}),
      reason: "unexpected-status",
    };
  }

  private async requestGraph(
    mail: GraphMail,
  ): Promise<{ response: Response; token: string }> {
    const token = await this.getToken();
    try {
      return {
        response: await this.fetcher(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.config.mailbox)}/sendMail`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              message: {
                subject: mail.subject,
                body: mail.body,
                toRecipients: mail.to.map((address) => ({
                  emailAddress: { address },
                })),
                ...(mail.replyTo
                  ? {
                      replyTo: [
                        { emailAddress: { address: mail.replyTo } },
                      ],
                    }
                  : {}),
              },
              saveToSentItems: this.config.saveToSentItems,
            }),
          },
        ),
        token,
      };
    } catch {
      throw new GraphNetworkError();
    }
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken && this.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.value;
    }
    if (this.tokenRequest) return this.tokenRequest;

    this.tokenRequest = this.fetchToken();
    try {
      return await this.tokenRequest;
    } finally {
      this.tokenRequest = undefined;
    }
  }

  private async fetchToken(): Promise<string> {
    const endpoint = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`;
    const form = new URLSearchParams({
      client_id: this.config.clientId,
      scope: GRAPH_SCOPE,
      client_secret: this.config.clientSecret,
      grant_type: "client_credentials",
    });

    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
      });
    } catch {
      throw new GraphAuthenticationError();
    }
    if (!response.ok) throw new GraphAuthenticationError(response.status);

    let token: TokenResponse;
    try {
      token = (await response.json()) as TokenResponse;
    } catch {
      throw new GraphAuthenticationError(response.status);
    }
    if (
      typeof token.access_token !== "string" ||
      token.access_token.length === 0 ||
      typeof token.expires_in !== "number" ||
      !Number.isFinite(token.expires_in) ||
      token.expires_in <= 0
    ) {
      throw new GraphAuthenticationError(response.status);
    }

    const refreshBufferSeconds = Math.min(300, token.expires_in * 0.1);
    this.cachedToken = {
      value: token.access_token,
      expiresAt: this.now() + (token.expires_in - refreshBufferSeconds) * 1000,
    };
    return token.access_token;
  }
}

export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);

  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

function validateMail(mail: GraphMail): void {
  if (
    !Array.isArray(mail.to) ||
    mail.to.length === 0 ||
    mail.to.some((address) => !isEmailAddress(address))
  ) {
    throw new TypeError("At least one valid recipient is required");
  }
  if (mail.replyTo !== undefined && !isEmailAddress(mail.replyTo)) {
    throw new TypeError("Reply-To must be a single email address");
  }
  if (
    !mail.subject ||
    mail.subject.length > 200 ||
    /[\r\n]/.test(mail.subject)
  ) {
    throw new TypeError("Subject must be non-empty, at most 200 characters, and contain no CR/LF");
  }
  if (
    !mail.body ||
    (mail.body.contentType !== "Text" && mail.body.contentType !== "HTML") ||
    typeof mail.body.content !== "string"
  ) {
    throw new TypeError("A valid text or HTML message body is required");
  }
}

function isEmailAddress(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    EMAIL_PATTERN.test(value)
  );
}
