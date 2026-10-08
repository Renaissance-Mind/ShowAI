import {
  digestId,
  hash,
  plainText,
  role,
  SyncError,
  token,
  type ProjectRole,
} from "../sync/protocol";
import type { MetadataStore } from "./storage";
import type { AuthUser } from "./accounts";
import { audit, liveSession } from "./security";
interface Invite {
  project_id: string;
  role: ProjectRole;
  revoked: number;
  expires_at: string;
  max_uses: number | null;
  target_name: string | null;
}

export async function createInvitation(
  db: MetadataStore,
  user: AuthUser & { session_digest: string },
  projectId: string,
  input: Record<string, unknown>,
) {
  const maxUses = input.maxUses === null ? null : Number(input.maxUses ?? 25);
  const days = Number(input.days ?? 7);
  if (
    (maxUses !== null &&
      (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000)) ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 30
  )
    throw new SyncError(
      400,
      "INVALID_INVITE_LIMIT",
      "选择 1 至 10000 个账号及 1 至 30 天有效期。",
    );
  const targetName = input.targetName ? plainText(input.targetName, 100) : null;
  if (targetName && /[<>\r\n]/.test(targetName))
    throw new SyncError(400, "INVALID_ACCOUNT", "Invalid target account name.");
  if (
    targetName &&
    !(await db.all("SELECT id FROM users WHERE name=?", [targetName])).length
  )
    throw new SyncError(
      400,
      "INVALID_TARGET_ACCOUNT",
      "定向邀请需填写已注册的账号名。",
    );
  const invite = token(),
    digest = await hash(invite),
    expiresAt = new Date(Date.now() + days * 86400_000).toISOString(),
    inviteRole = role(input.role);
  const permission = liveSession(user);
  const result = await db.batch([
    {
      sql: `INSERT INTO invites(digest,project_id,role,created_by,expires_at,max_uses,target_name) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE project_id=? AND user_id=? AND role='admin') AND EXISTS(${permission.sql})`,
      values: [
        digest,
        projectId,
        inviteRole,
        user.id,
        expiresAt,
        maxUses,
        targetName,
        projectId,
        user.id,
        ...permission.values!,
      ],
    },
    audit(
      "invite.create",
      user.id,
      projectId,
      { role: inviteRole, maxUses, directed: !!targetName },
      { sql: "SELECT 1 FROM invites WHERE digest=?", values: [digest] },
    ),
  ]);
  if (!result[0].changes)
    throw new SyncError(
      403,
      "FORBIDDEN",
      "Your project role does not permit this action.",
    );
  return { invite, role: inviteRole, expiresAt, maxUses, targetName };
}

export async function acceptInvitation(
  db: MetadataStore,
  user: AuthUser & { session_digest: string },
  input: Record<string, unknown>,
) {
  const digest = await hash(plainText(input.invite, 200)),
    at = new Date().toISOString();
  const invitation = (
    await db.all<Invite>("SELECT * FROM invites WHERE digest=?", [digest])
  )[0];
  if (
    !invitation ||
    invitation.revoked ||
    invitation.expires_at <= at ||
    (invitation.target_name && invitation.target_name !== user.name)
  )
    throw new SyncError(
      410,
      "INVITE_UNAVAILABLE",
      "邀请已失效、已领满或不适用于此账号。",
    );
  const existing =
    (
      await db.all(
        "SELECT 1 FROM invite_acceptances WHERE digest=? AND user_id=?",
        [digest, user.id],
      )
    ).length > 0;
  if (existing) {
    if (
      !(
        await db.all("SELECT 1 FROM members WHERE project_id=? AND user_id=?", [
          invitation.project_id,
          user.id,
        ])
      ).length
    )
      throw new SyncError(
        403,
        "FORBIDDEN",
        "被移出的成员不能重复使用已领取的邀请。",
      );
    return invitation.project_id;
  }
  const available =
    "i.revoked=0 AND i.expires_at>? AND (i.target_name IS NULL OR i.target_name=?) AND (i.max_uses IS NULL OR (SELECT COUNT(*) FROM invite_acceptances a WHERE a.digest=i.digest)<i.max_uses)";
  const permission = liveSession(user);
  await db.batch([
    {
      sql: `INSERT OR IGNORE INTO members(project_id,user_id,role) SELECT i.project_id,?,i.role FROM invites i WHERE i.digest=? AND ${available} AND NOT EXISTS(SELECT 1 FROM invite_acceptances WHERE digest=? AND user_id=?) AND EXISTS(${permission.sql})`,
      values: [
        user.id,
        digest,
        at,
        user.name,
        digest,
        user.id,
        ...permission.values!,
      ],
    },
    {
      sql: `INSERT OR IGNORE INTO invite_acceptances(digest,user_id) SELECT i.digest,? FROM invites i JOIN members m ON m.project_id=i.project_id AND m.user_id=? WHERE i.digest=? AND ${available} AND EXISTS(${permission.sql})`,
      values: [user.id, user.id, digest, at, user.name, ...permission.values!],
    },
    audit(
      "invite.accept",
      user.id,
      invitation.project_id,
      {},
      {
        sql: "SELECT 1 FROM invite_acceptances WHERE digest=? AND user_id=?",
        values: [digest, user.id],
      },
    ),
  ]);
  if (
    !(
      await db.all(
        "SELECT 1 FROM invite_acceptances WHERE digest=? AND user_id=?",
        [digest, user.id],
      )
    ).length
  )
    throw new SyncError(
      410,
      "INVITE_UNAVAILABLE",
      "邀请已失效、已领满或不适用于此账号。",
    );
  return invitation.project_id;
}

export async function revokeInvitation(
  db: MetadataStore,
  user: AuthUser & { session_digest: string },
  projectId: string,
  digest: unknown,
) {
  const permission = liveSession(user);
  await db.batch([
    {
      sql: `UPDATE invites SET revoked=1 WHERE project_id=? AND digest=? AND EXISTS(SELECT 1 FROM members WHERE project_id=? AND user_id=? AND role='admin') AND EXISTS(${permission.sql})`,
      values: [
        projectId,
        digestId(digest),
        projectId,
        user.id,
        ...permission.values!,
      ],
    },
    audit(
      "invite.revoke",
      user.id,
      projectId,
      {},
      {
        sql: "SELECT 1 FROM members WHERE project_id=? AND user_id=? AND role='admin'",
        values: [projectId, user.id],
      },
    ),
  ]);
}
