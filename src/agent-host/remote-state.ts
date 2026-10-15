/** Files owned by one container process must never survive its lifetime. */
export function ignoreRemoteAgentState(path: string) {
  return (
    path.split("/").some((part) => [".locks", "tmp"].includes(part)) ||
    /(?:^|\/)local\/(?:leases(?:\/|$)|[a-z-]+\.lock(?:\.recover-[\w-]+)?$)/.test(
      path,
    ) ||
    path.endsWith(".tmp") ||
    path.startsWith("agent-host/embedded/showai-marketplace/") ||
    path.startsWith("agent-host/embedded/codex/plugins/")
  );
}
