import {
  ALLOWED_HOSTS_VAR,
  evaluatePublishGate,
  evaluateRuntimeGuard,
  getRequestHostname,
  isHostAllowed,
  isLocalDevDatabaseUrl,
  isLoopbackHostname,
  normalizeHostname,
  parseAllowedHosts,
  type GuardDenyCode,
} from "../runtime-guard";

const PROD = {
  appEnv: "production",
  nodeEnv: "production",
} as const;

function decide(overrides: Partial<Parameters<typeof evaluateRuntimeGuard>[0]> = {}) {
  return evaluateRuntimeGuard({
    kind: "publish",
    hostname: "narrativehealth.app",
    allowedHosts: ["narrativehealth.app"],
    ...PROD,
    ...overrides,
  });
}

describe("normalizeHostname", () => {
  it("strips scheme, path, credentials, port and trailing dot", () => {
    expect(normalizeHostname("https://NarrativeHealth.app/path?x=1")).toBe("narrativehealth.app");
    expect(normalizeHostname("user:pass@Example.com:3000")).toBe("example.com");
    expect(normalizeHostname("example.com.")).toBe("example.com");
    expect(normalizeHostname("[::1]:3000")).toBe("::1");
    expect(normalizeHostname("  ")).toBeNull();
  });

  it("keeps a bare IPv6 loopback intact", () => {
    expect(normalizeHostname("::1")).toBe("::1");
  });
});

describe("parseAllowedHosts / isHostAllowed", () => {
  it("parses comma/space separated lists and drops duplicates", () => {
    expect(parseAllowedHosts("a.com, b.com  A.COM ,,")).toEqual(["a.com", "b.com"]);
    expect(parseAllowedHosts(undefined)).toEqual([]);
  });

  it("supports wildcard subdomains only one level below the suffix", () => {
    const list = ["*.example.com", "exact.test"];
    expect(isHostAllowed("api.example.com", list)).toBe(true);
    expect(isHostAllowed("deep.api.example.com", list)).toBe(true);
    expect(isHostAllowed("example.com", list)).toBe(false);
    expect(isHostAllowed("badexample.com", list)).toBe(false);
    expect(isHostAllowed("exact.test", list)).toBe(true);
  });
});

describe("isLoopbackHostname", () => {
  it("recognises loopback forms", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("api.localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("127.10.0.9")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("narrativehealth.app")).toBe(false);
  });
});

describe("isLocalDevDatabaseUrl", () => {
  it("accepts a loopback dev/test database", () => {
    expect(isLocalDevDatabaseUrl("postgresql+asyncpg://u:p@localhost:5432/narrative_health_dev")).toBe(true);
    expect(isLocalDevDatabaseUrl("postgresql://u:p@127.0.0.1:5432/narrative_health_test")).toBe(true);
    expect(isLocalDevDatabaseUrl("postgresql://u:p@[::1]:5432/local_db")).toBe(true);
  });

  it("rejects remote, production-looking and ambiguous URLs", () => {
    expect(isLocalDevDatabaseUrl(undefined)).toBe(false);
    expect(isLocalDevDatabaseUrl("")).toBe(false);
    expect(isLocalDevDatabaseUrl("postgresql+asyncpg://u:p@168.138.179.192:5432/mdd")).toBe(false);
    expect(isLocalDevDatabaseUrl("postgresql://u:p@db.internal:5432/narrative_health_dev")).toBe(false);
    expect(isLocalDevDatabaseUrl("postgresql://u:p@localhost:5432/narrative_health")).toBe(false);
  });
});

describe("development writes", () => {
  const DEV_DB = "postgresql+asyncpg://u:p@localhost:5432/narrative_health_dev";

  it("allows write and scheduler against a local dev database", () => {
    for (const kind of ["write", "scheduler"] as const) {
      const decision = evaluateRuntimeGuard({
        kind,
        hostname: "localhost:3000",
        appEnv: "development",
        nodeEnv: "development",
        allowedHosts: [],
        databaseUrl: DEV_DB,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.mode).toBe("read-write");
    }
  });

  it("stays read-only when DATABASE_URL points at a remote database", () => {
    const decision = evaluateRuntimeGuard({
      kind: "write",
      hostname: "localhost:3000",
      appEnv: "development",
      nodeEnv: "development",
      allowedHosts: [],
      databaseUrl: "postgresql+asyncpg://u:p@168.138.179.192:5432/mdd",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe<GuardDenyCode>("ENV_NOT_PRODUCTION");
    expect(decision.message).toContain("DATABASE_URL");
  });

  it("never allows publishing from development, even with a dev database", () => {
    const decision = evaluateRuntimeGuard({
      kind: "publish",
      hostname: "localhost:3000",
      appEnv: "development",
      nodeEnv: "development",
      allowedHosts: [],
      databaseUrl: DEV_DB,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe<GuardDenyCode>("ENV_NOT_PRODUCTION");
  });
});

describe("evaluateRuntimeGuard", () => {
  it("allows an allowlisted hostname in production", () => {
    const decision = decide();
    expect(decision.allowed).toBe(true);
    expect(decision.mode).toBe("read-write");
  });

  it("is read-only when APP_ENV is not production, even for an allowlisted host", () => {
    for (const appEnv of [undefined, "", "development", "staging", "Production "]) {
      const decision = decide({ appEnv });
      if (appEnv === "Production ") {
        // trim + lowercase vẫn là production
        expect(decision.allowed).toBe(true);
        continue;
      }
      expect(decision.allowed).toBe(false);
      expect(decision.code).toBe<GuardDenyCode>("ENV_NOT_PRODUCTION");
      expect(decision.mode).toBe("read-only");
    }
  });

  it("denies publish from a preview/dev hostname even with APP_ENV=production", () => {
    const decision = decide({
      hostname: "pv-39bfdc6c6559-5b719ba8-5467.style.dev",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("HOST_NOT_ALLOWED");
    expect(decision.message).toContain("read-only");
  });

  it("blocks loopback from a dev server even when APP_ENV=production", () => {
    const decision = decide({
      kind: "scheduler",
      hostname: "localhost:3000",
      nodeEnv: "development",
      allowedHosts: ["narrativehealth.app"],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("HOST_NOT_ALLOWED");
  });

  it("allows the loopback scheduler in a production build", () => {
    const decision = decide({
      kind: "scheduler",
      hostname: "localhost:3000",
      allowedHosts: ["narrativehealth.app"],
    });
    expect(decision.allowed).toBe(true);
  });

  it("fails closed when the allowlist is empty", () => {
    const decision = decide({ allowedHosts: [] });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("HOST_ALLOWLIST_MISSING");
    expect(decision.message).toContain(ALLOWED_HOSTS_VAR);
  });

  it("denies a request with no Host header", () => {
    const decision = decide({ hostname: null });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("HOST_UNKNOWN");
  });
});

describe("getRequestHostname", () => {
  it("prefers Host over X-Forwarded-Host", () => {
    const headers = new Headers({
      host: "narrativehealth.app:443",
      "x-forwarded-host": "spoofed.example",
    });
    expect(getRequestHostname({ headers })).toBe("narrativehealth.app");
  });

  it("falls back to the first X-Forwarded-Host entry", () => {
    const headers = new Headers({ "x-forwarded-host": "narrativehealth.app, proxy.internal" });
    expect(getRequestHostname({ headers })).toBe("narrativehealth.app");
  });
});

describe("evaluatePublishGate", () => {
  // @types/node khai báo NODE_ENV là read-only — cast để test đổi runtime.
  const env = process.env as Record<string, string | undefined>;
  const saved = { APP_ENV: env.APP_ENV, NODE_ENV: env.NODE_ENV };

  afterEach(() => {
    if (saved.APP_ENV === undefined) delete env.APP_ENV;
    else env.APP_ENV = saved.APP_ENV;
    if (saved.NODE_ENV === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = saved.NODE_ENV;
  });

  it("allows publishing only in a production runtime build", () => {
    env.APP_ENV = "production";
    env.NODE_ENV = "production";
    expect(evaluatePublishGate().allowed).toBe(true);
  });

  it("blocks publishing from a dev server whose .env says production", () => {
    env.APP_ENV = "production";
    env.NODE_ENV = "development";
    const gate = evaluatePublishGate();
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("NODE_ENV");
  });

  it("blocks publishing when APP_ENV is missing", () => {
    delete env.APP_ENV;
    env.NODE_ENV = "production";
    const gate = evaluatePublishGate();
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("APP_ENV");
  });
});
