import {
  canonical,
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
  type SyncUser,
  type ProjectSnapshot,
} from "../sync/protocol";
import { schema, type MetadataStore, type ObjectStore } from "./storage";

export interface ServerOptions {
  metadata: MetadataStore;
  objects: ObjectStore;
  name?: string;
  registrationKey?: string;
  publicUrl?: string;
}
interface Member {
  id: string;
  name: string;
  role: ProjectRole;
}
interface SessionRow extends SyncUser {
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
async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: encoder.encode(salt),
        iterations: 100_000,
      },
      key,
      256,
    ),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
function objectKey(projectId: string, digest: string) {
  return `projects/${identifier(projectId)}/objects/${digestId(digest)}`;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > 16 * 1024 * 1024)
    throw new SyncError(413, "TOO_LARGE", "Request is too large.");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 16 * 1024 * 1024)
    throw new SyncError(413, "TOO_LARGE", "Request is too large.");
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SyncError(400, "INVALID_BODY", "A JSON object is required.");
  return value;
}

/** Identical request handler for Workers and the Linux HTTP host. */
export function createSyncServer(options: ServerOptions) {
  const db = options.metadata,
    objects = options.objects;
  let initialization: Promise<string> | undefined;
  async function initialize() {
    for (const sql of schema) await db.run(sql);
    await db.run(
      "INSERT OR IGNORE INTO settings(key,value) VALUES('server_id',?)",
      [crypto.randomUUID()],
    );
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
      "SELECT u.id,u.name,s.digest AS session_digest FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.digest=? AND s.revoked=0 AND s.expires_at>?",
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
  async function session(user: SyncUser, device: unknown) {
    const credential = token(),
      at = new Date().toISOString();
    await db.run(
      "INSERT INTO sessions(digest,user_id,device,created_at,expires_at) VALUES(?,?,?,?,?)",
      [
        await hash(credential),
        user.id,
        typeof device === "string" ? plainText(device, 200) : "ShowAI",
        at,
        new Date(Date.now() + 180 * 86400_000).toISOString(),
      ],
    );
    return {
      protocol: syncProtocol,
      serverId: await serverId(),
      user,
      token: credential,
    };
  }
  async function members(projectId: string) {
    return db.all<Member>(
      "SELECT u.id,u.name,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY u.name",
      [projectId],
    );
  }
  async function handle(request: Request): Promise<Response> {
    await serverId();
    const url = new URL(request.url),
      path = url.pathname.replace(/\/$/, ""),
      method = request.method;
    if (path === "/health" || path === "/api/info")
      return json({
        protocol: syncProtocol,
        serverId: await serverId(),
        name: options.name ?? "ShowAI Server",
        roles: ["admin", "editor", "viewer"],
        auth: ["password", "token"],
      });
    if (path === "/api/auth/register" && method === "POST") {
      const input = await body(request),
        name = plainText(input.name, 100),
        password = plainText(input.password, 1000);
      if (/[<>\r\n]/.test(name))
        throw new SyncError(
          400,
          "INVALID_ACCOUNT",
          "Account names cannot contain angle brackets or line breaks.",
        );
      if (password.length < 4)
        throw new SyncError(
          400,
          "INVALID_PASSWORD",
          "Use at least four characters.",
        );
      if (
        options.registrationKey &&
        input.registrationKey !== options.registrationKey
      ) {
        const invitation =
          typeof input.invite === "string"
            ? await db.all<{ digest: string }>(
                "SELECT digest FROM invites WHERE digest=? AND revoked=0 AND accepted_by IS NULL AND expires_at>?",
                [await hash(input.invite), new Date().toISOString()],
              )
            : [];
        if (!invitation.length)
          throw new SyncError(
            403,
            "REGISTRATION_KEY_REQUIRED",
            "Enter the registration key or join with an invitation.",
          );
      }
      if ((await db.all("SELECT id FROM users WHERE name=?", [name])).length)
        throw new SyncError(
          409,
          "ACCOUNT_EXISTS",
          "This account name already exists. Sign in instead.",
        );
      const id = crypto.randomUUID(),
        salt = token();
      await db.run(
        "INSERT INTO users(id,name,password_salt,password_hash,created_at) VALUES(?,?,?,?,?)",
        [
          id,
          name,
          salt,
          await passwordHash(password, salt),
          new Date().toISOString(),
        ],
      );
      return json(await session({ id, name }, input.device), 201);
    }
    if (path === "/api/auth/login" && method === "POST") {
      const input = await body(request),
        name = plainText(input.name, 100),
        password = plainText(input.password, 1000);
      const user = (
        await db.all<
          SyncUser & { password_salt: string; password_hash: string }
        >("SELECT * FROM users WHERE name=?", [name])
      )[0];
      if (
        !user ||
        (await passwordHash(password, user.password_salt)) !==
          user.password_hash
      )
        throw new SyncError(
          401,
          "INVALID_LOGIN",
          "Account name or password is incorrect.",
        );
      return json(
        await session({ id: user.id, name: user.name }, input.device),
      );
    }
    if (path === "/join" && method === "GET") {
      return new Response(
        `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>加入 ShowAI 项目</title><body style="font-family:system-ui;max-width:560px;margin:15vh auto;padding:24px"><h1>加入 ShowAI 项目</h1><p>打开 ShowAI，确认项目与权限后，使用你在此服务器上的账号加入。</p><a id="open" style="display:inline-block;padding:12px 18px;background:#343b36;color:white;border-radius:8px;text-decoration:none">在 ShowAI 中打开</a><p>也可以在「设置 → 服务器与同步」中粘贴当前邀请链接。</p><script>const invite=new URLSearchParams(location.hash.slice(1)).get('invite');if(invite&&/^[a-f0-9]{64}$/.test(invite)){const target=new URL('showai://join');target.searchParams.set('server',location.origin);target.searchParams.set('invite',invite);document.getElementById('open').href=target.href;}else{document.getElementById('open').textContent='邀请链接无效';}</script></body></html>`,
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "referrer-policy": "no-referrer",
          },
        },
      );
    }
    if (path === "/api/invites/preview" && method === "POST") {
      const input = await body(request);
      const invitation = (
        await db.all<{
          project_id: string;
          role: ProjectRole;
          expires_at: string;
          name: string;
        }>(
          "SELECT i.project_id,i.role,i.expires_at,p.name FROM invites i JOIN projects p ON p.id=i.project_id WHERE i.digest=? AND i.revoked=0 AND i.accepted_by IS NULL AND i.expires_at>?",
          [await hash(plainText(input.invite, 200)), new Date().toISOString()],
        )
      )[0];
      if (!invitation)
        throw new SyncError(
          410,
          "INVITE_UNAVAILABLE",
          "The invitation has expired, was revoked or was already used.",
        );
      return json({
        ...invitation,
        serverId: await serverId(),
        serverName: options.name ?? "ShowAI Server",
      });
    }
    const user = await authenticate(request);
    if (path === "/api/me")
      return json({
        user: { id: user.id, name: user.name },
        serverId: await serverId(),
      });
    if (path === "/api/sessions" && method === "GET")
      return json(
        await db.all(
          "SELECT digest,device,created_at,expires_at,revoked FROM sessions WHERE user_id=? ORDER BY created_at DESC",
          [user.id],
        ),
      );
    if (path === "/api/sessions/revoke" && method === "POST") {
      const input = await body(request);
      await db.run(
        "UPDATE sessions SET revoked=1 WHERE digest=? AND user_id=?",
        [digestId(input.digest), user.id],
      );
      return json({ ok: true });
    }
    if (path === "/api/auth/logout" && method === "POST") {
      await db.run("UPDATE sessions SET revoked=1 WHERE digest=?", [
        user.session_digest,
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
          sql: "INSERT INTO projects(id,name,created_at) VALUES(?,?,?)",
          values: [id, name, new Date().toISOString()],
        },
        {
          sql: "INSERT INTO members(project_id,user_id,role) VALUES(?,?,'admin')",
          values: [id, user.id],
        },
      ]);
      return json(
        { id, name, head: null, role: "admin", archived: false },
        201,
      );
    }
    if (path === "/api/invites/accept" && method === "POST") {
      const input = await body(request),
        digest = await hash(plainText(input.invite, 200));
      const invitation = (
        await db.all<{
          project_id: string;
          role: ProjectRole;
          accepted_by: string | null;
          revoked: number;
          expires_at: string;
        }>("SELECT * FROM invites WHERE digest=?", [digest])
      )[0];
      if (
        !invitation ||
        invitation.revoked ||
        invitation.expires_at <= new Date().toISOString() ||
        (invitation.accepted_by && invitation.accepted_by !== user.id)
      )
        throw new SyncError(
          410,
          "INVITE_UNAVAILABLE",
          "This invitation is unavailable.",
        );
      if (invitation.accepted_by === user.id)
        return json(await projectFor(user.id, invitation.project_id));
      const claimed = await db.batch([
        {
          sql: "UPDATE invites SET accepted_by=? WHERE digest=? AND accepted_by IS NULL AND revoked=0 AND expires_at>?",
          values: [user.id, digest, new Date().toISOString()],
        },
        {
          sql: "INSERT OR IGNORE INTO members(project_id,user_id,role) SELECT project_id,?,role FROM invites WHERE digest=? AND accepted_by=? AND revoked=0 AND changes()=1",
          values: [user.id, digest, user.id],
        },
      ]);
      if (!claimed[0].changes) {
        const winner = (
          await db.all<{ accepted_by: string | null }>(
            "SELECT accepted_by FROM invites WHERE digest=?",
            [digest],
          )
        )[0];
        if (winner?.accepted_by !== user.id)
          throw new SyncError(
            410,
            "INVITE_UNAVAILABLE",
            "This invitation was already claimed.",
          );
      }
      return json(await projectFor(user.id, invitation.project_id));
    }
    const match = path.match(/^\/api\/projects\/([^/]+)(?:\/(.*))?$/);
    if (!match)
      throw new SyncError(404, "NOT_FOUND", "Unknown server endpoint.");
    const projectId = identifier(match[1]),
      resource = match[2] ?? "";
    const project = await projectFor(user.id, projectId);
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
        const current = (
          await db.all<{ manifest: string }>(
            "SELECT manifest FROM revisions WHERE project_id=? AND revision=?",
            [projectId, project.head],
          )
        )[0];
        const snapshot = JSON.parse(current.manifest) as ProjectSnapshot;
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
        await objects.put(objectKey(projectId, digest), metadata);
        await db.run(
          "INSERT OR IGNORE INTO objects(project_id,digest,bytes) VALUES(?,?,?)",
          [projectId, digest, metadata.length],
        );
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
          new Request(`${url.origin}/api/projects/${projectId}/revisions`, {
            method: "POST",
            headers: {
              authorization: request.headers.get("authorization")!,
              "content-type": "application/json",
            },
            body: JSON.stringify({ snapshot: next, expected: project.head }),
          }),
        );
        if (!response.ok) return response;
      }
      await db.run("UPDATE projects SET name=?,archived=? WHERE id=?", [
        name,
        archived,
        projectId,
      ]);
      return json(await projectFor(user.id, projectId));
    }
    if (resource === "members" && method === "GET")
      return json(await members(projectId));
    if (resource === "members" && method === "PATCH") {
      await projectFor(user.id, projectId, "admin");
      const input = await body(request),
        target = identifier(input.userId),
        next = input.role === null ? null : role(input.role);
      // SQL guards the last administrator even when two administrators act concurrently.
      const result =
        next === null
          ? await db.run(
              "DELETE FROM members WHERE project_id=? AND user_id=? AND (role!='admin' OR (SELECT COUNT(*) FROM members WHERE project_id=? AND role='admin')>1)",
              [projectId, target, projectId],
            )
          : await db.run(
              "UPDATE members SET role=? WHERE project_id=? AND user_id=? AND (role!='admin' OR ?='admin' OR (SELECT COUNT(*) FROM members WHERE project_id=? AND role='admin')>1)",
              [next, projectId, target, next, projectId],
            );
      if (!result.changes)
        throw new SyncError(
          409,
          "LAST_ADMIN",
          "The project must retain at least one administrator, and the member must exist.",
        );
      return json(await members(projectId));
    }
    if (resource === "invites" && method === "GET") {
      await projectFor(user.id, projectId, "admin");
      return json(
        await db.all(
          "SELECT digest,role,expires_at,accepted_by,revoked FROM invites WHERE project_id=? ORDER BY expires_at DESC",
          [projectId],
        ),
      );
    }
    if (resource === "invites" && method === "POST") {
      await projectFor(user.id, projectId, "admin");
      const input = await body(request),
        invite = token(),
        expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
      await db.run(
        "INSERT INTO invites(digest,project_id,role,created_by,expires_at) VALUES(?,?,?,?,?)",
        [await hash(invite), projectId, role(input.role), user.id, expiresAt],
      );
      const link = new URL("/join", options.publicUrl ?? url.origin);
      link.hash = `invite=${invite}`;
      return json(
        { invite, url: link.toString(), role: input.role, expiresAt },
        201,
      );
    }
    if (resource === "invites/revoke" && method === "POST") {
      await projectFor(user.id, projectId, "admin");
      const input = await body(request);
      await db.run(
        "UPDATE invites SET revoked=1 WHERE project_id=? AND digest=?",
        [projectId, digestId(input.digest)],
      );
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
    const object = resource.match(/^objects\/([a-f0-9]{64})$/);
    if (object && method === "GET") {
      const bytes = await objects.get(objectKey(projectId, object[1]));
      if (!bytes)
        throw new SyncError(
          404,
          "MISSING_OBJECT",
          "Content object is missing.",
        );
      if ((await hash(bytes)) !== object[1])
        throw new SyncError(
          500,
          "CORRUPT_OBJECT",
          "Content object failed integrity verification.",
        );
      return new Response(Uint8Array.from(bytes), {
        headers: {
          "content-type": "application/octet-stream",
          "cache-control": "private, no-store",
        },
      });
    }
    if (object && method === "PUT") {
      await projectFor(user.id, projectId, "editor");
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > 64 * 1024 * 1024)
        throw new SyncError(
          413,
          "TOO_LARGE",
          "Split content objects larger than 64 MB.",
        );
      if ((await hash(bytes)) !== object[1])
        throw new SyncError(
          400,
          "DIGEST_MISMATCH",
          "Content does not match its digest.",
        );
      await objects.put(objectKey(projectId, object[1]), bytes);
      await db.run(
        "INSERT OR IGNORE INTO objects(project_id,digest,bytes) VALUES(?,?,?)",
        [projectId, object[1], bytes.length],
      );
      return json({ ok: true });
    }
    if (resource === "revisions" && method === "GET") {
      const after = url.searchParams.get("after"),
        before = url.searchParams.get("before"),
        limit = Math.min(
          200,
          Math.max(1, Number(url.searchParams.get("limit") ?? 100)),
        );
      if (!Number.isInteger(limit))
        throw new SyncError(400, "INVALID_LIMIT", "Invalid history limit.");
      const cursor = before ?? after;
      const row = cursor
        ? (
            await db.all<{ rowid: number }>(
              "SELECT rowid FROM revisions WHERE project_id=? AND revision=?",
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
      const entries = await db.all<{
        revision: string;
        manifest: string;
        published: number;
      }>(
        `SELECT revision,manifest,published FROM revisions WHERE project_id=?${row ? ` AND rowid${before ? "<" : ">"}?` : ""} ORDER BY rowid ${before ? "DESC" : "ASC"} LIMIT ?`,
        row ? [projectId, row.rowid, limit] : [projectId, limit],
      );
      return json({
        head: project.head,
        entries: entries.map((entry) => ({
          revision: entry.revision,
          snapshot: JSON.parse(entry.manifest),
          published: !!entry.published,
        })),
        next: entries.length === limit ? entries.at(-1)!.revision : null,
      });
    }
    const revision = resource.match(/^revisions\/([a-f0-9]{64})$/);
    if (revision && method === "GET") {
      const entry = (
        await db.all<{ manifest: string }>(
          "SELECT manifest FROM revisions WHERE project_id=? AND revision=?",
          [projectId, revision[1]],
        )
      )[0];
      if (!entry)
        throw new SyncError(
          404,
          "MISSING_REVISION",
          "Project revision is missing.",
        );
      return json({
        revision: revision[1],
        snapshot: JSON.parse(entry.manifest),
      });
    }
    if (resource === "revisions" && method === "POST") {
      await projectFor(user.id, projectId, "editor");
      const input = await body(request),
        snapshot: ProjectSnapshot = validateSnapshot(input.snapshot, projectId),
        revision = await snapshotRevision(snapshot);
      const projectBytes = await objects.get(
        objectKey(
          projectId,
          snapshot.files[`projects/${projectId}/project.json`],
        ),
      );
      let projectMetadata: { name: string; archived?: boolean } | undefined;
      if (projectBytes) {
        const metadata = JSON.parse(new TextDecoder().decode(projectBytes));
        const value =
          metadata.format === "showai-stored-json" ? metadata.value : metadata;
        if (value.id !== projectId || typeof value.name !== "string")
          throw new SyncError(
            400,
            "INVALID_PROJECT",
            "Project metadata identity does not match.",
          );
        projectMetadata = value;
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
      await db.run(
        "INSERT OR IGNORE INTO revisions(project_id,revision,manifest,user_id,created_at) VALUES(?,?,?,?,?)",
        [
          projectId,
          revision,
          canonical(snapshot),
          user.id,
          new Date().toISOString(),
        ],
      );
      if (input.publish === false)
        return json({ revision, head: project.head, published: false });
      const expected =
        input.expected === null ? null : digestId(input.expected);
      if (project.head === revision)
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
          sql: "UPDATE projects SET head=?,name=?,archived=? WHERE id=? AND head IS ? AND EXISTS(SELECT 1 FROM members WHERE project_id=? AND user_id=? AND role IN ('admin','editor'))",
          values: [
            revision,
            projectMetadata?.name ?? project.name,
            projectMetadata?.archived ? 1 : 0,
            projectId,
            expected,
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
    async fetch(request: Request): Promise<Response> {
      try {
        return await handle(request);
      } catch (error) {
        if (error instanceof SyncError)
          return json(
            {
              error: {
                code: error.code,
                message: error.message,
                details: error.details,
              },
            },
            error.status,
          );
        if (error instanceof SyntaxError)
          return json(
            {
              error: { code: "INVALID_JSON", message: "Invalid JSON request." },
            },
            400,
          );
        console.error("ShowAI Server request failed", error);
        return json(
          {
            error: {
              code: "SERVER_ERROR",
              message: "The server could not complete the request.",
            },
          },
          500,
        );
      }
    },
  };
}
