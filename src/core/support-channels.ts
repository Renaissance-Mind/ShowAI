/**
 * Where people ask for help. One definition for the App's 关于与反馈 page, the
 * report form and the support block Agents receive. Has no dependencies so
 * both the renderer and Node code can import it.
 */
export const SUPPORT_REPORT_URL =
  "https://github.com/Renaissance-Mind/ShowAI/issues/new";
export const SUPPORT_DOCS_URL =
  "https://showai.renaissancemind.ai/doc/agent-troubleshooting";
/** Keep prefilled issue links below common URL limits. */
export const SUPPORT_URL_LIMIT = 6000;

export interface SupportChannels {
  /** Support mailbox; empty until the team publishes one. */
  email?: string;
  /** A community channel for people who do not use GitHub (e.g. a Chinese group). */
  community?: { label: string; url: string };
}

/**
 * Optional channels, set at build time with VITE_SHOWAI_SUPPORT_EMAIL,
 * VITE_SHOWAI_COMMUNITY_URL and VITE_SHOWAI_COMMUNITY_LABEL. Unset values show
 * nothing; no personal address is written into the source.
 */
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
  // Vite replaces import.meta.env in the renderer; Node code has no build env.
  const meta = import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  };
  return meta.env ?? {};
}
