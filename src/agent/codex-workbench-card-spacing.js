function createShowaiSpacingEditor(form, list, t, { restore, save, submit }) {
  const fields = [
    ["title-path-gap", "titlePathGap", 32],
    ["path-body-gap", "pathBodyGap", 32],
    ["padding-y", "cardPaddingY", 40],
    ["padding-x", "cardPaddingX", 40],
    ["logo-gap", "cardLogoGap", 32],
    ["actions-gap", "cardActionsGap", 32],
    ["stack-gap", "cardStackGap", 32],
  ];
  const grid = document.createElement("div");
  grid.className = "showai-spacing-fields";
  const inputs = new Map();
  const values = {};
  const defaults = getComputedStyle(list);

  function setValue(key, value) {
    const { input, output } = inputs.get(key);
    values[key] = value;
    input.value = String(value);
    output.textContent = value + " px";
    list.style.setProperty("--showai-card-" + key, value + "px");
  }

  for (const [key, labelKey, max] of fields) {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    const output = document.createElement("output");
    const input = document.createElement("input");
    input.type = "range";
    input.className = "showai-range";
    input.min = "0";
    input.max = String(max);
    input.step = "1";
    input.id = form.id + "-" + key;
    input.setAttribute("aria-label", t(labelKey));
    output.setAttribute("for", input.id);
    caption.textContent = t(labelKey);
    caption.append(output);
    label.append(caption, input);
    grid.append(label);
    inputs.set(key, { input, output });
    setValue(key, parseFloat(defaults.getPropertyValue("--showai-card-" + key)));
    input.addEventListener("input", () => {
      setValue(key, input.valueAsNumber);
      feedback.hidden = true;
      transfer.hidden = true;
    });
    input.addEventListener("change", () => save?.({ ...values }));
  }
  function restoreValues(snapshot) {
    if (!snapshot) return;
    for (const [key, , max] of fields) {
      const value = snapshot[key];
      if (Number.isInteger(value) && value >= 0 && value <= max) setValue(key, value);
    }
  }
  restoreValues(restore?.());

  const button = document.createElement("button");
  button.type = "button";
  button.className = "showai-button showai-spacing-apply";
  button.textContent = t("applySpacing");
  const feedback = document.createElement("p");
  feedback.setAttribute("role", "status");
  feedback.hidden = true;
  const transfer = document.createElement("textarea");
  transfer.readOnly = true;
  transfer.hidden = true;
  transfer.rows = 3;
  transfer.setAttribute("aria-label", t("spacingValues"));
  button.addEventListener("click", async () => {
    const snapshot = { ...values };
    const summary = fields.map(([key, labelKey]) => t(labelKey) + " " + snapshot[key] + " px").join(" · ");
    const prompt = t("spacingRequest") + "\n" + summary;
    button.disabled = true;
    let handedOff = false;
    let reason = "";
    try {
      handedOff = !!(await submit?.(prompt, snapshot));
    } catch (error) {
      reason = error.message;
    } finally {
      button.disabled = false;
      transfer.value = prompt;
      transfer.hidden = handedOff;
      feedback.textContent = [t(handedOff ? "spacingSubmitted" : "spacingCopy"), reason].filter(Boolean).join(" · ");
      feedback.hidden = false;
      if (!handedOff) { transfer.focus(); transfer.select(); }
    }
  });
  form.setAttribute("aria-label", t("spacingValues"));
  form.replaceChildren(grid, button, feedback, transfer);
  form.hidden = false;
  return { restoreValues };
}
