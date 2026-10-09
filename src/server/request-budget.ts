import { hash, SyncError } from "../sync/protocol";
import type { MetadataStore } from "./storage";
import type { ServerMaintenance } from "./maintenance";

export interface RequestPolicy {
  serviceDailyRequests: number;
  accountDailyRequests: number;
  grantRequests: number;
}
const defaults: RequestPolicy = {
  serviceDailyRequests: 2_000_000,
  accountDailyRequests: 50_000,
  grantRequests: 32,
};
interface Credits {
  remaining: number;
  expires: number;
  filling?: Promise<void>;
  blocked?: boolean;
}
export class RequestBudgets {
  readonly policy: RequestPolicy;
  private credits = new Map<string, Credits>();
  constructor(
    readonly db: MetadataStore,
    readonly maintenance: ServerMaintenance,
    policy: Partial<RequestPolicy> = {},
  ) {
    if (Object.keys(policy).some((key) => !Object.hasOwn(defaults, key)))
      throw new Error("Unknown request policy field.");
    this.policy = { ...defaults, ...policy };
    if (
      Object.values(this.policy).some(
        (value) => !Number.isSafeInteger(value) || value < 1,
      ) ||
      this.policy.grantRequests > 64
    )
      throw new Error(
        "Request policy values must be positive integers and grants at most 64.",
      );
  }
  private async key(unit: string, day: number) {
    return hash(`showai-request-budget:${day}:${unit}`);
  }
  async consume(account?: string) {
    const now = Date.now(),
      day = Math.floor(now / 86400_000),
      expires = (day + 1) * 86400_000,
      unit = account ? `account:${account}` : "service";
    let credit = this.credits.get(unit);
    if (!credit || credit.expires !== expires) {
      credit = { remaining: 0, expires };
      this.credits.set(unit, credit);
    }
    while (credit.remaining < 1) {
      if (credit.blocked)
        throw new SyncError(
          429,
          "REQUEST_BUDGET_EXCEEDED",
          "今日请求预算已达上限，本地修改保留。",
          { retryAfter: Math.max(1, Math.ceil((expires - Date.now()) / 1000)) },
        );
      const filling = (credit.filling ??= this.grant(
        unit,
        day,
        expires,
        credit,
      ));
      try {
        await filling;
      } finally {
        if (credit.filling === filling) credit.filling = undefined;
      }
    }
    credit.remaining--;
    if (this.credits.size > 10001)
      for (const [key, value] of this.credits)
        if (value.expires <= now) this.credits.delete(key);
  }
  private async grant(
    unit: string,
    day: number,
    expires: number,
    credit: Credits,
  ) {
    let lease: string;
    try {
      lease = await this.maintenance.enterWrite("metadata");
    } catch (error) {
      // Frozen reads cannot mutate the exported counters. Edge/source rate
      // protection still applies; data writes are rejected by their admission.
      if (error instanceof SyncError && error.code === "SERVER_READ_ONLY") {
        credit.remaining = 1;
        return;
      }
      throw error;
    }
    try {
      const limit =
          unit === "service"
            ? this.policy.serviceDailyRequests
            : this.policy.accountDailyRequests,
        grant = Math.min(this.policy.grantRequests, limit),
        key = await this.key(unit, day);
      const result = await this.db.run(
        "INSERT INTO request_limits(key,expires_at,hits) SELECT ?,?,? WHERE COALESCE((SELECT hits FROM request_limits WHERE key=?),0)+?<=? ON CONFLICT(key) DO UPDATE SET hits=hits+excluded.hits,expires_at=excluded.expires_at",
        [key, expires, grant, key, grant, limit],
      );
      if (!result.changes) {
        credit.blocked = true;
        throw new SyncError(
          429,
          "REQUEST_BUDGET_EXCEEDED",
          "今日请求预算已达上限，本地修改保留。",
          {
            retryAfter: Math.max(1, Math.ceil((expires - Date.now()) / 1000)),
            unit: unit === "service" ? "service" : "account",
          },
        );
      }
      credit.remaining += grant;
    } finally {
      await this.maintenance.leaveWrite(lease);
    }
  }
  async usage() {
    const day = Math.floor(Date.now() / 86400_000),
      key = await this.key("service", day);
    const row = (
      await this.db.all<{ hits: number }>(
        "SELECT hits FROM request_limits WHERE key=?",
        [key],
      )
    )[0];
    return {
      day: new Date(day * 86400_000).toISOString(),
      policy: this.policy,
      serviceReservedRequests: row?.hits ?? 0,
      measurement: "reserved-request-credits",
    };
  }
}
