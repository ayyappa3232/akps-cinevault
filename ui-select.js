/**
 * ui-select.js — custom dropdown that replaces native <select> elements.
 *
 * WHY: the open list of a native <select> is drawn by the browser/OS and cannot be
 * styled, so it never matched the CineVault look.
 *
 * HOW: every <select> is kept in the DOM (hidden) as the source of truth. We add a
 * button (the "trigger") and a floating list (the "panel"). Choosing an option sets
 * select.value and fires `input` + `change`, so all existing event handlers keep working.
 *
 * USAGE (called from app.js after each render):
 *   CineSelect.enhance(rootElement)   // upgrade every <select> inside root
 *   CineSelect.sync(selectElement)    // refresh label/options after changing a select in code
 *   CineSelect.close()                // close any open panel
 *
 * Opt out per element with the attribute  data-native.
 * Keyboard: Enter/Space/↓ open · ↑↓ move · Home/End · type to jump · Enter select · Esc close.
 */
const CineSelect = (() => {
  let current = null; // the open dropdown: { select, trigger, panel, options, activeIndex }

  /** Upgrade all not-yet-upgraded selects inside `root`. */
  function enhance(root = document) {
    root.querySelectorAll("select:not([data-native])").forEach(setup);
  }

  /** Re-read the select's options and selected value (e.g. after we filled it from an API). */
  function sync(select) {
    if (select._cineSelect) select._cineSelect.sync();
    else setup(select);
  }

  function setup(select) {
    if (select._cineSelect) return select._cineSelect.sync();

    // Wrap: <div class="cs"> [trigger button] [hidden native select] </div>
    const wrap = document.createElement("div");
    wrap.className = "cs";
    select.parentNode.insertBefore(wrap, select);

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "cs-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const labelText = select.closest("label")?.querySelector("span")?.textContent;
    trigger.setAttribute("aria-label", select.getAttribute("aria-label") || labelText || "Choose an option");

    wrap.append(trigger, select);
    select.classList.add("cs-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    const api = {
      sync() {
        const selected = select.options[select.selectedIndex];
        trigger.textContent = selected ? selected.textContent : "";
        trigger.disabled = select.disabled;
        wrap.classList.toggle("is-empty", !select.value); // "All"/placeholder looks muted
      },
    };
    select._cineSelect = api;
    api.sync();

    trigger.addEventListener("click", () => (current?.select === select ? close() : open(select, trigger)));
    trigger.addEventListener("keydown", (event) => onTriggerKey(event, select, trigger));
  }

  /** Build and show the floating list under (or above) the trigger. */
  function open(select, trigger) {
    close();
    const panel = document.createElement("div");
    panel.className = "cs-panel";
    panel.setAttribute("role", "listbox");
    panel.tabIndex = -1;

    const options = [...select.options].map((option, index) => {
      const item = document.createElement("div");
      item.className = "cs-opt";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === select.selectedIndex));
      item.innerHTML = `<span></span><i aria-hidden="true">✓</i>`;
      item.firstChild.textContent = option.textContent;
      item.addEventListener("mousedown", (event) => event.preventDefault()); // keep focus on trigger
      item.addEventListener("click", () => choose(index));
      panel.appendChild(item);
      return item;
    });

    // Inside a <dialog> the panel must live in the dialog, otherwise the dialog's top layer would cover it.
    (select.closest("dialog") || document.body).appendChild(panel);
    current = {
      select,
      trigger,
      panel,
      options,
      activeIndex: Math.max(select.selectedIndex, 0),
      typed: "",
      typedAt: 0,
    };
    trigger.setAttribute("aria-expanded", "true");
    position();
    highlight(current.activeIndex, true);
  }

  function close() {
    if (!current) return;
    current.panel.remove();
    current.trigger.setAttribute("aria-expanded", "false");
    current = null;
  }

  /** Place the panel below the trigger, or above it when there is no room. */
  function position() {
    if (!current) return;
    const { trigger, panel } = current;
    const box = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - box.bottom - 12;
    const spaceAbove = box.top - 12;
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(320, openUp ? spaceAbove : spaceBelow);
    panel.style.minWidth = box.width + "px";
    panel.style.maxHeight = maxHeight + "px";
    panel.style.left = Math.min(box.left, window.innerWidth - panel.offsetWidth - 8) + "px";
    panel.style[openUp ? "bottom" : "top"] =
      (openUp ? window.innerHeight - box.top + 6 : box.bottom + 6) + "px";
    panel.style[openUp ? "top" : "bottom"] = "auto";
  }

  /** Move the keyboard highlight. */
  function highlight(index, scroll) {
    if (!current) return;
    const { options } = current;
    current.activeIndex = (index + options.length) % options.length;
    options.forEach((item, i) => item.classList.toggle("is-active", i === current.activeIndex));
    if (scroll) options[current.activeIndex].scrollIntoView({ block: "nearest" });
  }

  /** Apply a choice to the native select and notify listeners. */
  function choose(index) {
    if (!current) return;
    const { select, trigger } = current;
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    select._cineSelect.sync();
    close();
    trigger.focus();
    if (changed) {
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function onTriggerKey(event, select, trigger) {
    if (!current) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        open(select, trigger);
      }
      return;
    }
    const keys = {
      ArrowDown: () => highlight(current.activeIndex + 1, true),
      ArrowUp: () => highlight(current.activeIndex - 1, true),
      Home: () => highlight(0, true),
      End: () => highlight(current.options.length - 1, true),
      Enter: () => choose(current.activeIndex),
      " ": () => choose(current.activeIndex),
      Escape: () => close(),
      Tab: () => close(),
    };
    if (keys[event.key]) {
      event.preventDefault();
      keys[event.key]();
    } else if (event.key.length === 1) {
      // Type-ahead: typing "ta" jumps to "Tamil".
      const now = Date.now();
      current.typed = now - current.typedAt > 700 ? event.key : current.typed + event.key;
      current.typedAt = now;
      const match = [...current.select.options].findIndex((o) =>
        o.textContent.toLowerCase().startsWith(current.typed.toLowerCase()),
      );
      if (match >= 0) highlight(match, true);
    }
  }

  // Close when clicking elsewhere, scrolling the page, or resizing.
  document.addEventListener("mousedown", (event) => {
    if (current && !current.panel.contains(event.target) && !current.trigger.contains(event.target)) close();
  });
  window.addEventListener("resize", close);
  window.addEventListener(
    "scroll",
    (event) => {
      if (current && !current.panel.contains(event.target)) close();
    },
    true,
  );

  return { enhance, sync, close };
})();
