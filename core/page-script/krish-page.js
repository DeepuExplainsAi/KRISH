// Injected into the agent's tab by native code (evaluateJavascript / Playwright). Plain JS, no dependencies.
// Evaluates to the API object (nothing is assigned to a page-reachable global except element-id state).
// Native code wraps it as `var K = <this file>; K.observe()` on every call, so pages cannot spoof the API.
// Element ids are indexes into the last observe() result; the DOM is not modified.
// Native code calls these functions and reads the JSON result back; there is no JS bridge object in the page.
(function () {
  var MAX_ELEMENTS = 200;
  var MAX_TEXT = 60000;
  var MAX_HIDDEN_FILE_INPUTS = 5;
  // State survives re-injection so element ids stay valid between observe() and click().
  var state = window.__krishState || (window.__krishState = { els: [], overlay: null });

  function visible(e) {
    if (e.hidden || e.getAttribute("aria-hidden") === "true") return false;
    var s = window.getComputedStyle(e);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  }

  function clean(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  }

  function labelFor(e) {
    var aria = e.getAttribute("aria-label");
    if (aria) return clean(aria);
    if (e.id) {
      var l = document.querySelector('label[for="' + String(e.id).replace(/"/g, '\\"') + '"]');
      if (l) return clean(l.textContent);
    }
    var wrap = e.closest && e.closest("label");
    return wrap ? clean(wrap.textContent) : undefined;
  }

  function isFileInput(e) {
    return e.tagName === "INPUT" && e.type === "file";
  }

  // Sites usually hide the real file input behind a button or dropzone; the agent still has to be able to target it.
  function fileLabel(e) {
    var near = e.parentElement ? clean(e.parentElement.innerText != null ? e.parentElement.innerText : e.parentElement.textContent) : "";
    return near.slice(0, 120);
  }

  function describe(e, id) {
    var tag = e.tagName.toLowerCase();
    var d = { id: id, tag: tag };
    var type = e.getAttribute("type");
    if (type) d.type = type.toLowerCase();
    var role = e.getAttribute("role");
    if (role) d.role = role;
    if (e.getAttribute("name")) d.name = e.getAttribute("name");
    var label = labelFor(e) || (isFileInput(e) ? fileLabel(e) : undefined);
    if (label) d.label = label.slice(0, 200);
    if (isFileInput(e) && !visible(e)) d.hidden = true;
    var text = clean(e.innerText != null ? e.innerText : e.textContent);
    if (text && tag !== "input" && tag !== "textarea" && tag !== "select") d.text = text.slice(0, 200);
    if (e.getAttribute("placeholder")) d.placeholder = e.getAttribute("placeholder");
    if (tag === "input" || tag === "textarea" || tag === "select") d.value = String(e.value == null ? "" : e.value).slice(0, 200);
    if (tag === "input" && d.type === "submit") d.text = d.text || e.value;
    if (e.href) d.href = e.href;
    if (e.getAttribute("autocomplete")) d.autocomplete = e.getAttribute("autocomplete");
    var title = e.getAttribute("title");
    if (title) d.title = clean(title).slice(0, 200);
    if ((tag === "button" && e.type === "submit" && e.form) || (tag === "input" && (e.type === "submit" || e.type === "image"))) d.submits = true;
    if (e.disabled) d.disabled = true;
    d.fp = fingerprint(e);
    return d;
  }

  var SELECTOR = 'a[href],button,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[contenteditable="true"],summary';

  function pageText() {
    var b = document.body;
    if (!b) return "";
    if (typeof b.innerText === "string") return clean(b.innerText).slice(0, MAX_TEXT);
    var c = b.cloneNode(true);
    var junk = c.querySelectorAll("script,style,noscript,template");
    for (var i = 0; i < junk.length; i++) junk[i].remove();
    return clean(c.textContent).slice(0, MAX_TEXT);
  }

  function observe() {
    var els = (state.els = []);
    var out = [];
    var nodes = document.querySelectorAll(SELECTOR);
    var hiddenFiles = 0; // capped so a page cannot fill the element budget with them and push real fields out of view
    for (var i = 0; i < nodes.length && els.length < MAX_ELEMENTS; i++) {
      var e = nodes[i];
      if (e.tagName === "INPUT" && e.type === "hidden") continue;
      if (!visible(e)) {
        if (!isFileInput(e) || hiddenFiles >= MAX_HIDDEN_FILE_INPUTS) continue;
        hiddenFiles++;
      }
      out.push(describe(e, els.length));
      els.push(e);
    }
    return JSON.stringify({ url: location.href, title: document.title, text: pageText(), elements: out });
  }

  // Identity of an element as the gate saw it. Recomputed from the live node at action time and compared with the
  // value from the approved observation, so a page that swaps entries in its (page-reachable) registry is refused.
  function fingerprint(e) {
    var tag = e.tagName.toLowerCase();
    var text = clean(e.innerText != null ? e.innerText : e.textContent).slice(0, 60);
    return [tag, e.getAttribute("type") || "", e.getAttribute("aria-label") || "", e.getAttribute("name") || "", e.getAttribute("title") || "", text, e.href || "", e.form ? "f" : ""].join("|");
  }

  function get(id, fp) {
    var e = state.els[id];
    if (!e || !e.isConnected) throw new Error("element " + id + " is gone; observe again");
    if (fp !== undefined && fp !== null && fingerprint(e) !== fp) throw new Error("element " + id + " changed since it was observed; observe again");
    return e;
  }

  function setValue(e, value) {
    var proto = e.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (e.isContentEditable && e.tagName !== "INPUT" && e.tagName !== "TEXTAREA") {
      e.textContent = value;
    } else if (desc && desc.set) {
      desc.set.call(e, value); // native setter so frameworks (React etc.) notice the change
    } else {
      e.value = value;
    }
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function highlight(id) {
    if (state.overlay) {
      state.overlay.remove();
      state.overlay = null;
    }
    if (id == null) return "ok";
    var e = get(id);
    var r = e.getBoundingClientRect();
    var overlay = (state.overlay = document.createElement("div"));
    overlay.setAttribute("data-krish-overlay", "1");
    overlay.style.cssText =
      "position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #ff7a1a;border-radius:6px;box-shadow:0 0 0 3px rgba(255,122,26,.3);" +
      "left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px";
    document.documentElement.appendChild(overlay);
    return "ok";
  }

  return Object.freeze({
    version: 1,
    observe: observe,
    read: function (id) {
      if (id == null) return pageText();
      var e = get(id);
      return clean(e.innerText != null ? e.innerText : e.textContent).slice(0, MAX_TEXT);
    },
    click: function (id, fp) {
      var e = get(id, fp);
      if (e.scrollIntoView) e.scrollIntoView({ block: "center" });
      e.click();
      return "ok";
    },
    type: function (id, text, submit, fp) {
      var e = get(id, fp);
      e.focus();
      setValue(e, text);
      if (submit) {
        var form = e.form;
        if (form && form.requestSubmit) form.requestSubmit();
        else e.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      }
      return "ok";
    },
    // Used for both model-requested paste and native secret fill. Value is passed by native code only.
    fill: function (id, value, fp) {
      var e = get(id, fp);
      e.focus();
      setValue(e, value);
      return "ok";
    },
    highlight: highlight,
    // Center of the element in CSS px (for native trusted taps, e.g. file choosers that need a user gesture).
    rect: function (id, fp) {
      var e = get(id, fp);
      if (isFileInput(e) && !visible(e)) {
        // Only a real <label> for this input: clicking it activates exactly this input, never some other control.
        e = (e.labels && e.labels[0]) || e.closest("label");
        if (!e) throw new Error("hidden file input has no label to tap; ask the user to take over");
      }
      if (e.scrollIntoView) e.scrollIntoView({ block: "center" });
      var r = e.getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, innerWidth: window.innerWidth });
    },
    // Clicking a file input opens the native chooser; native code answers it with the user-picked file.
    // The verified DOM node itself (desktop attaches the picked file through the debugger).
    element: function (id, fp) {
      return get(id, fp);
    },
    openFileChooser: function (id, fp) {
      var e = get(id, fp);
      if (!(e.tagName === "INPUT" && e.type === "file")) throw new Error("element " + id + " is not a file input");
      e.click();
      return "ok";
    },
  });
})()
