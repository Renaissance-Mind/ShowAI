import {
  digestId,
  hash,
  identifier,
  plainText,
  role,
  snapshotRevision,
  syncProtocol,
  token,
  validateSnapshot,
  SyncError,
  type ProjectRole,
  type ProjectSnapshot,
  type SyncProject,
} from "../sync/protocol";
import { type MetadataStore, type ObjectStore } from "./storage";
import { prepareMetadata } from "./migrations";
import { Revisions, type RevisionRow } from "./revisions";
import { verifiedStream, deadlineBody } from "./streams";
import { Quotas, type StoragePolicy } from "./quotas";
import { Uploads } from "./uploads";
import { ServerMaintenance } from "./maintenance";
import {
  createInvitation,
  acceptInvitation,
  revokeInvitation,
} from "./invitations";
import {
  audit,
  RateLimitError,
  rateLimit,
  readBounded,
  secureResponse,
  liveSession,
} from "./security";
import {
  registerAccount,
  loginAccount,
  changePassword,
  publicLimits,
  type AccountOptions,
  type AuthUser,
} from "./accounts";
import {
  validateReaderClosure,
  validatePackageClosure,
} from "../sync/dependency-validation";
import {
  serverBaseUrl,
  serverEndpoint,
  invitationUrl,
} from "../sync/server-url";

export interface ServerOptions extends AccountOptions {
  operationsKey?: string;
  metadata: MetadataStore;
  objects: ObjectStore;
  name?: string;
  publicUrl?: string;
  autoMigrate?: boolean;
  allowedOrigins?: string[];
  requirePublicOrigin?: boolean;
  storagePolicy?: Partial<StoragePolicy>;
}
interface Member {
  id: string;
  name: string;
  role: ProjectRole;
}
interface SessionRow extends AuthUser {
  session_digest: string;
}
interface ProjectRow {
  id: string;
  name: string;
  head: string | null;
  archived: number;
  role: ProjectRole;
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
const encoder = new TextEncoder();
function objectKey(projectId: string, digest: string) {
  return `projects/${identifier(projectId)}/objects/${digestId(digest)}`;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  const bytes = await readBounded(
    request,
    path.endsWith("/revisions") ? 16 * 1024 * 1024 : 64 * 1024,
  );
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SyncError(400, "INVALID_BODY", "A JSON object is required.");
  return value;
}

/** Identical request handler for Workers and the Linux HTTP host. */
export function createSyncServer(options: ServerOptions) {
  if (
    options.accountLimit !== undefined &&
    (!Number.isInteger(options.accountLimit) ||
      options.accountLimit < 1 ||
      options.accountLimit > 1_000_000)
  )
    throw new Error("Invalid account capacity.");
  if (
    options.registrationMode &&
    !["controlled", "open"].includes(options.registrationMode)
  )
    throw new Error("Invalid registration mode.");
  if (
    options.registrationLimit !== undefined &&
    (!Number.isInteger(options.registrationLimit) ||
      options.registrationLimit < 1 ||
      options.registrationLimit > 1000)
  )
    throw new Error("Invalid registration source limit.");
  for (const origin of options.allowedOrigins ?? [])
    if (new URL(origin).origin !== origin)
      throw new Error("Allowed origins must be exact HTTP origins.");
  const publicBase = options.publicUrl
    ? serverBaseUrl(options.publicUrl)
    : undefined;
  const basePath = publicBase
    ? new URL(publicBase).pathname.replace(/\/$/, "")
    : "";
  const publicOrigin = publicBase ? new URL(publicBase).origin : undefined;
  const allowedOrigins = options.allowedOrigins ?? [];
  const db = options.metadata,
    objects = options.objects;
  const revisions = new Revisions(db, objects);
  const quotas = new Quotas(db, options.storagePolicy);
  const uploads = new Uploads(db, objects, quotas);
  const maintenance = new ServerMaintenance(db, objects, options.operationsKey);
  let activeManifests = 0;
  const manifestWaiters: (() => void)[] = [];
  let initialization: Promise<string> | undefined;
  async function initialize() {
    await prepareMetadata(db, options.autoMigrate !== false);
    return (
      await db.all<{ value: string }>(
        "SELECT value FROM settings WHERE key='server_id'",
      )
    )[0].value;
  }
  const serverId = () => (initialization ??= initialize());
  async function authenticate(request: Request): Promise<SessionRow> {
    const credential = request.headers
      .get("authorization")
      ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!credential)
      throw new SyncError(401, "UNAUTHORIZED", "Sign in to this server.");
    const digest = await hash(credential);
    const rows = await db.all<SessionRow>(
      "SELECT u.id,u.name,u.auth_version,s.digest AS session_digest FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.digest=? AND s.revoked=0 AND s.auth_version=u.auth_version AND s.expires_at>?",
      [digest, new Date().toISOString()],
    );
    if (!rows[0])
      throw new SyncError(
        401,
        "UNAUTHORIZED",
        "The token has expired or was revoked.",
      );
    return rows[0];
  }
  async function projectFor(
    userId: string,
    projectId: string,
    minimum: ProjectRole = "viewer",
  ): Promise<ProjectRow> {
    const rows = await db.all<ProjectRow>(
      "SELECT p.*,m.role FROM projects p JOIN members m ON m.project_id=p.id WHERE p.id=? AND m.user_id=?",
      [identifier(projectId), userId],
    );
    const project = rows[0];
    if (!project)
      throw new SyncError(
        403,
        "FORBIDDEN",
        "You are not a member of this project.",
      );
    if (
      (minimum === "admin" && project.role !== "admin") ||
      (minimum === "editor" && project.role === "viewer")
    )
      throw new SyncError(
        403,
        "FORBIDDEN",
        "Your project role does not permit this action.",
      );
    return project;
  }
  function writeGate(
    user: SessionRow,
    projectId: string,
    minimum: "admin" | "editor" = "editor",
  ) {
    return {
      sql: `SELECT 1 FROM members m JOIN sessions s ON s.user_id=m.user_id JOIN users u ON u.id=m.user_id WHERE m.project_id=? AND m.user_id=? AND ${minimum === "admin" ? "m.role='admin'" : "m.role IN('admin','editor')"} AND s.digest=? AND s.revoked=0 AND s.expires_at>? AND s.auth_version=u.auth_version`,
      values: [
        projectId,
        user.id,
        user.session_digest,
        new Date().toISOString(),
      ],
    };
  }
  async function session(user: AuthUser, device: unknown) {
    const credential = token(),
      at = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();
    const credentialDigest = await hash(credential);
    const result = await db.batch([
      {
        sql: "INSERT INTO sessions(digest,user_id,device,created_at,expires_at,auth_version) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND auth_version=?) AND (SELECT COUNT(*) FROM sessions WHERE user_id=? AND revoked=0 AND expires_at>?)<100",
        values: [
          credentialDigest,
          user.id,
          typeof device === "string" ? plainText(device, 200) : "ShowAI",
          at,
          expiresAt,
          user.auth_version,
          user.id,
          user.auth_version,
          user.id,
          at,
        ],
      },
      audit(
        "session.create",
        user.id,
        null,
        {},
        {
          sql: "SELECT 1 FROM sessions WHERE digest=?",
          values: [credentialDigest],
        },
      ),
    ]);
    if (!result[0].changes)
      throw new SyncError(
        409,
        "SESSION_UNAVAILABLE",
        "账号凭据已更新或设备会话已达上限，请重新登录或撤销旧设备。",
      );
    return {
      protocol: syncProtocol,
      serverId: await serverId(),
      user: { id: user.id, name: user.name },
      token: credential,
      expiresAt,
    };
  }
  async function members(projectId: string) {
    return db.all<Member>(
      "SELECT u.id,u.name,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY u.name",
      [projectId],
    );
  }
  async function publicLimitsAccount(
    kind: "login" | "register",
    name: unknown,
  ) {
    await rateLimit(db, {
      scope: `${kind}:account`,
      identity: plainText(name, 100),
      maximum: kind === "login" ? 12 : 6,
      windowMs: kind === "login" ? 60_000 : 3600_000,
    });
  }
  async function handle(
    request: Request,
    source = "unknown",
  ): Promise<Response> {
    const url = new URL(request.url);
    if (
      options.requirePublicOrigin &&
      publicOrigin &&
      url.origin !== publicOrigin
    )
      throw new SyncError(
        421,
        "INVALID_HOST",
        "Use the configured server address.",
      );
    const origin = request.headers.get("origin");
    if (
      origin &&
      origin !== (publicOrigin ?? url.origin) &&
      !allowedOrigins.includes(origin)
    )
      throw new SyncError(
        403,
        "INVALID_ORIGIN",
        "This request origin is not allowed.",
      );
    if (
      basePath &&
      url.pathname !== basePath &&
      !url.pathname.startsWith(basePath + "/")
    )
      throw new SyncError(404, "NOT_FOUND", "Unknown server path.");
    const path = url.pathname.slice(basePath.length).replace(/\/$/, ""),
      method = request.method;
    await serverId();
    if (method === "OPTIONS") return new Response(null, { status: 204 });
    if (path.startsWith("/api/ops/")) return maintenance.handle(request, path);
    if (path === "/health" || path === "/api/info")
      return json({
        protocol: syncProtocol,
        serverId: await serverId(),
        name: options.name ?? "ShowAI Server",
        roles: ["admin", "editor", "viewer"],
        auth: ["password", "token"],
        registration: options.registrationMode ?? "controlled",
        passwordMinimum: 12,
        sessionDays: 30,
        capabilities: [
          "account-security-v1",
          "invite-controls-v1",
          "history-summary-v1",
          "object-manifests-v1",
          "storage-quotas-v1",
          "resumable-objects-v1",
          "batch-heads-v1",
        ],
      });
    if (path === "/api/auth/register" && method === "POST") {
      await publicLimits(
        db,
        "register",
        source,
        undefined,
        options.registrationLimit,
      );
      const input = await body(request);
      await publicLimitsAccount("register", input.name);
      return json(
        await session(await registerAccount(db, input, options), input.device),
        201,
      );
    }
    if (path === "/api/auth/login" && method === "POST") {
      await publicLimits(db, "login", source);
      const input = await body(request);
      await publicLimitsAccount("login", input.name);
      return json(await session(await loginAccount(db, input), input.device));
    }
    if (path === "/join" && method === "GET") {
      return new Response(
        `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>加入 ShowAI 项目</title><body style="font-family:system-ui;max-width:560px;margin:15vh auto;padding:24px"><h1>加入 ShowAI 项目</h1><p>打开 ShowAI，确认项目与权限后，使用你在此服务器上的账号加入。</p><a id="open" style="display:inline-block;padding:12px 18px;background:#343b36;color:white;border-radius:8px;text-decoration:none">在 ShowAI 中打开</a><p>也可以在「设置 → 服务器与同步」中粘贴当前邀请链接。</p><script>const invite=new URLSearchParams(location.hash.slice(1)).get('invite');if(invite&&/^[a-f0-9]{64}$/.test(invite)){const target=new URL('showai://join');target.searchParams.set('server',${JSON.stringify(publicBase)}??location.origin);target.searchParams.set('invite',invite);const serverId=new URLSearchParams(location.hash.slice(1)).get('server');if(serverId)target.searchParams.set('serverId',serverId);document.getElementById('open').href=target.href;}else{document.getElementById('open').textContent='邀请链接无效';}</script></body></html>`,
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "referrer-policy": "no-referrer",
          },
        },
      );
    }
    if (path === "/api/invites/preview" && method === "POST") {
      await publicLimits(db, "preview", source);
      const input = await body(request);
      const previewUser = request.headers.has("authorization")
        ? await authenticate(request)
        : undefined;
      const invitation = (
        await db.all<{
          project_id: string;
          role: ProjectRole;
          expires_at: string;
          name: string;
        }>(
          "SELECT i.project_id,i.role,i.expires_at,i.max_uses,i.target_name,p.name FROM invites i JOIN projects p ON p.id=i.project_id WHERE i.digest=? AND i.revoked=0 AND i.expires_at>? AND (i.max_uses IS NULL OR (SELECT COUNT(*) FROM invite_acceptances a WHERE a.digest=i.digest)<i.max_uses OR EXISTS(SELECT 1 FROM invite_acceptances a JOIN members m ON m.project_id=i.project_id AND m.user_id=a.user_id WHERE a.digest=i.digest AND a.user_id=?))",
          [
            await hash(plainText(input.invite, 200)),
            new Date().toISOString(),
            previewUser?.id ?? "",
          ],
        )
      )[0];
      if (!invitation)
        throw new SyncError(
          410,
          "INVITE_UNAVAILABLE",
          "The invitation has expired or was revoked.",
        );
      return json({
        ...invitation,
        serverId: await serverId(),
        serverName: options.name ?? "ShowAI Server",
      });
    }
    const user = await authenticate(request);
    if (path === "/api/auth/password" && method === "POST") {
      await publicLimits(db, "password", source, user.id);
      const changed = await changePassword(db, user, await body(request));
      return json(await session(changed, "ShowAI password change"));
    }
    if (path === "/api/sessions/revoke-all" && method === "POST") {
      const permission = liveSession(user),
        entry = audit("session.revoke-all", user.id, null, {}, permission);
      const results = await db.batch([
        entry,
        {
          sql: `UPDATE users SET auth_version=auth_version+1 WHERE id=? AND EXISTS(${permission.sql})`,
          values: [user.id, ...permission.values!],
        },
        {
          sql: "UPDATE sessions SET revoked=1 WHERE user_id=? AND EXISTS(SELECT 1 FROM audit_events WHERE id=?)",
          values: [user.id, entry.values![0]],
        },
      ]);
      if (!results[1].changes)
        throw new SyncError(
          401,
          "UNAUTHORIZED",
          "The token has expired or was revoked.",
        );
      return json({ ok: true });
    }
    if (path === "/api/me")
      return json({
        user: { id: user.id, name: user.name },
        serverId: await serverId(),
      });
    if (path === "/api/sessions" && method === "GET")
      return json(
        await db.all(
          "SELECT digest,device,created_at,expires_at,revoked,digest=? AS current FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 1000",
          [user.session_digest, user.id],
        ),
      );
    if (path === "/api/sessions/revoke" && method === "POST") {
      const input = await body(request);
      await db.batch([
        {
          sql: "UPDATE sessions SET revoked=1 WHERE digest=? AND user_id=?",
          values: [digestId(input.digest), user.id],
        },
        audit("session.revoke", user.id, null),
      ]);
      return json({ ok: true });
    }
    if (path === "/api/auth/logout" && method === "POST") {
      await db.batch([
        {
          sql: "UPDATE sessions SET revoked=1 WHERE digest=?",
          values: [user.session_digest],
        },
        audit("session.logout", user.id, null),
      ]);
      return json({ ok: true });
    }
    if (path === "/api/projects" && method === "GET")
      return json(
        (
          await db.all<ProjectRow>(
            "SELECT p.*,m.role FROM projects p JOIN members m ON m.project_id=p.id WHERE m.user_id=? ORDER BY p.created_at DESC",
            [user.id],
          )
        ).map((project) => ({ ...project, archived: !!project.archived })),
      );
    if (path === "/api/projects/heads" && method === "POST") {
      const input = await body(request);
      if (!Array.isArray(input.ids) || input.ids.length > 400)
        throw new SyncError(
          400,
          "INVALID_PROJECTS",
          "Check at most 400 project heads per request.",
        );
      const ids = [...new Set(input.ids.map(identifier))],
        projects: SyncProject[] = [];
      for (let offset = 0; offset < ids.length; offset += 80) {
        const chunk = ids.slice(offset, offset + 80);
        const rows = await db.all<ProjectRow>(
          `SELECT p.*,m.role FROM projects p JOIN members m ON m.project_id=p.id WHERE m.user_id=? AND p.id IN(${chunk.map(() => "?").join(",")})`,
          [user.id, ...chunk],
        );
        projects.push(
          ...rows.map((row) => ({ ...row, archived: !!row.archived })),
        );
      }
      return json({ serverId: await serverId(), projects });
    }
    if (path === "/api/projects" && method === "POST") {
      const input = await body(request),
        id = identifier(input.id ?? crypto.randomUUID()),
        name = plainText(input.name);
      const existing = (
        await db.all<{ id: string }>("SELECT id FROM projects WHERE id=?", [id])
      )[0];
      if (existing) return json(await projectFor(user.id, id));
      await db.batch([
        {
          sql: "INSERT INTO projects(id,name,created_at,created_by) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM projects WHERE created_by=?)<? AND (SELECT COUNT(*) FROM projects)<?",
          values: [
            id,
            name,
            new Date().toISOString(),
            user.id,
            user.id,
            quotas.policy.accountProjects,
            quotas.policy.serviceProjects,
          ],
        },
        {
          sql: "INSERT INTO members(project_id,user_id,role) SELECT ?,?,'admin' WHERE EXISTS(SELECT 1 FROM projects WHERE id=?)",
          values: [id, user.id, id],
        },
      ]);
      if (
        !(
          await db.all(
            "SELECT 1 FROM members WHERE project_id=? AND user_id=?",
            [id, user.id],
          )
        ).length
      )
        throw new SyncError(507, "PROJECT_CAPACITY", "项目数量已达容量上限。");
      return json(
        { id, name, head: null, role: "admin", archived: false },
        201,
      );
    }
    if (path === "/api/invites/accept" && method === "POST") {
      await publicLimits(db, "accept", source, user.id);
      const projectId = await acceptInvitation(db, user, await body(request));
      return json(await projectFor(user.id, projectId));
    }
    const match = path.match(/^\/api\/projects\/([^/]+)(?:\/(.*))?$/);
    if (!match)
      throw new SyncError(404, "NOT_FOUND", "Unknown server endpoint.");
    const projectId = identifier(match[1]),
      resource = match[2] ?? "";
    const project = await projectFor(user.id, projectId);
    if (resource === "storage" && method === "GET")
      return json({
        usage: await quotas.usage(projectId),
        policy: quotas.policy,
      });
    if (!resource && method === "GET")
      return json({ ...project, archived: !!project.archived });
    if (!resource && method === "PATCH") {
      await projectFor(user.id, projectId, "admin");
      const input = await body(request);
      const name =
          input.name === undefined ? project.name : plainText(input.name),
        archived =
          input.archived === undefined
            ? project.archived
            : input.archived === true
              ? 1
              : 0;
      if (project.head) {
        const current = await revisions.row(projectId, project.head);
        if (!current)
          throw new SyncError(
            500,
            "MISSING_REVISION",
            "Project head is missing.",
          );
        const snapshot = await revisions.snapshot(projectId, current);
        const metadataPath = `projects/${projectId}/project.json`;
        const bytes = await objects.get(
          objectKey(projectId, snapshot.files[metadataPath]),
        );
        if (!bytes)
          throw new SyncError(
            500,
            "MISSING_OBJECT",
            "Project metadata is missing.",
          );
        const envelope = JSON.parse(new TextDecoder().decode(bytes));
        if (
          envelope.format !== "showai-stored-json" ||
          envelope.value?.id !== projectId
        )
          throw new SyncError(
            400,
            "INVALID_PROJECT",
            "Project metadata does not match its identity.",
          );
        envelope.value.name = name;
        envelope.value.archived = !!archived;
        envelope.value.updatedAt = new Date().toISOString();
        const metadata = encoder.encode(JSON.stringify(envelope)),
          digest = await hash(metadata);
        const metadataGate = writeGate(user, projectId, "admin"),
          metadataReservation = await quotas.reserve(
            projectId,
            user.id,
            "object",
            digest,
            metadata.length,
            metadataGate,
          );
        if (metadataReservation) {
          await objects.put(objectKey(projectId, digest), metadata);
          await db.batch([
            {
              sql: `INSERT OR IGNORE INTO objects(project_id,digest,bytes,uploaded_by,uploaded_at) SELECT ?,?,?,?,? WHERE EXISTS(${metadataGate.sql}) AND EXISTS(SELECT 1 FROM storage_reservations WHERE id=?)`,
              values: [
                projectId,
                digest,
                metadata.length,
                user.id,
                new Date().toISOString(),
                ...metadataGate.values,
                metadataReservation.id,
              ],
            },
            {
              sql: "DELETE FROM storage_reservations WHERE id=? AND EXISTS(SELECT 1 FROM objects WHERE project_id=? AND digest=?)",
              values: [metadataReservation.id, projectId, digest],
            },
          ]);
        }
        const next: ProjectSnapshot = {
          ...snapshot,
          format: syncProtocol,
          parents: [project.head],
          files: { ...snapshot.files, [metadataPath]: digest },
          change: {
            at: new Date().toISOString(),
            actor: { kind: "human", label: user.name },
            channel: "system",
            operationId: crypto.randomUUID(),
            message: "更新项目设置",
            paths: [metadataPath],
          },
        };
        const response = await handle(
          new Request(
            serverEndpoint(
              publicBase ?? url.origin,
              `/api/projects/${projectId}/revisions`,
            ),
            {
              method: "POST",
              headers: {
                authorization: request.headers.get("authorization")!,
                "content-type": "application/json",
              },
              body: JSON.stringify({ snapshot: next, expected: project.head }),
            },
          ),
        );
        if (!response.ok) return response;
        return json(await projectFor(user.id, projectId));
      }
      const gate = writeGate(user, projectId, "admin");
      const updated = await db.batch([
        {
          sql: `UPDATE projects SET name=?,archived=? WHERE id=? AND head IS NULL AND EXISTS(${gate.sql})`,
          values: [name, archived, projectId, ...gate.values],
        },
        audit(
          "project.settings",
          user.id,
          projectId,
          { archived: !!archived },
          gate,
        ),
      ]);
      if (!updated[0].changes) {
        await authenticate(request);
        await projectFor(user.id, projectId, "admin");
        throw new SyncError(
          409,
          "CONFLICT",
          "Project settings changed while updating.",
        );
      }
      return json(await projectFor(user.id, projectId));
    }
    if (resource === "members" && method === "GET")
      return json(await members(projectId));
    if (resource === "members" && method === "PATCH") {
      await projectFor(user.id, projectId, "admin");
      const input = await body(request),
        target = identifier(input.userId),
        next = input.role === null ? null : role(input.role);
      if (
        input.revokeInvites !== undefined &&
        typeof input.revokeInvites !== "boolean"
      )
        throw new SyncError(
          400,
          "INVALID_BODY",
          "Invalid invitation revocation choice.",
        );
      const permission = writeGate(user, projectId, "admin");
      const guard = `EXISTS(${permission.sql})`;
      const lastAdmin =
        "(role!='admin' OR ?='admin' OR (SELECT COUNT(*) FROM members WHERE project_id=? AND role='admin')>1)";
      const condition = {
        sql: `SELECT 1 FROM members WHERE project_id=? AND user_id=? AND ${guard} AND ${lastAdmin}`,
        values: [
          projectId,
          target,
          ...permission.values,
          next ?? "removed",
          projectId,
        ],
      };
      const entry = audit(
        next === null ? "member.remove" : "member.role",
        user.id,
        projectId,
        { target, role: next, revokeInvites: input.revokeInvites === true },
        condition,
      );
      const statements = [
        entry,
        next === null
          ? {
              sql: `DELETE FROM members WHERE project_id=? AND user_id=? AND ${guard} AND ${lastAdmin}`,
              values: condition.values,
            }
          : {
              sql: `UPDATE members SET role=? WHERE project_id=? AND user_id=? AND ${guard} AND ${lastAdmin}`,
              values: [next, ...condition.values],
            },
      ];
      if (next === null && input.revokeInvites === true)
        statements.push({
          sql: "UPDATE invites SET revoked=1 WHERE project_id=? AND (created_by=? OR digest IN(SELECT digest FROM invite_acceptances WHERE user_id=?)) AND EXISTS(SELECT 1 FROM audit_events WHERE id=?)",
          values: [projectId, target, target, entry.values![0] as string],
        });
      const results = await db.batch(statements);
      if (!results[1].changes) {
        await projectFor(user.id, projectId, "admin");
        throw new SyncError(
          409,
          "LAST_ADMIN",
          "The project must retain at least one administrator, and the member must exist.",
        );
      }
      return json(await members(projectId));
    }
    if (resource === "invites" && method === "GET") {
      await projectFor(user.id, projectId, "admin");
      return json(
        await db.all(
          "SELECT i.digest,i.role,i.expires_at,i.max_uses,i.target_name,i.accepted_by,i.revoked,(SELECT COUNT(*) FROM invite_acceptances a WHERE a.digest=i.digest) AS accepted_count FROM invites i WHERE i.project_id=? ORDER BY i.expires_at DESC",
          [projectId],
        ),
      );
    }
    if (resource === "invites" && method === "POST") {
      await projectFor(user.id, projectId, "admin");
      const invitation = await createInvitation(
        db,
        user,
        projectId,
        await body(request),
      );
      const link = invitationUrl(
        publicBase ?? url.origin,
        invitation.invite,
        await serverId(),
      );
      return json({ ...invitation, url: link.toString() }, 201);
    }
    if (resource === "invites/revoke" && method === "POST") {
      await projectFor(user.id, projectId, "admin");
      const input = await body(request);
      await revokeInvitation(db, user, projectId, input.digest);
      await projectFor(user.id, projectId, "admin");
      return json({ ok: true });
    }
    if (resource === "objects/check" && method === "POST") {
      const input = await body(request);
      if (!Array.isArray(input.digests) || input.digests.length > 1000)
        throw new SyncError(
          400,
          "INVALID_OBJECTS",
          "Check at most 1000 objects per request.",
        );
      const missing: string[] = [];
      const digests = input.digests.map(digestId);
      for (let index = 0; index < digests.length; index += 80) {
        const chunk = digests.slice(index, index + 80);
        const present = new Set(
          (
            await db.all<{ digest: string }>(
              `SELECT digest FROM objects WHERE project_id=? AND digest IN (${chunk.map(() => "?").join(",")})`,
              [projectId, ...chunk],
            )
          ).map((entry) => entry.digest),
        );
        missing.push(...chunk.filter((digest) => !present.has(digest)));
      }
      return json({ missing });
    }
    if (resource === "objects/uploads" && method === "POST") {
      await projectFor(user.id, projectId, "editor");
      const input = await body(request);
      return json(
        await uploads.begin(
          projectId,
          user.id,
          input.digest,
          input.bytes,
          writeGate(user, projectId),
        ),
      );
    }
    const uploadRoute = resource.match(
      /^objects\/uploads\/([A-Za-z0-9_-]+)(?:\/(parts\/(\d+)|complete))?$/,
    );
    if (uploadRoute) {
      await projectFor(user.id, projectId, "editor");
      const upload = await uploads.find(projectId, user.id, uploadRoute[1]);
      if (!uploadRoute[2] && method === "GET")
        return json(await uploads.status(upload));
      if (uploadRoute[3] && method === "PUT")
        return json(
          await uploads.putPart(
            upload,
            Number(uploadRoute[3]),
            url.searchParams.get("digest"),
            request.body ??
              new ReadableStream({
                start(controller) {
                  controller.close();
                },
              }),
            writeGate(user, projectId),
          ),
        );
      if (uploadRoute[2] === "complete" && method === "POST")
        return json(await uploads.complete(upload, writeGate(user, projectId)));
      throw new SyncError(404, "NOT_FOUND", "Unknown upload endpoint.");
    }
    const object = resource.match(/^objects\/([a-f0-9]{64})$/);
    if (object && method === "GET") {
      if (
        !(
          await db.all(
            "SELECT 1 FROM objects WHERE project_id=? AND digest=?",
            [projectId, object[1]],
          )
        ).length
      )
        throw new SyncError(
          404,
          "MISSING_OBJECT",
          "Content object is missing.",
        );
      const stored = await objects.open(objectKey(projectId, object[1]));
      if (!stored)
        throw new SyncError(
          404,
          "MISSING_OBJECT",
          "Content object is missing.",
        );
      return new Response(
        verifiedStream(
          stored.body,
          objects.digest(),
          object[1],
          64 * 1024 * 1024,
          stored.bytes,
        ),
        {
          headers: {
            "content-type": "application/octet-stream",
            "cache-control": "private, no-store",
            "content-length": String(stored.bytes),
          },
        },
      );
    }
    if (object && method === "PUT") {
      await projectFor(user.id, projectId, "editor");
      const declared = request.headers.get("content-length");
      if (
        declared &&
        (!/^\d+$/.test(declared) || Number(declared) > 64 * 1024 * 1024)
      )
        throw new SyncError(413, "TOO_LARGE", "Object exceeds 64 MiB.");
      const gate = writeGate(user, projectId),
        reservedBytes = declared
          ? Number(declared)
          : url.searchParams.has("bytes")
            ? Number(url.searchParams.get("bytes"))
            : 64 * 1024 * 1024;
      if (
        !Number.isSafeInteger(reservedBytes) ||
        reservedBytes < 0 ||
        reservedBytes > 64 * 1024 * 1024
      )
        throw new SyncError(413, "TOO_LARGE", "Object exceeds 64 MiB.");
      const reservation = await quotas.reserve(
        projectId,
        user.id,
        "object",
        object[1],
        reservedBytes,
        gate,
      );
      const input =
        request.body ??
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        });
      if (!reservation) {
        const verified = verifiedStream(
          input,
          objects.digest(),
          object[1],
          64 * 1024 * 1024,
          declared ? reservedBytes : undefined,
        );
        const reader = verified.getReader();
        try {
          while (!(await reader.read()).done) {}
        } finally {
          reader.releaseLock();
        }
        await authenticate(request);
        await projectFor(user.id, projectId, "editor");
        return json({ ok: true, alreadyPresent: true });
      }
      let length: number;
      try {
        length = await objects.putVerified(
          objectKey(projectId, object[1]),
          input,
          object[1],
          reservedBytes,
        );
      } catch (error) {
        const possible = await objects.open(objectKey(projectId, object[1]));
        if (possible) await possible.body.cancel();
        else await quotas.release(reservation);
        throw error;
      }
      if (declared && length !== reservedBytes)
        throw new SyncError(
          400,
          "INVALID_SIZE",
          "Upload length does not match its declared size.",
        );
      await db.batch([
        {
          sql: `INSERT OR IGNORE INTO objects(project_id,digest,bytes,uploaded_by,uploaded_at) SELECT ?,?,?,?,? WHERE EXISTS(${gate.sql}) AND EXISTS(SELECT 1 FROM storage_reservations WHERE id=? AND bytes>=?)`,
          values: [
            projectId,
            object[1],
            length,
            user.id,
            new Date().toISOString(),
            ...gate.values,
            reservation.id,
            length,
          ],
        },
        {
          sql: "DELETE FROM storage_reservations WHERE id=? AND EXISTS(SELECT 1 FROM objects WHERE project_id=? AND digest=?)",
          values: [reservation.id, projectId, object[1]],
        },
        quotas.unusedBudgetStatement(reservation, length),
      ]);
      await authenticate(request);
      await projectFor(user.id, projectId, "editor");
      if (
        !(
          await db.all(
            "SELECT 1 FROM objects WHERE project_id=? AND digest=?",
            [projectId, object[1]],
          )
        ).length
      )
        throw new SyncError(
          409,
          "UPLOAD_INTERRUPTED",
          "Upload reservation changed before publication; retry.",
        );
      return json({ ok: true });
    }
    if (resource === "revisions" && method === "GET") {
      const after = url.searchParams.get("after"),
        before = url.searchParams.get("before"),
        summary = url.searchParams.get("summary") === "1";
      const limit = Math.min(
        200,
        Math.max(1, Number(url.searchParams.get("limit") ?? 100)),
      );
      if (!Number.isInteger(limit))
        throw new SyncError(400, "INVALID_LIMIT", "Invalid history limit.");
      const cursor = before ?? after;
      const row = cursor
        ? (
            await db.all<{ sequence: number }>(
              "SELECT sequence FROM revisions WHERE project_id=? AND revision=?",
              [projectId, digestId(cursor)],
            )
          )[0]
        : undefined;
      if (cursor && !row)
        throw new SyncError(
          409,
          "MISSING_BASELINE",
          "The history baseline is not present on this server.",
        );
      // Do not select embedded legacy manifests for summary pages.
      const candidates = await db.all<RevisionRow>(
        `SELECT r.revision,r.sequence,r.manifest_bytes,r.published,u.id AS source_user_id,u.name AS source_user_name,r.created_at AS received_at FROM revisions r JOIN users u ON u.id=r.user_id WHERE r.project_id=?${row ? ` AND r.sequence${before ? "<" : ">"}?` : ""} ORDER BY r.sequence ${before ? "DESC" : "ASC"} LIMIT ?`,
        row ? [projectId, row.sequence, limit] : [projectId, limit],
      );
      const entries: unknown[] = [];
      let bytes = 0;
      let last: string | null = null;
      for (const candidate of candidates) {
        if (
          !summary &&
          entries.length &&
          bytes + candidate.manifest_bytes > 1024 * 1024
        )
          break;
        const entry = summary
          ? revisions.summary(candidate)
          : await revisions.record(
              projectId,
              (await revisions.row(projectId, candidate.revision))!,
            );
        const size = new TextEncoder().encode(JSON.stringify(entry)).byteLength;
        if (entries.length && bytes + size > 1024 * 1024) break;
        entries.push(entry);
        bytes += size;
        last = candidate.revision;
      }
      return json({
        head: project.head,
        entries,
        next:
          entries.length < candidates.length || candidates.length === limit
            ? last
            : null,
      });
    }
    const revision = resource.match(/^revisions\/([a-f0-9]{64})$/);
    if (revision && method === "GET") {
      const entry = await revisions.row(projectId, revision[1]);
      if (!entry)
        throw new SyncError(
          404,
          "MISSING_REVISION",
          "Project revision is missing.",
        );
      return json(await revisions.record(projectId, entry));
    }
    if (resource === "revisions" && method === "POST") {
      await projectFor(user.id, projectId, "editor");
      const input = await body(request),
        snapshot: ProjectSnapshot = validateSnapshot(input.snapshot, projectId),
        revision = await snapshotRevision(snapshot);
      if (
        Object.keys(snapshot.files).some((path) =>
          path.startsWith("packages/"),
        ) ||
        snapshot.change.paths.some((path) => path.startsWith("packages/"))
      )
        throw new SyncError(
          400,
          "INVALID_DEPENDENCY",
          "Publish packages in the project's dependency directory.",
        );
      const projectBytes = await objects.get(
        objectKey(
          projectId,
          snapshot.files[`projects/${projectId}/project.json`],
        ),
        64 * 1024,
      );
      let projectMetadata: { name: string; archived?: boolean } | undefined;
      if (projectBytes) {
        const metadata = JSON.parse(new TextDecoder().decode(projectBytes));
        const value =
          metadata.format === "showai-stored-json" ? metadata.value : metadata;
        if (
          value.id !== projectId ||
          typeof value.name !== "string" ||
          (value.archived !== undefined &&
            typeof value.archived !== "boolean") ||
          ["sourceDirectory", "binding", "bindings"].some((key) =>
            Object.hasOwn(value, key),
          )
        )
          throw new SyncError(
            400,
            "INVALID_PROJECT",
            "Project metadata identity does not match.",
          );
        projectMetadata = value;
        if (
          project.role !== "admin" &&
          Number(!!value.archived) !== project.archived
        )
          throw new SyncError(
            403,
            "FORBIDDEN",
            "Only project administrators can archive or restore a project.",
          );
      }
      for (const parent of snapshot.parents)
        if (
          !(
            await db.all(
              "SELECT revision FROM revisions WHERE project_id=? AND revision=?",
              [projectId, parent],
            )
          ).length
        )
          throw new SyncError(
            409,
            "MISSING_PARENT",
            "Upload the parent version first.",
          );
      const unique = [...new Set(Object.values(snapshot.files))];
      for (let index = 0; index < unique.length; index += 80) {
        const chunk = unique.slice(index, index + 80);
        const count = (
          await db.all<{ count: number }>(
            `SELECT COUNT(*) AS count FROM objects WHERE project_id=? AND digest IN (${chunk.map(() => "?").join(",")})`,
            [projectId, ...chunk],
          )
        )[0].count;
        if (count !== chunk.length)
          throw new SyncError(
            409,
            "MISSING_OBJECT",
            "Upload every referenced content object before publishing.",
          );
      }
      await validateReaderClosure(
        Object.keys(snapshot.files),
        projectId,
        async (path) => {
          const bytes = await objects.get(
            objectKey(projectId, snapshot.files[path]),
          );
          if (!bytes || (await hash(bytes)) !== snapshot.files[path])
            throw new SyncError(
              400,
              "INVALID_DEPENDENCY",
              "A reader object is missing or corrupt.",
            );
          return bytes;
        },
      );
      await validatePackageClosure(
        Object.keys(snapshot.files),
        projectId,
        async (path) => {
          const bytes = await objects.get(
            objectKey(projectId, snapshot.files[path]),
            8 * 1024 * 1024,
          );
          if (!bytes || (await hash(bytes)) !== snapshot.files[path])
            throw new SyncError(
              400,
              "INVALID_DEPENDENCY",
              "A package object is absent or corrupt.",
            );
          return bytes;
        },
      );
      const stored = await revisions.prepare(projectId, snapshot),
        gate = writeGate(user, projectId);
      const reservation = await quotas.reserve(
        projectId,
        user.id,
        "manifest",
        stored.digest,
        stored.bytes,
        gate,
      );
      if (reservation) {
        try {
          await objects.put(stored.key, stored.content);
        } catch (error) {
          const possible = await objects.open(stored.key);
          if (possible) await possible.body.cancel();
          else await quotas.release(reservation);
          throw error;
        }
      }
      await db.batch([
        {
          sql: `INSERT OR IGNORE INTO revisions(project_id,revision,manifest,user_id,created_at,manifest_key,manifest_digest,manifest_bytes,sequence) SELECT ?,?,'',?,?,?,?,?,COALESCE((SELECT MAX(sequence)+1 FROM revisions WHERE project_id=?),1) WHERE EXISTS(${gate.sql})`,
          values: [
            projectId,
            revision,
            user.id,
            new Date().toISOString(),
            stored.key,
            stored.digest,
            stored.bytes,
            projectId,
            ...gate.values,
          ],
        },
        ...(reservation
          ? [
              {
                sql: "DELETE FROM storage_reservations WHERE id=? AND EXISTS(SELECT 1 FROM revisions WHERE project_id=? AND revision=?)",
                values: [reservation.id, projectId, revision],
              },
            ]
          : []),
      ]);
      await authenticate(request);
      const currentProject = await projectFor(user.id, projectId, "editor");
      if (input.publish === false)
        return json({ revision, head: project.head, published: false });
      const expected =
        input.expected === null ? null : digestId(input.expected);
      if (currentProject.head === revision)
        return json({ revision, head: revision, published: true });
      if (
        (expected !== null && !snapshot.parents.includes(expected)) ||
        (expected === null && snapshot.parents.length)
      )
        throw new SyncError(
          409,
          "INVALID_PARENT",
          "The new version must descend from the expected current version.",
        );
      const results = await db.batch([
        {
          sql: `UPDATE projects SET head=?,name=?,archived=? WHERE id=? AND head IS ? AND EXISTS(${gate.sql}) AND (archived=? OR EXISTS(SELECT 1 FROM members WHERE project_id=? AND user_id=? AND role='admin'))`,
          values: [
            revision,
            projectMetadata?.name ?? project.name,
            projectMetadata?.archived ? 1 : 0,
            projectId,
            expected,
            ...gate.values,
            projectMetadata?.archived ? 1 : 0,
            projectId,
            user.id,
          ],
        },
        {
          sql: "UPDATE revisions SET published=1 WHERE project_id=? AND revision=? AND EXISTS(SELECT 1 FROM projects WHERE id=? AND head=?)",
          values: [projectId, revision, projectId, revision],
        },
      ]);
      if (!results[0].changes) {
        await authenticate(request);
        const current = await projectFor(user.id, projectId, "editor");
        throw new SyncError(
          409,
          "CONFLICT",
          "The project has a newer version. Your uploaded version is retained.",
          { head: current.head, revision },
        );
      }
      return json({ revision, head: revision, published: true });
    }
    throw new SyncError(404, "NOT_FOUND", "Unknown project endpoint.");
  }
  return {
    initialize: serverId,
    async fetch(
      request: Request,
      context?: { source?: string },
    ): Promise<Response> {
      const secure = (response: Response) =>
        secureResponse(
          response,
          request,
          allowedOrigins,
          publicOrigin ?? new URL(request.url).origin,
        );
      const requestPath = new URL(request.url).pathname;
      const heavy =
        requestPath.endsWith("/api/ops/export/metadata") ||
        /\/revisions(?:\/|$)/.test(requestPath) ||
        (request.method === "PATCH" &&
          /\/api\/projects\/[^/]+\/?$/.test(requestPath));
      if (heavy) {
        if (activeManifests >= 1) {
          if (manifestWaiters.length >= 8) {
            const response = json(
              {
                error: {
                  code: "BUSY",
                  message: "Project history is busy; retry shortly.",
                  details: { retryAfter: 1 },
                },
              },
              429,
            );
            response.headers.set("retry-after", "1");
            return secure(response);
          }
          await new Promise<void>((resolve) => manifestWaiters.push(resolve));
        } else activeManifests++;
      }
      let writeLease: string | undefined;
      let transfer: ReturnType<typeof deadlineBody> | undefined;
      try {
        await serverId();
        const logicalPath = requestPath
          .slice(basePath.length)
          .replace(/\/$/, "");
        const writes =
          !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
          !logicalPath.startsWith("/api/ops/") &&
          !(
            request.method === "POST" &&
            (logicalPath === "/api/projects/heads" ||
              /^\/api\/projects\/[^/]+\/objects\/check$/.test(logicalPath))
          );
        const writesObjects =
          (request.method === "PUT" &&
            /^\/api\/projects\/[^/]+\/objects\//.test(logicalPath)) ||
          (request.method === "POST" &&
            /^\/api\/projects\/[^/]+\/(?:revisions|objects\/uploads\/[^/]+\/complete)$/.test(
              logicalPath,
            )) ||
          (request.method === "PATCH" &&
            /^\/api\/projects\/[^/]+$/.test(logicalPath));
        if (writesObjects) writeLease = await maintenance.enterWrite();
        if (writes && request.body) {
          transfer = deadlineBody(request.body);
          request = new Request(request, {
            body: transfer.body,
            duplex: "half",
          } as RequestInit);
        }
        return secure(await handle(request, context?.source));
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("SHOWAI_READ_ONLY")
        )
          return secure(
            json(
              {
                error: {
                  code: "SERVER_READ_ONLY",
                  message:
                    "The server is frozen for a consistent backup. Local changes are retained.",
                },
              },
              503,
            ),
          );
        if (error instanceof SyncError) {
          const response = json(
            {
              error: {
                code: error.code,
                message: error.message,
                details: error.details,
              },
            },
            error.status,
          );
          if (error instanceof RateLimitError)
            response.headers.set("retry-after", String(error.retryAfter));
          else if (error.status === 429)
            response.headers.set(
              "retry-after",
              String(
                (error.details as { retryAfter?: number })?.retryAfter ?? 1,
              ),
            );
          return secure(response);
        }
        if (error instanceof SyntaxError)
          return secure(
            json(
              {
                error: {
                  code: "INVALID_JSON",
                  message: "Invalid JSON request.",
                },
              },
              400,
            ),
          );
        console.error("ShowAI Server request failed", error);
        return secure(
          json(
            {
              error: {
                code: "SERVER_ERROR",
                message: "The server could not complete the request.",
              },
            },
            500,
          ),
        );
      } finally {
        try {
          if (transfer) await transfer.dispose();
        } finally {
          try {
            if (writeLease) await maintenance.leaveWrite(writeLease);
          } finally {
            if (heavy) {
              const next = manifestWaiters.shift();
              if (next) next();
              else activeManifests--;
            }
          }
        }
      }
    },
  };
}
