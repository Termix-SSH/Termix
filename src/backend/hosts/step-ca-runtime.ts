import { createClient } from "redis";
import { sshLogger } from "../utils/logger.js";
import {
  decryptSystemSecret,
  encryptSystemSecret,
} from "../utils/system-secret-crypto.js";

export interface StepCaCallbackQuery {
  state?: string;
  code?: string;
  error?: string;
  error_description?: string;
}

export interface StepCaCallbackResult {
  ok: boolean;
  message: string;
}

const PREFIX =
  process.env.TERMIX_STEP_CA_REDIS_PREFIX?.trim() || "termix:step-ca";
const SESSION_TTL_SECONDS = 5 * 60;
const RESULT_TTL_SECONDS = 60;
const CONNECT_RETRY_MS = 15_000;

export class StepCaRuntime {
  private client: ReturnType<typeof createClient> | null = null;
  private connecting: Promise<boolean> | null = null;
  private nextConnectAttempt = 0;

  async register(state: string): Promise<void> {
    if (!(await this.ensureConnected()) || !this.client) return;
    await this.client
      .set(this.routeKey(state), "active", { EX: SESSION_TTL_SECONDS })
      .catch((error) => this.logFailure("register", error));
  }

  async submit(state: string, query: StepCaCallbackQuery): Promise<boolean> {
    if (!(await this.ensureConnected()) || !this.client) return false;
    try {
      if (!(await this.client.exists(this.routeKey(state)))) return false;
      const encrypted = await encryptSystemSecret(JSON.stringify(query));
      const stored = await this.client.set(this.commandKey(state), encrypted, {
        EX: SESSION_TTL_SECONDS,
        NX: true,
      });
      return stored === "OK";
    } catch (error) {
      this.logFailure("submit", error);
      return false;
    }
  }

  async takeCommand(state: string): Promise<StepCaCallbackQuery | null> {
    if (!(await this.ensureConnected()) || !this.client) return null;
    try {
      const encrypted = await this.client.getDel(this.commandKey(state));
      if (!encrypted) return null;
      return this.decode<StepCaCallbackQuery>(
        await decryptSystemSecret(encrypted.toString()),
      );
    } catch (error) {
      this.logFailure("take_command", error);
      return null;
    }
  }

  async complete(state: string, result: StepCaCallbackResult): Promise<void> {
    if (!(await this.ensureConnected()) || !this.client) return;
    try {
      const encrypted = await encryptSystemSecret(JSON.stringify(result));
      await this.client
        .multi()
        .set(this.resultKey(state), encrypted, { EX: RESULT_TTL_SECONDS })
        .del(this.routeKey(state))
        .del(this.commandKey(state))
        .exec();
    } catch (error) {
      this.logFailure("complete", error);
    }
  }

  async takeResult(state: string): Promise<StepCaCallbackResult | null> {
    if (!(await this.ensureConnected()) || !this.client) return null;
    try {
      const encrypted = await this.client.getDel(this.resultKey(state));
      if (!encrypted) return null;
      return this.decode<StepCaCallbackResult>(
        await decryptSystemSecret(encrypted.toString()),
      );
    } catch (error) {
      this.logFailure("take_result", error);
      return null;
    }
  }

  async remove(state: string): Promise<void> {
    if (!(await this.ensureConnected()) || !this.client) return;
    await this.client
      .del([
        this.routeKey(state),
        this.commandKey(state),
        this.resultKey(state),
      ])
      .catch((error) => this.logFailure("remove", error));
  }

  async close(): Promise<void> {
    if (this.client?.isOpen) await this.client.quit();
    this.client = null;
  }

  private async ensureConnected(): Promise<boolean> {
    const url = process.env.REDIS_URL?.trim();
    if (!url) return false;
    if (this.client?.isReady) return true;
    if (Date.now() < this.nextConnectAttempt) return false;
    if (this.connecting) return this.connecting;
    this.connecting = this.connect(url).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(url: string): Promise<boolean> {
    try {
      this.client = createClient({
        url,
        socket: { connectTimeout: 1500, reconnectStrategy: false },
      });
      this.client.on("error", (error) => this.logFailure("client", error));
      await this.client.connect();
      this.nextConnectAttempt = 0;
      return true;
    } catch (error) {
      this.nextConnectAttempt = Date.now() + CONNECT_RETRY_MS;
      this.logFailure("connect", error);
      await this.client?.disconnect().catch(() => {});
      this.client = null;
      return false;
    }
  }

  private routeKey(state: string): string {
    return `${PREFIX}:route:${state}`;
  }

  private commandKey(state: string): string {
    return `${PREFIX}:command:${state}`;
  }

  private resultKey(state: string): string {
    return `${PREFIX}:result:${state}`;
  }

  private decode<T>(raw: string): T | null {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private logFailure(operation: string, error: unknown): void {
    sshLogger.warn("Step CA Redis runtime unavailable", {
      operation: `step_ca_redis_${operation}`,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const stepCaRuntime = new StepCaRuntime();
