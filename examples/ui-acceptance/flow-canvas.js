function createReviewFlowCanvas(flow, t, navigate) {
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  const button = (text, action, label = text) => {
    const element = make("button", "", text);
    element.type = "button";
    element.setAttribute("aria-label", label);
    element.addEventListener("click", action);
    return element;
  };
  const svg = (tag, attributes) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attributes))
      element.setAttribute(name, String(value));
    return element;
  };
  function place(element, { x, y, width, height }) {
    Object.assign(element.style, {
      left: x + "px",
      top: y + "px",
      width: width + "px",
      height: height + "px",
    });
  }

  const dialog = make("dialog", "rv-flow-dialog");
  const header = make("header", "rv-flow-head");
  const back = button("‹ " + t.flowBack, () => dialog.close(), t.flowBack);
  back.autofocus = true;
  const heading = make("h2", "", t.flow);
  heading.id = "review-flow-title";
  dialog.setAttribute("aria-labelledby", heading.id);
  const controls = make("div", "rv-flow-tools");
  const out = button("−", () => zoom(scale / 1.25), t.flowZoomOut);
  const fit = button(t.flowFit, () => fitView());
  const plus = button("+", () => zoom(scale * 1.25), t.flowZoomIn);
  controls.append(out, fit, plus);
  header.append(back, heading);
  const sections = new Map();
  if (flow.groups.length > 1) {
    const groups = make("nav", "rv-flow-groups");
    groups.setAttribute("aria-label", t.flowGroups);
    for (const group of flow.groups) {
      const shortcut = button(group.title, () => {
        setGroup(group.title);
        focusGroup(group);
      });
      groups.append(shortcut);
      sections.set(group.title, shortcut);
    }
    header.append(groups);
  }
  header.append(controls);

  const scroller = make("div", "rv-flow-scroll");
  const plane = make("div", "rv-flow-plane");
  const world = make("div", "rv-flow-world");
  world.style.width = flow.width + "px";
  world.style.height = flow.height + "px";
  const linework = svg("svg", {
    viewBox: `0 0 ${flow.width} ${flow.height}`,
    "aria-hidden": "true",
    class: "rv-flow-edges",
  });
  const defs = svg("defs", {});
  for (const kind of ["forward", "back", "error"]) {
    const marker = svg("marker", {
      id: "rv-flow-head-" + kind,
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 6,
      markerHeight: 6,
      orient: "auto",
      class: "rv-flow-edge-" + kind,
    });
    marker.append(svg("path", { d: "M0 0L10 5L0 10Z" }));
    defs.append(marker);
  }
  linework.append(defs);
  const nodeGroups = new Map(flow.nodes.map(({ id, group }) => [id, group]));
  for (const edge of flow.edges) {
    const crossesGroup = nodeGroups.get(edge.from) !== nodeGroups.get(edge.to);
    const group = svg("g", {
      class:
        "rv-flow-edge-" + edge.kind + (crossesGroup ? " rv-flow-cross" : ""),
    });
    group.append(
      svg("polyline", {
        points: edge.points.map(({ x, y }) => `${x},${y}`).join(" "),
        "marker-end": `url(#rv-flow-head-${edge.kind})`,
      }),
    );
    const label = svg("text", {
      x: edge.x,
      y: edge.y,
      "text-anchor": "middle",
      "dominant-baseline": "central",
    });
    label.textContent = edge.label;
    group.append(label);
    linework.append(group);
  }

  for (const group of flow.groups) {
    const section = make("div", "rv-flow-group", group.title);
    place(section, group);
    world.append(section);
  }
  world.append(linework);
  const cards = new Map();
  for (const node of flow.nodes) {
    const card = button(
      "",
      () => {
        dialog.close();
        navigate(node.id);
      },
      node.title,
    );
    card.className = "rv-flow-card";
    place(card, node);
    const image = make("img");
    image.src = node.image;
    image.alt = "";
    image.decoding = "async";
    image.draggable = false;
    const footer = make("span", "rv-flow-card-title");
    const current = make("span", "rv-flow-current", t.flowCurrent);
    current.setAttribute("aria-hidden", "true");
    footer.append(make("strong", "", node.title), current);
    card.append(image, footer);
    cards.set(node.id, { card, group: node.group });
    world.append(card);
  }

  plane.append(world);
  scroller.append(plane);
  dialog.append(header, scroller);
  document.body.append(dialog);

  let scale = 1;
  let fitted = false;
  let previousActive;
  const maxScale = 1.65;
  function setScale(next) {
    const minScale = Math.min(0.12, fitScale());
    scale = Math.min(maxScale, Math.max(minScale, next));
    plane.style.width = Math.ceil(flow.width * scale) + "px";
    plane.style.height = Math.ceil(flow.height * scale) + "px";
    world.style.transform = `scale(${scale})`;
    out.disabled = scale <= minScale;
    plus.disabled = scale >= maxScale;
  }
  function fitScale() {
    return Math.min(
      1,
      scroller.clientWidth / flow.width,
      scroller.clientHeight / flow.height,
    );
  }
  function fitView() {
    setGroup();
    setScale(fitScale());
    scroller.scrollTo(0, 0);
  }
  function setGroup(title) {
    for (const [key, shortcut] of sections)
      shortcut.setAttribute("aria-pressed", String(key === title));
  }
  function focusGroup(group) {
    const width = scroller.clientWidth;
    const height = scroller.clientHeight;
    const padding = 20;
    setScale(
      Math.max(
        Math.min(0.55, scale),
        Math.min(
          0.9,
          (width - padding * 2) / group.width,
          (height - padding * 2) / group.height,
        ),
      ),
    );
    scroller.scrollTo(
      (group.x + group.width / 2) * scale - width / 2,
      group.y * scale - padding,
    );
  }
  function center(card) {
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    scroller.scrollBy(
      rect.left + rect.width / 2 - (view.left + view.width / 2),
      rect.top + rect.height / 2 - (view.top + view.height / 2),
    );
  }
  function zoom(next, clientX, clientY) {
    const view = scroller.getBoundingClientRect();
    const x = clientX ?? view.left + view.width / 2;
    const y = clientY ?? view.top + view.height / 2;
    const before = world.getBoundingClientRect();
    const anchorX = (x - before.left) / scale;
    const anchorY = (y - before.top) / scale;
    setScale(next);
    const after = world.getBoundingClientRect();
    scroller.scrollBy(
      after.left + anchorX * scale - x,
      after.top + anchorY * scale - y,
    );
  }
  scroller.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoom(
        scale * Math.exp(-event.deltaY * 0.006),
        event.clientX,
        event.clientY,
      );
    },
    { passive: false },
  );
  let drag;
  scroller.addEventListener("pointerdown", (event) => {
    if (
      event.pointerType !== "mouse" ||
      event.button !== 0 ||
      event.target.closest("button") ||
      event.clientX >=
        scroller.clientWidth + scroller.getBoundingClientRect().left ||
      event.clientY >=
        scroller.clientHeight + scroller.getBoundingClientRect().top
    )
      return;
    drag = {
      x: event.clientX + scroller.scrollLeft,
      y: event.clientY + scroller.scrollTop,
    };
    scroller.setPointerCapture(event.pointerId);
  });
  scroller.addEventListener("pointermove", (event) => {
    if (!drag) return;
    scroller.scrollTo(drag.x - event.clientX, drag.y - event.clientY);
  });
  scroller.addEventListener("lostpointercapture", () => {
    drag = undefined;
  });

  return {
    open(active) {
      for (const [id, { card }] of cards) {
        if (id === active) card.setAttribute("aria-current", "step");
        else card.removeAttribute("aria-current");
      }
      dialog.showModal();
      const current = cards.get(active);
      if (!fitted) {
        fitted = true;
        setScale(Math.max(fitScale(), 0.55));
      }
      if (current && previousActive !== active) {
        setGroup(current.group);
        center(current.card);
      }
      previousActive = active;
    },
  };
}
