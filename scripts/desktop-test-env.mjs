export function desktopTestEnvironment() {
  return {
    ...process.env,
    SHOWAI_BACKGROUND: process.env.SHOWAI_TEST_SHOW === "1" ? "0" : "1",
  };
}
