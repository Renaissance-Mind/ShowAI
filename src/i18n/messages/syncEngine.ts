import { defineMessages } from "../index";

// Sync engine errors and statuses shown in Settings → Server & sync.
export default defineMessages("syncEngine", {
  "zh-CN": {
    "server.status": "服务器返回 {status}",
    "network.failed": "同步网络请求失败。",
    "network.redirected":
      "服务器地址发生重定向，请使用最终服务器基址重新连接。",
    "url.invalidBase":
      "填写服务器基址，例如 https://showai.example.com/cloud。",
    "server.incompatible": "该地址不是兼容的 ShowAI Server。",
    "server.invalidCapabilities": "服务器能力说明无效。",
    "server.invalidIdentity": "服务器身份或能力说明无效。",
    "server.identityChanged": "服务器身份发生变化，请重新连接。",
    "server.identityChangedKept":
      "服务器身份已改变，请重新连接。原有内容仍保留。",
    "server.upgradeRequired": "服务器需要升级到仅同步当前内容的版本。",
    "server.contentMissing": "服务器当前内容缺失，本地修改及同步基线已保留。",
    "session.expired": "服务器登录已到期或撤销，请重新登录。本地修改会保留。",
    "event.identityMismatch": "服务器更新事件身份不匹配。",
    "event.invalidCount": "服务器更新项目数量无效。",
    "event.invalidProject": "服务器更新项目无效。",
    "event.revisionMismatch": "服务器更新版本不匹配。",
    "event.foreignObject": "服务器更新包含项目以外的对象。",
    "event.invalidDigest": "服务器更新对象摘要无效。",
    "config.invalid": "同步配置格式无效。",
    "connection.missing": "服务器连接不存在。",
    "connection.unlinkProjectsFirst":
      "请先解除该连接下的项目同步；本地项目内容会保留。",
    "password.identityMismatch": "修改密码后的服务器或账号身份不匹配。",
    "invite.invalid": "邀请链接无效。",
    "invite.chooseAccount": "请选择邀请所属服务器上的账号。",
    "project.notAccessible": "项目不存在或当前账号没有访问权限。",
    "project.alreadyConnected": "该项目已经连接到服务器，请先解除原连接。",
    "project.remoteExists":
      "服务器已有同 ID 的内容，请通过加入远程项目连接，避免覆盖。",
    "project.pendingDraft":
      "项目有待恢复或上传的合并草稿，请先完成同步或处理冲突，再解除连接。",
    "project.syncMissing": "项目同步连接不存在。",
    "project.switchSameServer":
      "切换账号需要选择同一服务器；更换存储服务器请先解除同步。",
    "project.accountMissing": "项目同步账号不存在。",
    "project.defaultServerExists":
      "默认服务器已存在同 ID 项目，本地内容已保留。",
    "project.contentMissing": "当前项目内容不存在。",
    "project.accessRevoked": "项目不存在或访问权限已撤销。",
    "role.viewerKept": "账号只有查看权限，未上传的修改仍保留在本地。",
    "role.readOnly":
      "当前项目账号只有查看权限或访问权限已撤销。本地内容仍保留。",
    "snapshot.mismatch": "服务器快照身份或摘要不匹配。",
    "snapshot.wrongRevision": "服务器返回了错误的快照版本。",
    "cache.inputDigestMismatch": "同步缓存输入摘要不匹配。",
    "cache.downloadDigestMismatch": "下载内容摘要不匹配。",
    "cache.baselineCorrupt": "本地同步基线缓存损坏。",
    "cache.corrupt": "本地同步缓存损坏，原始内容仍保留。",
    "cache.retainedCorrupt": "保留的同步缓存未通过完整性检查。",
    "draft.corrupt":
      "保留的同步合并草稿未通过完整性检查，原始修改历史仍然保留。",
    "draft.otherServer": "保留的同步草稿属于另一台服务器，请先处理该草稿。",
    "download.failed": "下载资源失败。",
    "download.changedLocally":
      "下载期间本地内容有新修改，已保留同步草稿，请重试。",
    "save.failedResolve":
      "本机保存失败，未解决的文件修改不会发布到服务器。请先处理冲突。",
    "save.failedExternal":
      "本机保存失败，未解决的文件修改不会发布到服务器。请通过顶部的外部修改入口处理后重新保存。",
    "conflict.none": "没有待处理的同步冲突。",
    "conflict.chooseAll": "请为每个冲突选择保留的内容。",
    "upload.unavailable": "上传服务暂时不可用。",
    "upload.failed": "上传失败。",
    "upload.resourceFailed": "上传资源失败。",
    "upload.partMismatch": "保留的上传分片与本地内容不同。",
    "upload.foreignObject": "服务器请求了快照以外的资源。",
    "account.connectionMissing": "服务器账号连接不存在。",
    "account.bindingDisabled": "此服务器尚未启用账号绑定。",
    "account.identityMismatch": "服务器返回的账号身份不匹配。",
    "account.signedOutHere": "此设备在该服务器上的登录已被注销，请重新登录。",
    "login.invalidCompletionLink": "登录完成链接无效。",
    "account.chooseDifferentServices": "请选择两个不同服务的账号。",
    "account.sameServerAccounts":
      "同一服务器上的不同账号不能绑定为同一个账号。",
    "account.bindingConflict":
      "两组绑定包含同一服务器的不同账号或身份，请先解除冲突的绑定。",
    "account.boundIdentityChanged": "绑定服务器的身份发生变化。",
    "account.restoredMismatch": "恢复的账号与绑定身份不一致。",
    "account.bindingMissing": "绑定不存在。",
    "account.resourceSourceMismatch": "资源的服务器或账号来源不匹配。",
    "resources.serverSignedOut": "资源来源服务器尚未登录，请恢复绑定服务。",
    "resources.removed": "这份服务器资源已移除，请刷新资源列表。",
    "resources.configChanged": "资源来源配置已变化，请重新从服务器添加该资源。",
  },
  en: {
    "server.status": "The server returned {status}",
    "network.failed": "Sync network request failed.",
    "network.redirected":
      "The server address redirected. Reconnect using the final server base URL.",
    "url.invalidBase":
      "Enter the server base URL, for example https://showai.example.com/cloud.",
    "server.incompatible": "This address isn't a compatible ShowAI Server.",
    "server.invalidCapabilities":
      "The server's capability description is invalid.",
    "server.invalidIdentity":
      "The server's identity or capability description is invalid.",
    "server.identityChanged":
      "The server's identity has changed. Reconnect to it.",
    "server.identityChangedKept":
      "The server's identity has changed. Reconnect to it. Existing content is kept.",
    "server.upgradeRequired":
      "The server needs to be upgraded to a version that syncs current content only.",
    "server.contentMissing":
      "The server's current content is missing. Local changes and the sync baseline are kept.",
    "session.expired":
      "Your server sign-in expired or was revoked. Sign in again. Local changes are kept.",
    "event.identityMismatch":
      "A server update event came from an unexpected server.",
    "event.invalidCount": "A server update has an invalid number of projects.",
    "event.invalidProject": "A server update contains an invalid project.",
    "event.revisionMismatch": "A server update has a mismatched revision.",
    "event.foreignObject":
      "A server update contains objects from outside the project.",
    "event.invalidDigest":
      "A server update contains an object with an invalid digest.",
    "config.invalid": "The sync configuration is invalid.",
    "connection.missing": "This server connection doesn't exist.",
    "connection.unlinkProjectsFirst":
      "Stop syncing the projects on this connection first. Local project content is kept.",
    "password.identityMismatch":
      "The server or account identity doesn't match after the password change.",
    "invite.invalid": "Invalid invitation link.",
    "invite.chooseAccount":
      "Choose an account on the server this invitation belongs to.",
    "project.notAccessible":
      "The project doesn't exist, or this account doesn't have access to it.",
    "project.alreadyConnected":
      "This project is already connected to a server. Disconnect it first.",
    "project.remoteExists":
      "The server already has content with this ID. Join the remote project instead so nothing is overwritten.",
    "project.pendingDraft":
      "This project has a merge draft waiting to be restored or uploaded. Finish syncing or resolve the conflicts before disconnecting.",
    "project.syncMissing": "This project's sync connection doesn't exist.",
    "project.switchSameServer":
      "To switch accounts, choose one on the same server. To change the storage server, stop syncing first.",
    "project.accountMissing": "This project's sync account doesn't exist.",
    "project.defaultServerExists":
      "The default server already has a project with this ID. Local content is kept.",
    "project.contentMissing": "The current project content doesn't exist.",
    "project.accessRevoked":
      "The project doesn't exist, or access to it was revoked.",
    "role.viewerKept":
      "This account can only view. Changes that weren't uploaded are kept on this device.",
    "role.readOnly":
      "This project's account can only view, or its access was revoked. Local content is kept.",
    "snapshot.mismatch":
      "The server snapshot's identity or digest doesn't match.",
    "snapshot.wrongRevision":
      "The server returned the wrong snapshot revision.",
    "cache.inputDigestMismatch": "Sync cache input doesn't match its digest.",
    "cache.downloadDigestMismatch":
      "Downloaded content doesn't match its digest.",
    "cache.baselineCorrupt": "The local sync baseline cache is corrupted.",
    "cache.corrupt":
      "The local sync cache is corrupted. The original content is kept.",
    "cache.retainedCorrupt": "The saved sync cache failed its integrity check.",
    "draft.corrupt":
      "The saved sync merge draft failed its integrity check. The original change history is kept.",
    "draft.otherServer":
      "The saved sync draft belongs to another server. Handle that draft first.",
    "download.failed": "Couldn't download a resource.",
    "download.changedLocally":
      "Local content changed during the download. A sync draft was kept. Try again.",
    "save.failedResolve":
      "Couldn't save on this device. Unresolved file changes won't be published to the server. Resolve the conflict first.",
    "save.failedExternal":
      "Couldn't save on this device. Unresolved file changes won't be published to the server. Resolve them from the external changes entry at the top, then save again.",
    "conflict.none": "There are no sync conflicts to resolve.",
    "conflict.chooseAll": "Choose which content to keep for each conflict.",
    "upload.unavailable": "The upload service is temporarily unavailable.",
    "upload.failed": "Upload failed.",
    "upload.resourceFailed": "Couldn't upload a resource.",
    "upload.partMismatch":
      "A saved upload part doesn't match the local content.",
    "upload.foreignObject":
      "The server requested a resource from outside the snapshot.",
    "account.connectionMissing":
      "This server account connection doesn't exist.",
    "account.bindingDisabled": "Account linking isn't enabled on this server.",
    "account.signedOutHere":
      "This device was signed out of that server. Please sign in again.",
    "login.invalidCompletionLink": "The sign-in completion link is invalid.",
    "account.identityMismatch":
      "The account identity returned by the server doesn't match.",
    "account.chooseDifferentServices":
      "Choose accounts from two different services.",
    "account.sameServerAccounts":
      "Different accounts on the same server can't be linked as one account.",
    "account.bindingConflict":
      "These link groups include different accounts or identities on the same server. Unlink the conflicting accounts first.",
    "account.boundIdentityChanged": "The linked server's identity has changed.",
    "account.restoredMismatch":
      "The restored account doesn't match the linked identity.",
    "account.bindingMissing": "This link doesn't exist.",
    "account.resourceSourceMismatch":
      "The resource's server or account doesn't match.",
    "resources.serverSignedOut":
      "You're not signed in to this resource's server. Restore the linked service.",
    "resources.removed":
      "This server resource was removed. Refresh the resource list.",
    "resources.configChanged":
      "This resource's configuration changed. Add it from the server again.",
  },
});
