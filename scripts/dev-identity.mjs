// Refreshes the development identity (branch and commit) after Git refs move.
// Reading it spawns `git`, which can fail transiently while another checkout
// rewrites refs (for example EINTR from uv_cwd). Such a failure must never
// stop the development server: it is logged and the read is retried a few
// times, after which the next Git change triggers a fresh attempt.
export function identityRefresher({
  read,
  apply,
  log = console.error,
  retries = 4,
  delay = 250,
}) {
  let timer;
  let closed = false;
  const attempt = (count) => {
    timer = undefined;
    if (closed) return;
    let identity;
    try {
      identity = read();
    } catch (error) {
      const reason = error?.code ?? error?.message ?? String(error);
      if (count < retries) {
        log(`无法读取开发版本信息（${reason}），稍后重试。`);
        timer = setTimeout(() => attempt(count + 1), delay * (count + 1));
      } else
        log(`无法读取开发版本信息（${reason}），将在下次 Git 变化时重试。`);
      return;
    }
    apply(identity);
  };
  return {
    refresh() {
      clearTimeout(timer);
      attempt(0);
    },
    close() {
      closed = true;
      clearTimeout(timer);
    },
  };
}
