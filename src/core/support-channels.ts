export const SUPPORT_REPORT_URL =
  "https://github.com/Renaissance-Mind/ShowAI/issues/new";
export const SUPPORT_DOCS_URL =
  "https://showai.renaissancemind.ai/doc/agent-troubleshooting";
export const SUPPORT_URL_LIMIT = 6000;

export interface SupportChannels {
  email?: string;
  community?: { label: string; url: string };
}

export function supportChannels(
  env: Record<string, string | undefined> = buildEnv(),
): SupportChannels {
  const email = env.VITE_SHOWAI_SUPPORT_EMAIL?.trim();
  const url = env.VITE_SHOWAI_COMMUNITY_URL?.trim();
  return {
    ...(email && /^[^\s@]+@[^\s@]+$/.test(email) ? { email } : {}),
    ...(url && /^https:\/\//i.test(url)
      ? {
          community: {
            label: env.VITE_SHOWAI_COMMUNITY_LABEL?.trim() || url,
            url,
          },
        }
      : {}),
  };
}

function buildEnv(): Record<string, string | undefined> {
  const meta = import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  };
  return meta.env ?? {};
}
