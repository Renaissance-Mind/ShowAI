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
        info: "预览信息",
        source: "代码来源",
        previewSource: "验收页来源",
        build: "构建时间",
        content: "内容指纹",
        data: "数据来源",
        unknown: "未记录",
        dirty: "含未提交改动",
        clean: "工作区干净",
        checks: "检查流程",
        close: "关闭",
        checking: "正在检查",
        checked: "检查完成",
        stopped: "检查已停止",
        stop: "停止检查",
        unavailable: "未出现",
        missing: "没有可用控件",
        motion: "动效观察",
        motionStart: "开始记录",
        motionStop: "停止记录",
        motionRunning: "正在记录，请操作界面",
        motionFull: "系统动态效果：完整",
        motionReduced: "系统动态效果：减少",
        motionEvents: "动画事件",
        motionFrames: "帧间隔",
        motionNoFrames: "当前窗口没有可用帧样本",
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
        info: "Preview information",
        source: "Source",
        previewSource: "Preview source",
        build: "Built",
        content: "Content fingerprint",
        data: "Data",
        unknown: "Not recorded",
        dirty: "Uncommitted changes",
        clean: "Clean working tree",
        checks: "Check flow",
        close: "Close",
        checking: "Checking",
        checked: "Checks complete",
        stopped: "Checks stopped",
        stop: "Stop checks",
        unavailable: "Unavailable",
        missing: "No controls found",
        motion: "Motion observation",
        motionStart: "Start recording",
        motionStop: "Stop recording",
        motionRunning: "Recording. Interact with the preview.",
        motionFull: "System motion: full",
        motionReduced: "System motion: reduced",
        motionEvents: "Animation events",
        motionFrames: "Frame intervals",
        motionNoFrames: "No visible frame samples",
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
    preparation = el("p", "rv-preparation"),
    variants = el("div", "rv-states");
  preparation.hidden = true;
  stateSection.append(activeName, preparation, variants);
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
  const info = el("details", "rv-info");
  info.append(el("summary", "", t.info));
  const infoBody = el("dl", "rv-info-body");
  info.append(infoBody);
  const source = config.metadata || {};
  function infoLine(label, value) {
    infoBody.append(el("dt", "", label), el("dd", "", value || t.unknown));
  }
  function describeSource(value) {
    return [
      value.checkout,
      value.branch,
      value.revision?.slice(0, 12),
      typeof value.dirty === "boolean" ? (value.dirty ? t.dirty : t.clean) : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  infoLine(t.source, describeSource(source));
  if (source.previewSource)
    infoLine(t.previewSource, describeSource(source.previewSource));
  infoLine(
    t.build,
    source.generatedAt && new Date(source.generatedAt).toLocaleString(),
  );
  infoLine(t.content, source.contentHash?.slice(0, 16));
  infoLine(t.data, source.dataSource);
  const dataLine = infoBody.lastElementChild;
  const checksButton = button(t.checks, openChecks);
  checksButton.hidden = true;
  tools.append(marksLabel, treeToggle, checksButton, reset, info);
  header.append(el("h1", "", document.title), tools);
  panel.append(stateSection, actionSection, treeSection, error, home);
  stage.append(marks, loading);
  body.append(stage, panel);
  root.append(header, body);

  const checksDialog = el("dialog", "rv-check-dialog");
  const checksHead = el("div", "rv-check-head");
  checksHead.append(
    el("h2", "", t.checks),
    button(t.close, () => checksDialog.close()),
  );
  const checksStatus = el("p", "rv-check-status");
  checksStatus.setAttribute("role", "status");
  const checksList = el("ol", "rv-check-results");
  const stopChecks = button(t.stop, () => checkController?.abort());
  checksDialog.append(checksHead, checksStatus, checksList, stopChecks);
  root.append(checksDialog);

  const motion = el("details", "rv-motion");
  motion.append(el("summary", "", t.motion));
  const motionPreference = el("p", "rv-motion-preference");
  const motionOutput = el("output", "rv-motion-output");
  motionOutput.setAttribute("aria-live", "polite");
  const motionButton = button(t.motionStart, toggleMotion);
  motion.append(motionPreference, motionButton, motionOutput);
  panel.insertBefore(motion, treeSection);

  let frame,
    scenario,
    controller,
    selected,
    scheduled = 0,
    lastActions = "",
    treeShape = "",
    busy = true,
    checkController,
    motionRecording;
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
  function visible(element, doc = frame?.contentDocument) {
    return (
      !!element?.isConnected &&
      element.ownerDocument === doc &&
      !element.closest(
        "[hidden],[inert],[aria-hidden=true],[data-exit-ghost]",
      ) &&
      element.getClientRects().length > 0 &&
      (element.checkVisibility?.({ visibilityProperty: true }) ?? true)
    );
  }
  function disabled(element) {
    return (
      element.matches(":disabled") || !!element.closest("[aria-disabled=true]")
    );
  }
  function target(value, doc = frame.contentDocument) {
    const found =
      typeof value === "function" ? value() : doc.querySelector(value);
    return visible(found, doc) ? found : null;
  }
  function activate(element, doc = frame.contentDocument) {
    if (!visible(element, doc) || disabled(element)) return;
    if (doc === frame?.contentDocument) {
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
      element.focus({ preventScroll: true });
    }
    element.click();
    if (doc === frame?.contentDocument) schedule();
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
        const events = [
          "input",
          "change",
          "transitionend",
          "animationend",
          "review-change",
        ];
        let settled = false;
        const timer = setTimeout(
          () => finish(reject, new Error(description)),
          6000,
        );
        function finish(callback, value) {
          if (settled) return;
          settled = true;
          observer.disconnect();
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          for (const type of events) doc.removeEventListener(type, check, true);
          callback(value);
        }
        function abort() {
          finish(reject, signal.reason);
        }
        function check() {
          if (settled) return;
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
        for (const type of events) doc.addEventListener(type, check, true);
        doc.fonts?.ready.then(check);
        check();
      });
    }
    async function control(value, label) {
      const element = await wait(() => {
        const node = target(value, doc);
        return node && !disabled(node) && node;
      }, label);
      signal.throwIfAborted();
      return element;
    }
    return {
      wait,
      signal,
      async click(value, label) {
        activate(await control(value, label || String(value)), doc);
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
  function rank(state, definition = scenario) {
    let depth = 0,
      parent = state.parent;
    while (parent) {
      depth++;
      parent = definition.states.find((s) => s.id === parent).parent;
    }
    return depth;
  }
  function detect() {
    return orderedStates.find((state) => state.match());
  }
  function drawState(state) {
    selected = state?.id || "";
    panel.dataset.state = selected;
    if (selected) {
      const params = new URLSearchParams(location.hash.slice(1));
      params.set("state", selected);
      history.replaceState(history.state, "", "#" + params.toString());
    }
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
    jumpButtons
      .get(selected)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
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
  function actionName(node) {
    const labelled = node.getAttribute("aria-labelledby");
    const references = labelled
      ?.split(/\s+/)
      .map((id) => node.ownerDocument.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    return (
      node.getAttribute("aria-label") ||
      references ||
      node.labels?.[0]?.textContent?.trim() ||
      node.getAttribute("placeholder") ||
      node.getAttribute("title") ||
      (node.matches("input,textarea,select") ? "" : node.textContent.trim()) ||
      (node.matches(
        'input[type="button"],input[type="submit"],input[type="reset"]',
      )
        ? node.value
        : "") ||
      ""
    ).trim();
  }
  function discoverActions(doc, items, filter) {
    const dialogs = [
      ...doc.querySelectorAll('[role="dialog"],[role="menu"]'),
    ].filter((node) => visible(node, doc));
    const area = dialogs.at(-1) || doc.body;
    const selector = [
      "button",
      "input:not([type=hidden])",
      "select",
      "textarea",
      "a[href]",
      '[role="button"]',
      '[role="menuitem"]',
      '[role="checkbox"]',
      '[role="combobox"]',
      '[role="tab"]',
    ].join(",");
    const nodes = [...area.querySelectorAll(selector)];
    for (const node of nodes) {
      if (!visible(node, doc) || node.closest("[data-review-ignore]")) continue;
      if (typeof filter === "function" && !filter(node)) continue;
      if (items.some((item) => item.node === node || item.node.contains(node)))
        continue;
      const title = actionName(node);
      if (title) items.push({ action: { title, target: () => node }, node });
    }
  }
  function drawActions(items) {
    currentActions = items;
    actionSection.firstElementChild.textContent =
      t.actions + " · " + items.length;
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
    const discovery = state?.discoverActions ?? scenario.discoverActions;
    if (discovery) discoverActions(frame.contentDocument, items, discovery);
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
    let mutationRefresh = 0;
    const observer = new MutationObserver((changes) => {
      if (
        marksToggle.checked &&
        changes.every(
          (change) =>
            change.type === "attributes" && change.attributeName === "style",
        )
      )
        scheduleLayout();
      if (!mutationRefresh)
        mutationRefresh = setTimeout(() => {
          mutationRefresh = 0;
          schedule();
        }, 60);
    });
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
    const motionQuery = doc.defaultView.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    motionQuery.addEventListener(
      "change",
      () => {
        motionPreference.textContent = motionQuery.matches
          ? t.motionReduced
          : t.motionFull;
      },
      { signal },
    );
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
        clearTimeout(mutationRefresh);
        watched.clear();
      },
      { once: true },
    );
  }
  function load(id) {
    if (motionRecording) finishMotion();
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
    checksButton.hidden = true;
    panel.setAttribute("aria-busy", "true");
    activeName.textContent = t.loading;
    preparation.hidden = true;
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
          checksButton.hidden = scenario.checkIsolation !== true;
          dataLine.textContent =
            [
              ...new Set(
                [source.dataSource, scenario.dataSource].filter(Boolean),
              ),
            ].join(" · ") || t.unknown;
          preparation.textContent = scenario.preparation || "";
          preparation.hidden = !scenario.preparation;
          motionPreference.textContent = nextFrame.contentWindow.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches
            ? t.motionReduced
            : t.motionFull;
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
  function toggleMotion() {
    if (motionRecording) {
      finishMotion();
      return;
    }
    const doc = frame.contentDocument;
    const controller = new AbortController();
    const events = new Map();
    const intervals = [];
    const recording = {
      controller,
      events,
      intervals,
      reduced: frame.contentWindow.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches,
      previous: null,
      frameId: 0,
      timer: 0,
    };
    for (const type of [
      "transitionrun",
      "transitionend",
      "transitioncancel",
      "animationstart",
      "animationend",
      "animationcancel",
    ]) {
      doc.addEventListener(
        type,
        (event) => {
          const name = event.propertyName || event.animationName || "";
          const key = name ? type + " · " + name : type;
          events.set(key, (events.get(key) || 0) + 1);
        },
        { capture: true, signal: controller.signal },
      );
    }
    function sample(now) {
      if (document.visibilityState === "visible") {
        if (recording.previous !== null)
          intervals.push(now - recording.previous);
        recording.previous = now;
      } else recording.previous = null;
      recording.frameId = requestAnimationFrame(sample);
    }
    recording.frameId = requestAnimationFrame(sample);
    recording.timer = setTimeout(finishMotion, 5000);
    motionRecording = recording;
    motionButton.textContent = t.motionStop;
    motionOutput.textContent = t.motionRunning;
  }
  function finishMotion() {
    const recording = motionRecording;
    if (!recording) return;
    motionRecording = undefined;
    recording.controller.abort();
    clearTimeout(recording.timer);
    cancelAnimationFrame(recording.frameId);
    motionButton.textContent = t.motionStart;
    const preference = recording.reduced ? t.motionReduced : t.motionFull;
    const eventText =
      [...recording.events]
        .map(([name, count]) => name + " × " + count)
        .join(", ") || "0";
    const frames = recording.intervals.length
      ? recording.intervals.length +
        (zh ? " 帧，最大 " : " frames, max ") +
        Math.max(...recording.intervals).toFixed(1) +
        " ms"
      : t.motionNoFrames;
    motionOutput.textContent =
      preference +
      " · " +
      t.motionEvents +
      ": " +
      eventText +
      " · " +
      t.motionFrames +
      ": " +
      frames;
  }
  async function checkState(state, signal) {
    const probe = el("iframe", "rv-check-frame");
    probe.title = t.checks + " · " + state.title;
    probe.name = "ui-review-check/" + state.id;
    probe.srcdoc = config.appHtml;
    const abort = () => probe.remove();
    signal.addEventListener("abort", abort, { once: true });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(reject, Error(t.loading)), 6000);
        function finish(callback, value) {
          clearTimeout(timer);
          signal.removeEventListener("abort", cancelled);
          callback(value);
        }
        function cancelled() {
          finish(reject, signal.reason);
        }
        signal.addEventListener("abort", cancelled, { once: true });
        probe.addEventListener("load", () => finish(resolve), { once: true });
        stage.append(probe);
      });
      signal.throwIfAborted();
      const doc = probe.contentDocument;
      const definition = probe.contentWindow.reviewScenario;
      validate(definition);
      if (definition.checkIsolation !== true) throw Error(t.missing);
      const requested = definition.states.find((item) => item.id === state.id);
      if (!requested) throw Error("Unknown state " + state.id);
      const ordered = [...definition.states].sort(
        (a, b) =>
          (b.priority || 0) - (a.priority || 0) ||
          rank(b, definition) - rank(a, definition),
      );
      const ui = makeDriver(doc, signal);
      await requested.enter?.(ui);
      await ui.wait(
        () => ordered.find((item) => item.match())?.id === state.id,
        requested.title,
      );
      const actions =
        typeof requested.actions === "function"
          ? requested.actions()
          : requested.actions || [];
      function inspectActions() {
        const items = [];
        const absent = [];
        const required = [];
        for (const action of actions) {
          const node = target(action.target, doc);
          if (node) items.push({ action, node });
          else {
            absent.push(action.title);
            if (!action.optional) required.push(action.title);
          }
        }
        const discovery =
          requested.discoverActions ?? definition.discoverActions;
        if (discovery) discoverActions(doc, items, discovery);
        const present = items.map(
          ({ action, node }) =>
            action.title +
            (disabled(node) ? (zh ? "（禁用）" : " (disabled)") : ""),
        );
        return { present, absent, required };
      }
      let result = inspectActions();
      try {
        await ui.wait(() => {
          result = inspectActions();
          return result.present.length && !result.required.length;
        }, t.missing);
      } catch (error) {
        if (signal.aborted) throw error;
        throw Error(
          t.missing + ": " + (result.required.join(" · ") || requested.title),
        );
      }
      return result;
    } finally {
      signal.removeEventListener("abort", abort);
      probe.remove();
    }
  }
  async function openChecks() {
    if (!scenario?.checkIsolation || checkController) return;
    const states = scenario.states.map(({ id, title }) => ({ id, title }));
    const controller = new AbortController();
    checkController = controller;
    checksList.replaceChildren();
    checksStatus.textContent = t.checking + " 0 / " + states.length;
    stopChecks.hidden = false;
    checksDialog.showModal();
    let failures = 0;
    for (const [index, state] of states.entries()) {
      if (controller.signal.aborted) break;
      const row = el("li", "rv-check-row");
      row.append(el("strong", "", state.title));
      checksList.append(row);
      try {
        const result = await checkState(state, controller.signal);
        row.append(el("span", "", result.present.join(" · ")));
        if (result.absent.length)
          row.append(
            el("small", "", t.unavailable + ": " + result.absent.join(" · ")),
          );
        row.dataset.result = "pass";
      } catch (reason) {
        if (controller.signal.aborted) break;
        failures++;
        row.dataset.result = "fail";
        row.append(el("span", "", reason.message || String(reason)));
      }
      checksStatus.textContent =
        t.checking +
        " " +
        (index + 1) +
        " / " +
        states.length +
        (failures ? " · " + failures + (zh ? " 项失败" : " failed") : "");
    }
    checksStatus.textContent = controller.signal.aborted
      ? t.stopped
      : t.checked +
        " · " +
        (states.length - failures) +
        " / " +
        states.length +
        (failures ? " · " + failures + (zh ? " 项失败" : " failed") : "");
    stopChecks.hidden = true;
    checkController = undefined;
  }
  checksDialog.addEventListener("close", () => checkController?.abort());
  window.addEventListener("hashchange", () => {
    const state = new URLSearchParams(location.hash.slice(1)).get("state");
    if (state && state !== selected) load(state);
  });
  load(new URLSearchParams(location.hash.slice(1)).get("state") || "");
})();
