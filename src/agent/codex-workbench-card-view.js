function createShowaiCardView(list, template, openTarget) {
  let active;

  // An inline host sizes its frame to the list. Reserve space only when the menu
  // fits on neither side of the trigger within the existing cards.
  function positionMenu() {
    if (!active || list.hidden) return;
    const { toggle, menu } = active;
    const anchor = toggle.getBoundingClientRect();
    const first = list.firstElementChild.getBoundingClientRect();
    const last = list.lastElementChild.getBoundingClientRect();
    const offset = parseFloat(getComputedStyle(menu).getPropertyValue("--card-menu-offset"));
    const space = menu.offsetHeight + offset + 7;
    menu.toggleAttribute("data-above", last.bottom - anchor.bottom < space && anchor.top - first.top >= space);
    const overflow = Math.max(0, Math.ceil(menu.getBoundingClientRect().bottom + 7 - last.bottom));
    list.style.setProperty("--showai-card-menu-room", overflow + "px");
  }
  const resize = new ResizeObserver(positionMenu);

  function closeMenu(restoreFocus = false) {
    if (!active) return;
    const { toggle, menu } = active;
    active = undefined;
    resize.disconnect();
    menu.hidden = true;
    menu.removeAttribute("data-above");
    toggle.setAttribute("aria-expanded", "false");
    list.style.removeProperty("--showai-card-menu-room");
    if (restoreFocus) toggle.focus({ preventScroll: true });
  }

  function openMenu(toggle, focusEdge) {
    if (toggle.disabled) return;
    if (active?.toggle !== toggle) {
      closeMenu();
      const menu = toggle.nextElementSibling;
      active = { toggle, menu };
      menu.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      positionMenu();
      resize.observe(list);
      resize.observe(menu);
    }
    if (focusEdge) {
      const items = active.menu.querySelectorAll("button:enabled");
      const item = focusEdge === "last" ? items[items.length - 1] : items[0];
      item?.focus({ preventScroll: true });
    }
  }

  list.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || button.disabled || !list.contains(button)) return;
    if (button.matches(".showai-card-toggle")) {
      if (active?.toggle === button) closeMenu();
      else openMenu(button, event.detail === 0 ? "first" : undefined);
      return;
    }
    const destination = button.dataset.destination || "panel";
    const index = Array.from(list.children).indexOf(button.closest(".showai-card"));
    closeMenu(destination !== "panel");
    if (index >= 0) openTarget(index, destination);
  });
  list.addEventListener("keydown", event => {
    const toggle = event.target.closest(".showai-card-toggle");
    if (toggle && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      openMenu(toggle, event.key === "ArrowUp" ? "last" : "first");
    } else if (active && event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    } else if (active && event.key === "Tab") {
      closeMenu(true);
    } else if (active?.menu.contains(event.target)) {
      const items = Array.from(active.menu.querySelectorAll("button:enabled"));
      const index = items.indexOf(event.target);
      const next = { ArrowDown: (index + 1) % items.length, ArrowUp: (index + items.length - 1) % items.length,
        Home: 0, End: items.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      items[next]?.focus({ preventScroll: true });
    }
  });
  function dismissOutside(event) {
    if (active && !active.toggle.parentElement.contains(event.target)) closeMenu();
  }
  document.addEventListener("pointerdown", dismissOutside, true);
  document.addEventListener("focusin", dismissOutside);
  window.addEventListener("blur", () => closeMenu());

  function render(targets) {
    closeMenu();
    list.replaceChildren(...targets.map((item, index) => {
      const row = template.content.firstElementChild.cloneNode(true);
      const title = row.querySelector(".showai-card-title");
      title.textContent = item.title;
      title.id = list.id + "-title-" + index;
      row.setAttribute("aria-labelledby", title.id);
      const path = row.querySelector(".showai-card-path");
      path.textContent = Array.isArray(item.breadcrumb) ? item.breadcrumb.join(" / ") : "";
      path.hidden = !path.textContent;
      const body = row.querySelector(".showai-card-body");
      body.textContent = item.description || item.blockTitle || "";
      body.hidden = !body.textContent;
      const toggle = row.querySelector(".showai-card-toggle");
      const menu = row.querySelector(".showai-card-menu");
      menu.id = list.id + "-menu-" + index;
      toggle.setAttribute("aria-controls", menu.id);
      return row;
    }));
  }

  function updateActions(t, { busy, workbench, desktop, openLabel, workbenchLabel, showOptions = true }) {
    if (busy) closeMenu();
    for (const row of list.children) {
      const open = row.querySelector(".showai-card-open");
      open.textContent = openLabel ?? t("openPage");
      open.disabled = busy;
      const toggle = row.querySelector(".showai-card-toggle");
      toggle.hidden = !showOptions;
      toggle.setAttribute("aria-label", t("openOptions"));
      toggle.disabled = busy || (!workbench && !desktop);
      const menu = row.querySelector(".showai-card-menu");
      menu.setAttribute("aria-label", t("openOptions"));
      for (const button of menu.querySelectorAll("button")) {
        const isWorkbench = button.dataset.destination === "workbench";
        button.lastElementChild.textContent = isWorkbench
          ? workbenchLabel ?? t("cardWorkbench")
          : t("cardDesktop");
        button.disabled = busy || !(isWorkbench ? workbench : desktop);
      }
    }
  }

  return { render, updateActions, closeMenu };
}
