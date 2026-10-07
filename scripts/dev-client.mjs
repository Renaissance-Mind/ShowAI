// Injected by the development launcher only; never included in a distribution.
import info from "virtual:showai-development-info";

if (!new URLSearchParams(location.search).has("componentPreview")) {
  const badge = document.createElement("div");
  badge.dataset.showaiDevelopment = "true";
  badge.style.cssText =
    "position:fixed;bottom:8px;right:12px;z-index:2147483647;padding:5px 10px;border:1px solid #bfc5d1;border-radius:6px;background:#fff;color:#273044;font:12px system-ui;box-shadow:0 1px 5px #0001;max-width:70vw";
  let label,
    message = "";
  function updateIdentity(current) {
    badge.title = `${current.root}\n当前源码：${current.branch} · ${current.commit}\n${location.origin}`;
    label = `开发版 · ${current.branch} · ${current.commit.slice(0, 7)} · ${current.mode === "desktop" ? "桌面" : "浏览器"}`;
    badge.textContent = message ? `${label} · ${message}` : label;
  }
  updateIdentity(info);
  import.meta.hot.on("showai:identity", updateIdentity);
  document.body.append(badge);
  let frozen = false;
  function freeze(value) {
    frozen = value;
    document.getElementById("root").inert = value;
  }
  const hello = () => {
    import.meta.hot.send("showai:identity-request");
    if (window.showai?.prepareReload)
      import.meta.hot.send("showai:hello", { url: location.href });
  };
  if (info.mode === "desktop" && !window.showai)
    badge.textContent = "请打开 Applications/ShowAI.app 使用桌面实时测试版";
  hello();
  import.meta.hot.on("vite:ws:connect", hello);
  import.meta.hot.on("showai:status", (status) => {
    message = status.message;
    badge.textContent = `${label} · ${message}`;
  });
  import.meta.hot.on("showai:prepare-restart", async ({ id }) => {
    if (!window.showai?.prepareReload) return;
    freeze(true);
    let allow = false;
    try {
      allow = (await window.showai?.prepareReload?.()) === true;
    } catch (error) {
      console.error("ShowAI 开发更新保存失败", error);
    }
    import.meta.hot.send("showai:restart-result", { id, allow });
  });
  import.meta.hot.on("showai:restart-cancelled", () => {
    freeze(false);
    message = "更新已暂停，请处理保存问题后点击重试";
    badge.textContent = `${label} · ${message}`;
  });
  badge.addEventListener("click", () => {
    if (!frozen) import.meta.hot.send("showai:retry");
  });
  import.meta.hot.on("showai:restart-complete", () => location.reload());
  import.meta.hot.on("showai:stopped", () => {
    freeze(false);
    badge.textContent = `${label} · 开发服务已停止`;
  });
}
