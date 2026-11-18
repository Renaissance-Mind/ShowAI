(() => {
  const config = JSON.parse(document.getElementById("review-app").textContent);
  const zh = (config.lang || navigator.language).toLowerCase().startsWith("zh");
  const t = zh
    ? {
        title: "独立界面验收",
        preview: "应用预览",
        review: "验收面板",
        marks: "操作标注",
        tree: "流程树",
        states: "界面状态",
        actions: "当前可测试操作",
        empty: "当前没有可标注的控件",
        outside: "当前界面未列入流程",
        loading: "准备界面…",
        home: "回到起点",
        reset: "重置示例",
        jump: "转到",
        branch: "切换分支",
        action: "操作",
        error: "无法准备状态",
      }
    : {
        title: "Independent UI review",
        preview: "Application preview",
        review: "Review inspector",
        marks: "Action markers",
        tree: "Flow tree",
        states: "UI states",
        actions: "Available actions",
        empty: "No controls to mark in this state",
        outside: "Unmapped screen",
        loading: "Preparing screen…",
        home: "Back to start",
        reset: "Reset example",
        jump: "Go to",
        branch: "Toggle branch",
        action: "Action",
        error: "Could not prepare state",
      };
  document.documentElement.lang = zh ? "zh-CN" : "en";
  document.title =
    typeof config.title === "string"
      ? config.title
      : config.title?.[zh ? "zh" : "en"] || t.title;
  function el(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }
  function button(label, handler, className) {
    const node = el("button", className, label);
    node.type = "button";
    node.addEventListener("click", handler);
    return node;
  }
  const root = document.getElementById("review-root");
  root.className = "rv-shell";
  const header = el("header", "rv-head"),
    tools = el("div", "rv-tools");
  const marksLabel = el("label"),
    marksToggle = el("input");
  marksToggle.type = "checkbox";
  marksToggle.checked = true;
  marksLabel.append(marksToggle, t.marks);
  const body = el("main", "rv-body"),
    stage = el("div", "rv-stage"),
    marks = el("div", "rv-marks");
  marks.setAttribute("role", "group");
  marks.setAttribute("aria-label", t.marks);
  const loading = el("div", "rv-loading", t.loading);
  loading.setAttribute("role", "status");
  const panel = el("aside", "rv-inspector");
  panel.setAttribute("aria-label", t.review);
  const section = (name) => {
    const s = el("section");
    s.append(el("h2", "", name));
    return s;
  };
  const stateSection = section(t.states),
    activeName = el("p", "rv-current"),
    variants = el("div", "rv-states");
  stateSection.append(activeName, variants);
  const actionSection = section(t.actions),
    actionList = el("div", "rv-action-list");
  actionSection.append(actionList);
  const treeSection = section(t.tree),
    tree = el("nav", "rv-tree");
  stateSection.classList.add("rv-state-section");
  actionSection.classList.add("rv-action-section");
  treeSection.classList.add("rv-tree-section");
  tree.id = "review-flow-tree";
  tree.setAttribute("aria-label", t.tree);
  treeSection.append(tree);
  const error = el("p", "rv-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const treeToggle = button(t.tree, () => {
    treeSection.hidden = !treeSection.hidden;
    treeToggle.setAttribute("aria-expanded", String(!treeSection.hidden));
  });
  treeToggle.setAttribute("aria-controls", tree.id);
  treeToggle.setAttribute("aria-expanded", "true");
  const reset = button(t.reset, () => scenario?.reset?.());
  reset.hidden = true;
  const home = button(t.home, () => load(scenario.entry), "rv-home");
  home.disabled = true;
  tools.append(marksLabel, treeToggle, reset);
  header.append(el("h1", "", document.title), tools);
  panel.append(stateSection, actionSection, treeSection, error, home);
  stage.append(marks, loading);
  body.append(stage, panel);
  root.append(header, body);

  let frame,
    scenario,
    controller,
    selected,
    scheduled = 0,
    lastActions = "",
    treeShape = "",
    busy = true;
  const jumpButtons = new Map(),
    branches = new Map(),
    watched = new Set();
  let orderedStates = [],
    needsState = false,
    currentActions = [],
    tracker;
  function report(reason) {
    error.textContent = t.error + " · " + (reason.message || String(reason));
    error.hidden = false;
  }
  function visible(element) {
    return (
      !!element?.isConnected &&
      element.ownerDocument === frame?.contentDocument &&
      !element.closest("[hidden],[inert],[data-exit-ghost]") &&
      element.getClientRects().length > 0 &&
      (element.checkVisibility?.({ visibilityProperty: true }) ?? true)
    );
  }
  function disabled(element) {
    return element.matches(":disabled,[aria-disabled=true]");
  }
  function target(value) {
    const found =
      typeof value === "function"
        ? value()
        : frame.contentDocument.querySelector(value);
    return visible(found) ? found : null;
  }
  function activate(element) {
    if (!visible(element) || disabled(element)) return;
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
    element.focus({ preventScroll: true });
    element.click();
    schedule();
  }
  function makeDriver(doc, signal) {
    const win = doc.defaultView;
    function wait(read, description) {
      return new Promise((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        const observer = new win.MutationObserver(check);
        const timer = setTimeout(
          () => finish(reject, new Error(description)),
          6000,
        );
        function finish(callback, value) {
          observer.disconnect();
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          for (const type of [
            "input",
            "change",
            "transitionend",
            "animationend",
          ])
            doc.removeEventListener(type, check, true);
          callback(value);
        }
        function abort() {
          finish(reject, signal.reason);
        }
        function check() {
          try {
            const value = read();
            if (value) finish(resolve, value);
          } catch (e) {
            finish(reject, e);
          }
        }
        signal.addEventListener("abort", abort, { once: true });
        observer.observe(doc, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
        for (const type of ["input", "change", "transitionend", "animationend"])
          doc.addEventListener(type, check, true);
        check();
      });
    }
    async function control(value, label) {
      const element = await wait(() => {
        const node = target(value);
        return node && !disabled(node) && node;
      }, label);
      signal.throwIfAborted();
      return element;
    }
    return {
      wait,
      signal,
      async click(value, label) {
        activate(await control(value, label || String(value)));
      },
      async fill(value, text, label) {
        const field = await control(value, label || String(value));
        const prototype = field.matches("textarea")
          ? win.HTMLTextAreaElement.prototype
          : win.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(
          field,
          text,
        );
        field.dispatchEvent(new win.Event("input", { bubbles: true }));
        field.dispatchEvent(new win.Event("change", { bubbles: true }));
      },
    };
  }
  function validate(definition) {
    if (!Array.isArray(definition?.states) || !definition.states.length)
      throw Error("window.reviewScenario.states is missing");
    const byId = new Map(definition.states.map((state) => [state.id, state]));
    if (byId.size !== definition.states.length || !byId.has(definition.entry))
      throw Error("Invalid review state IDs or entry");
    for (const state of definition.states) {
      if (!state.title || typeof state.match !== "function" || !state.id)
        throw Error("Invalid review state");
      for (const id of state.variants || [])
        if (!byId.has(id)) throw Error("Unknown state shortcut: " + id);
      const visited = new Set([state.id]);
      for (
        let parent = state.parent;
        parent;
        parent = byId.get(parent).parent
      ) {
        if (visited.has(parent) || !byId.has(parent))
          throw Error("Invalid review branch: " + parent);
        visited.add(parent);
      }
    }
  }
  function buildTree() {
    const shape = JSON.stringify(
      scenario.states.map((s) => [s.id, s.parent, s.group, s.title]),
    );
    if (shape === treeShape) return;
    treeShape = shape;
    tree.replaceChildren();
    jumpButtons.clear();
    branches.clear();
    function list(items) {
      const ul = el("ul");
      for (const state of items) {
        const li = el("li"),
          row = el("div", "rv-tree-row");
        const children = scenario.states.filter((s) => s.parent === state.id);
        const jump = button(state.title, () => load(state.id), "rv-jump");
        jump.setAttribute("aria-label", t.jump + " " + state.title);
        jumpButtons.set(state.id, jump);
        li.append(row);
        if (children.length) {
          const nested = list(children),
            toggle = button(
              "",
              () => {
                nested.hidden = !nested.hidden;
                toggle.setAttribute("aria-expanded", String(!nested.hidden));
              },
              "rv-disclosure",
            );
          nested.hidden = !!state.parent;
          toggle.setAttribute("aria-label", t.branch + " " + state.title);
          toggle.setAttribute("aria-expanded", String(!nested.hidden));
          branches.set(state.id, { nested, toggle });
          row.append(toggle);
          li.append(nested);
        } else row.append(el("span", "rv-leaf"));
        row.append(jump);
        ul.append(li);
      }
      return ul;
    }
    const roots = scenario.states.filter((s) => !s.parent);
    for (const group of new Set(roots.map((s) => s.group || ""))) {
      const items = list(roots.filter((s) => (s.group || "") === group));
      if (!group) {
        tree.append(items);
        continue;
      }
      const details = el("details", "rv-tree-group");
      details.open = true;
      details.append(el("summary", "", group), items);
      tree.append(details);
    }
  }
  function rank(state) {
    let depth = 0,
      parent = state.parent;
    while (parent) {
      depth++;
      parent = scenario.states.find((s) => s.id === parent).parent;
    }
    return depth;
  }
  function detect() {
    return orderedStates.find((state) => state.match());
  }
  function drawState(state) {
    selected = state?.id || "";
    panel.dataset.state = selected;
    activeName.textContent = state?.title || t.outside;
    variants.replaceChildren();
    const visibleStates = state?.variants
      ? state.variants
          .map((id) => scenario.states.find((s) => s.id === id))
          .filter(Boolean)
      : scenario.states.filter(
          (s) => s.parent === state?.parent && s.group === state?.group,
        );
    if (state && !visibleStates.includes(state)) visibleStates.unshift(state);
    for (const option of visibleStates) {
      const node = button(option.title, () => load(option.id));
      node.setAttribute("aria-pressed", String(option === state));
      variants.append(node);
    }
    for (const [id, item] of jumpButtons) {
      if (id === selected) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    }
    for (
      let parent = state?.parent;
      parent;
      parent = scenario.states.find((s) => s.id === parent).parent
    ) {
      const branch = branches.get(parent);
      if (branch) {
        branch.nested.hidden = false;
        branch.toggle.setAttribute("aria-expanded", "true");
      }
    }
    const group = jumpButtons.get(selected)?.closest("details");
    if (group) group.open = true;
  }
  function runAction(index) {
    if (busy || !scenario) return;
    const state = detect();
    if (state?.id !== selected) {
      refresh();
      return;
    }
    const item = currentActions[index];
    if (item) {
      const node = target(item.action.target);
      if (node) activate(node);
    }
  }
  function drawActions(items) {
    currentActions = items;
    const key = JSON.stringify([
      selected,
      items.map((i) => [i.action.title, disabled(i.node)]),
    ]);
    if (key === lastActions) return;
    lastActions = key;
    actionList.replaceChildren();
    marks.replaceChildren();
    if (!items.length) actionList.append(el("p", "rv-empty", t.empty));
    for (const [index, { action, node }] of items.entries()) {
      const num = String(index + 1),
        label = t.action + " " + num + " · " + action.title;
      const row = button("", () => runAction(index)),
        pin = button(num, () => runAction(index), "rv-pin");
      row.append(el("span", "rv-number", num), el("span", "", action.title));
      row.disabled = pin.disabled = disabled(node);
      row.setAttribute("aria-label", label);
      pin.setAttribute("aria-label", label);
      pin.title = action.title;
      const box = el("div", "rv-outline");
      box.append(pin);
      marks.append(box);
      actionList.append(row);
    }
  }
  function align(items) {
    if (!marksToggle.checked || busy) {
      marks.hidden = true;
      return;
    }
    marks.hidden = false;
    const doc = frame.contentDocument,
      win = doc.defaultView;
    const width = frame.clientWidth,
      height = frame.clientHeight;
    for (const [index, { node }] of items.entries()) {
      const box = marks.children[index],
        rect = node.getBoundingClientRect();
      let left = Math.max(rect.left, 0),
        top = Math.max(rect.top, 0),
        right = Math.min(rect.right, width),
        bottom = Math.min(rect.bottom, height);
      for (
        let p = node.parentElement;
        p && p !== doc.body;
        p = p.parentElement
      ) {
        const style = win.getComputedStyle(p);
        const clipX = /auto|scroll|hidden|clip/.test(style.overflowX),
          clipY = /auto|scroll|hidden|clip/.test(style.overflowY);
        if (!clipX && !clipY) continue;
        const r = p.getBoundingClientRect();
        if (clipX) {
          left = Math.max(left, r.left + p.clientLeft);
          right = Math.min(right, r.left + p.clientLeft + p.clientWidth);
        }
        if (clipY) {
          top = Math.max(top, r.top + p.clientTop);
          bottom = Math.min(bottom, r.top + p.clientTop + p.clientHeight);
        }
      }
      box.hidden = right <= left || bottom <= top;
      if (box.hidden) continue;
      Object.assign(box.style, {
        left: left + "px",
        top: top + "px",
        width: right - left + "px",
        height: bottom - top + "px",
      });
      box.style.setProperty("--pin-top", top < 9 ? "0px" : "-8px");
      box.style.setProperty("--pin-right", right > width - 9 ? "0px" : "-8px");
    }
  }
  function refresh() {
    if (!scenario || busy) return;
    const state = detect();
    if ((state?.id || "") !== selected) drawState(state);
    const actions =
      typeof state?.actions === "function"
        ? state.actions()
        : state?.actions || [];
    const items = actions
      .map((action) => ({ action, node: target(action.target) }))
      .filter((item) => item.node);
    drawActions(items);
    align(items);
    const next = new Set(items.map((i) => i.node));
    for (const node of watched)
      if (!next.has(node)) {
        tracker.unobserve(node);
        watched.delete(node);
      }
    for (const node of next)
      if (!watched.has(node)) {
        tracker.observe(node);
        watched.add(node);
      }
  }
  function enqueue(checkState) {
    needsState ||= checkState;
    if (!scheduled)
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        const full = needsState;
        needsState = false;
        if (busy || !scenario) return;
        if (full) refresh();
        else align(currentActions);
      });
  }
  function schedule() {
    enqueue(true);
  }
  function scheduleLayout() {
    enqueue(false);
  }
  marksToggle.addEventListener("change", schedule);
  window.addEventListener("resize", schedule);
  function watch(doc, signal) {
    const observer = new MutationObserver(schedule);
    observer.observe(doc, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    for (const type of [
      "input",
      "change",
      "transitionend",
      "animationend",
      "review-change",
    ])
      doc.addEventListener(type, schedule, { capture: true, signal });
    doc.addEventListener("scroll", scheduleLayout, { capture: true, signal });
    tracker = new ResizeObserver(scheduleLayout);
    tracker.observe(frame);
    if (doc.fonts)
      doc.fonts.ready.then(() => {
        if (!signal.aborted) schedule();
      });
    signal.addEventListener(
      "abort",
      () => {
        observer.disconnect();
        tracker.disconnect();
        watched.clear();
      },
      { once: true },
    );
  }
  function load(id) {
    controller?.abort();
    const next = new AbortController();
    controller = next;
    busy = true;
    scenario = undefined;
    orderedStates = [];
    selected = null;
    lastActions = "";
    currentActions = [];
    marks.hidden = true;
    loading.hidden = false;
    error.hidden = true;
    home.disabled = true;
    reset.disabled = true;
    panel.setAttribute("aria-busy", "true");
    activeName.textContent = t.loading;
    variants.replaceChildren();
    actionList.replaceChildren();
    const nextFrame = el("iframe");
    nextFrame.title = t.preview;
    nextFrame.name = id ? "ui-review/" + id : "";
    nextFrame.addEventListener(
      "load",
      async () => {
        if (next.signal.aborted) return;
        const doc = nextFrame.contentDocument;
        try {
          if (!doc?.body) throw Error(t.preview);
          const definition = nextFrame.contentWindow.reviewScenario;
          validate(definition);
          scenario = definition;
          orderedStates = [...scenario.states].sort(
            (a, b) =>
              (b.priority || 0) - (a.priority || 0) || rank(b) - rank(a),
          );
          buildTree();
          reset.hidden = typeof scenario.reset !== "function";
          const ui = makeDriver(doc, next.signal);
          const requested = id && scenario.states.find((s) => s.id === id);
          if (id && !requested) throw Error("Unknown state " + id);
          await requested?.enter?.(ui);
          await ui.wait(
            () => (requested ? detect()?.id === requested.id : detect()),
            requested?.title || t.preview,
          );
        } catch (e) {
          if (next.signal.aborted) return;
          report(e);
        }
        if (next.signal.aborted) return;
        if (scenario) watch(doc, next.signal);
        busy = false;
        loading.hidden = true;
        if (!scenario) {
          activeName.textContent = t.outside;
          reset.hidden = true;
        }
        home.disabled = !scenario?.entry;
        reset.disabled = false;
        panel.setAttribute("aria-busy", "false");
        if (scenario?.states) refresh();
      },
      { once: true },
    );
    nextFrame.srcdoc = config.appHtml;
    if (frame) frame.replaceWith(nextFrame);
    else stage.prepend(nextFrame);
    frame = nextFrame;
  }
  load("");
})();
