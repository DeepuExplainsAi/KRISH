// Injected into the agent's tab by native code (evaluateJavascript / Playwright). Plain JS, no dependencies.
// Evaluates to the API object (nothing is assigned to a page-reachable global except element-id state).
// Native code wraps it as `var K = <this file>; K.observe()` on every call, so pages cannot spoof the API.
// Element ids are indexes into the last observe() result; the DOM is not modified.
// Native code calls these functions and reads the JSON result back; there is no JS bridge object in the page.
(function () {
  var MAX_ELEMENTS = 200;
  var MAX_SCAN = 1500;
  var MAX_POINTER = 60;
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
      // The label sits in the same tree as the control: a control inside a shadow root is labelled by a label of that root.
      var root = e.getRootNode && e.getRootNode();
      var l = (root && root.querySelector ? root : document).querySelector('label[for="' + String(e.id).replace(/"/g, '\\"') + '"]');
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
    if (e.form) d.form = Array.prototype.indexOf.call(document.forms, e.form) + 1;
    d.fp = fingerprint(e);
    return d;
  }

  var SELECTOR = 'a[href],button,input,textarea,select,summary,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[role="textbox"],[role="searchbox"],[role="combobox"],[role="menuitem"],[role="option"],[role="switch"],[role="radio"],[onclick],[tabindex]:not([tabindex="-1"]),[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';

  // Typing targets: fields whose text is the user's input, not a label. Their identity must not depend on what was typed.
  function isRich(e) {
    if (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT") return false;
    var ce = e.getAttribute("contenteditable");
    return e.isContentEditable === true || (ce !== null && ce !== "false");
  }
  function isEditable(e) {
    return isRich(e) || e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT";
  }

  function pageText() {
    var b = document.body;
    if (!b) return "";
    if (typeof b.innerText === "string") return clean(b.innerText).slice(0, MAX_TEXT);
    var c = b.cloneNode(true);
    var junk = c.querySelectorAll("script,style,noscript,template");
    for (var i = 0; i < junk.length; i++) junk[i].remove();
    return clean(c.textContent).slice(0, MAX_TEXT);
  }

  function onScreen(e) {
    var r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
  }

  // Open shadow roots are searched too (web-component buttons are invisible to a plain querySelectorAll).
  function collect(root, out, depth) {
    var found = root.querySelectorAll(SELECTOR);
    for (var i = 0; i < found.length && out.length < MAX_SCAN; i++) out.push(found[i]);
    if (depth >= 4) return;
    var all = root.querySelectorAll("*");
    for (var j = 0; j < all.length && j < MAX_SCAN * 3; j++) if (all[j].shadowRoot) collect(all[j].shadowRoot, out, depth + 1);
  }

  // Many sites build buttons from a div or span that only has a pointer cursor and a script listener. The outermost such element is
  // listed (its children inherit the cursor), unless it already holds a real control.
  function pointerTargets(skip) {
    var out = [];
    var nodes = document.querySelectorAll("div,span,li,img,svg,i,p");
    for (var i = 0; i < nodes.length && i < MAX_SCAN * 2 && out.length < MAX_POINTER; i++) {
      var e = nodes[i];
      if (skip.indexOf(e) >= 0 || !e.parentElement) continue;
      if (window.getComputedStyle(e).cursor !== "pointer" || window.getComputedStyle(e.parentElement).cursor === "pointer") continue;
      if (e.querySelector(SELECTOR)) continue;
      var r = e.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || !clean(e.innerText != null ? e.innerText : e.textContent) && !e.getAttribute("aria-label") && !e.getAttribute("title") && !e.getAttribute("alt")) continue;
      out.push(e);
    }
    return out;
  }

  // Elements on screen come first: on a heavy page (feeds, chat apps) the 200-element budget would otherwise be used up by
  // menus far above or below, and the box the user means could be cut off.
  function observe() {
    var nodes = [];
    collect(document, nodes, 0);
    nodes = nodes.concat(pointerTargets(nodes));
    var shown = [];
    var rest = [];
    var hiddenFiles = 0; // capped so a page cannot fill the element budget with them and push real fields out of view
    for (var i = 0; i < nodes.length; i++) {
      var e = nodes[i];
      if (e.tagName === "INPUT" && e.type === "hidden") continue;
      if (!visible(e)) {
        if (!isFileInput(e) || hiddenFiles >= MAX_HIDDEN_FILE_INPUTS) continue;
        hiddenFiles++;
        rest.push(e);
        continue;
      }
      (onScreen(e) ? shown : rest).push(e);
    }
    var els = (state.els = shown.concat(rest).slice(0, MAX_ELEMENTS));
    var out = [];
    for (var j = 0; j < els.length; j++) out.push(describe(els[j], j));
    return JSON.stringify({ url: location.href, title: document.title, text: pageText(), elements: out });
  }

  // Identity of an element as the gate saw it. Recomputed from the live node at action time and compared with the
  // value from the approved observation, so a page that swaps entries in its (page-reachable) registry is refused.
  function fingerprint(e) {
    var tag = e.tagName.toLowerCase();
    var text = isEditable(e) ? "" : clean(e.innerText != null ? e.innerText : e.textContent).slice(0, 60);
    return [tag, e.getAttribute("type") || "", e.getAttribute("aria-label") || "", e.getAttribute("name") || "", e.getAttribute("title") || "", text, e.href || "", e.form ? "f" : ""].join("|");
  }

  function get(id, fp) {
    var e = state.els[id];
    if (!e || !e.isConnected) throw new Error("element " + id + " is gone; observe again");
    if (fp !== undefined && fp !== null && fingerprint(e) !== fp) throw new Error("element " + id + " changed since it was observed; observe again");
    return e;
  }

  function fire(e, type, init) {
    var Ctor = type.indexOf("pointer") === 0 ? window.PointerEvent : type.indexOf("key") === 0 ? window.KeyboardEvent : window.MouseEvent;
    if (!Ctor) return;
    try {
      e.dispatchEvent(new Ctor(type, init)); // a site-side listener error or an unsupported event must never stop the click
    } catch {}
  }

  // Rich editors (chat boxes built on Lexical, Draft, ProseMirror) ignore a plain textContent change. execCommand goes through
  // the browser's own editing pipeline, so they see a normal "beforeinput" / "input" and update their model.
  function setEditable(e, value) {
    e.focus();
    var sel = window.getSelection && window.getSelection();
    if (sel && document.createRange) {
      var range = document.createRange();
      range.selectNodeContents(e);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    var done = false;
    try {
      done = value === "" ? document.execCommand("delete", false) : document.execCommand("insertText", false, value);
    } catch {
      done = false;
    }
    if (!done || clean(e.textContent) !== clean(value)) {
      e.textContent = value;
      e.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function setValue(e, value) {
    if (isRich(e)) return setEditable(e, value);
    var proto = e.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) {
      desc.set.call(e, value); // native setter so frameworks (React etc.) notice the change
    } else {
      e.value = value;
    }
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function pressEnter(e) {
    var init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    fire(e, "keydown", init);
    fire(e, "keypress", init);
    fire(e, "keyup", init);
  }

  // The visible pointer: an arrow that glides to the control the agent is about to use, and a ripple where it taps.
  // It lives in the page only while the agent works (fades after a few idle seconds) and never takes a click itself.
  var CURSOR_IDLE_MS = 4000;
  function cursor() {
    var c = state.cursor;
    if (c && c.isConnected) return c;
    c = state.cursor = document.createElement("div");
    c.setAttribute("data-krish-cursor", "1");
    c.style.cssText =
      "position:fixed;left:0;top:0;width:28px;height:28px;pointer-events:none;z-index:2147483647;opacity:0;will-change:transform;" +
      "transition:transform .32s cubic-bezier(.22,.8,.25,1),opacity .2s;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));" +
      "transform:translate(" + Math.round(window.innerWidth / 2) + "px," + window.innerHeight + "px)";
    try {
      c.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 2l16 9-7 2-3 7z" fill="#ff7a1a" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    } catch {
      c.style.cssText += ";width:14px;height:14px;border-radius:50%;background:#ff7a1a"; // a page that forbids innerHTML (Trusted Types) still gets a dot
    }
    document.documentElement.appendChild(c);
    void c.offsetWidth; // the first move starts from where it was drawn, so it glides in
    return c;
  }
  function point(e, tap) {
    if (e.scrollIntoView) e.scrollIntoView({ block: "center" });
    var r = e.getBoundingClientRect();
    var x = r.left + r.width / 2;
    var y = r.top + r.height / 2;
    var c = cursor();
    c.style.opacity = "1";
    c.style.transform = "translate(" + Math.round(x - 5) + "px," + Math.round(y - 2) + "px)";
    clearTimeout(state.cursorTimer);
    state.cursorTimer = setTimeout(function () { c.style.opacity = "0"; }, CURSOR_IDLE_MS);
    if (tap) ripple(x, y);
    return r;
  }
  function ripple(x, y) {
    var d = document.createElement("div");
    d.setAttribute("data-krish-cursor", "1");
    d.style.cssText =
      "position:fixed;pointer-events:none;z-index:2147483646;border-radius:50%;border:3px solid #ff7a1a;width:14px;height:14px;opacity:.9;" +
      "left:" + (x - 7) + "px;top:" + (y - 7) + "px;transition:transform .55s ease-out,opacity .55s ease-out";
    document.documentElement.appendChild(d);
    void d.offsetWidth;
    d.style.transform = "scale(5)";
    d.style.opacity = "0";
    setTimeout(function () { d.remove(); }, 700);
  }

  // The element that really receives a tap at x,y (through open shadow roots). Unknown (null) where the engine cannot say.
  function topAt(x, y) {
    if (typeof document.elementFromPoint !== "function") return null;
    var t = document.elementFromPoint(x, y);
    while (t && t.shadowRoot && t.shadowRoot.elementFromPoint) {
      var inner = t.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === t) break;
      t = inner;
    }
    return t;
  }
  // True when `node` is `ancestor` or sits inside it (through shadow roots): the tap reaches the element or something it contains.
  function inside(node, ancestor) {
    for (var n = node, i = 0; n && i < 200; i++, n = n.parentNode || n.host) if (n === ancestor) return true;
    return false;
  }

  function highlight(id) {
    if (state.overlay) {
      state.overlay.remove();
      state.overlay = null;
    }
    if (id == null) return "ok";
    var e = get(id);
    var r = point(e, false);
    var overlay = (state.overlay = document.createElement("div"));
    overlay.setAttribute("data-krish-overlay", "1");
    overlay.style.cssText =
      "position:fixed;pointer-events:none;z-index:2147483645;border:3px solid #ff7a1a;border-radius:6px;box-shadow:0 0 0 3px rgba(255,122,26,.3);" +
      "left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;animation:none";
    document.documentElement.appendChild(overlay);
    return "ok";
  }

  // ---- Inbox: verification code or link of the newest matching message (read_code). The value goes back to native code only. ----
  var MESSAGE_SEL = 'tr,li,article,[role="row"],[role="listitem"],[role="article"],[class*="message" i],[class*="mail" i],[class*="inbox" i],[class*="letter" i],[data-message-id],[data-id]';
  var CODE_CUE = /(code|otp|one[- ]?time|verif|confirm|passcode|pin\b|कोड|ओटीपी|código|codigo|bestätigung)/i;
  var LINK_CUE = /(verif|confirm|activat|validat|magic|sign[- ]?in|log[- ]?in|complete|finish)/i;

  function norm(s) {
    return clean(s).toLowerCase();
  }
  function textOf(e) {
    return clean(e.innerText != null ? e.innerText : e.textContent);
  }
  // Same-origin frames (many inbox sites show the open message in an iframe). Cross-origin frames cannot be read and are skipped.
  function docs() {
    var out = [document];
    var frames = document.querySelectorAll("iframe");
    for (var i = 0; i < frames.length && i < 10; i++) {
      try {
        var d = frames[i].contentDocument;
        if (d && d.body) out.push(d);
      } catch {}
    }
    return out;
  }
  function matches(text, hint) {
    if (hint.from && text.indexOf(norm(hint.from)) < 0) return false;
    if (hint.subject && text.indexOf(norm(hint.subject)) < 0) return false;
    return true;
  }
  // 4-8 digits next to a code word ("Your code is 482913", "482913 is your verification code"). Years and times are not codes.
  function codeIn(text) {
    var re = /(?:^|[^\d])(\d{4,8})(?![\d])/g;
    var m;
    var first;
    while ((m = re.exec(text))) {
      var d = m[1];
      var at = m.index + m[0].indexOf(d);
      var before = text.slice(Math.max(0, at - 40), at);
      if (/^(19|20)\d\d$/.test(d) && !CODE_CUE.test(before)) continue; // a year
      var prev = text.charAt(at - 1);
      var prev2 = text.charAt(at - 2);
      var next = text.charAt(at + d.length);
      var next2 = text.charAt(at + d.length + 1);
      // A time (10:45), a date (12/2025, 01.12.2025) or a decimal: a separator with a digit on its other side. "code:7391" is still a code.
      if (/[:/.,]/.test(prev) && /\d/.test(prev2)) continue;
      if (/[:/.,]/.test(next) && /\d/.test(next2)) continue;
      if (CODE_CUE.test(text.slice(Math.max(0, at - 80), at + d.length + 80))) return d;
      if (first === undefined) first = d;
    }
    return CODE_CUE.test(text) ? first : undefined;
  }
  function linkIn(root) {
    var links = root.querySelectorAll ? root.querySelectorAll("a[href]") : [];
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.href || "";
      if (!/^https:\/\//i.test(href)) continue;
      if (LINK_CUE.test(textOf(a)) || /verif|confirm|activat|validat|token=|magic/i.test(href)) return href;
    }
    return undefined;
  }
  // Message blocks in document order (inboxes list the newest first), innermost only, so one row is one message.
  function blocks(d, hint) {
    var all = d.querySelectorAll(MESSAGE_SEL);
    var picked = [];
    for (var i = 0; i < all.length && i < MAX_SCAN; i++) {
      var t = norm(all[i].innerText != null ? all[i].innerText : all[i].textContent);
      if (t.length < 4 || t.length > 20000 || !matches(t, hint)) continue;
      picked.push(all[i]);
    }
    return picked.filter(function (e) {
      for (var j = 0; j < picked.length; j++) if (picked[j] !== e && e.contains(picked[j])) return false;
      return true;
    });
  }
  function findCode(from, subject) {
    var hint = { from: from || "", subject: subject || "" };
    var ds = docs();
    // An opened message (a frame or the page body after the user/agent opened it) is checked first, then the list rows.
    for (var k = ds.length - 1; k >= 0; k--) {
      var d = ds[k];
      var bs = blocks(d, hint);
      if (k > 0 && !bs.length && matches(norm(textOf(d.body)), hint)) bs = [d.body];
      for (var i = 0; i < bs.length; i++) {
        var text = textOf(bs[i]);
        var code = codeIn(text);
        var link = linkIn(bs[i]);
        if (code || link) return JSON.stringify({ code: code, link: link });
      }
    }
    // No row structure at all: the whole page, but only when it reads like a verification mail.
    var body = document.body ? textOf(document.body) : "";
    if (matches(norm(body), hint) && CODE_CUE.test(body)) {
      var c = codeIn(body);
      var l = linkIn(document);
      if (c || l) return JSON.stringify({ code: c, link: l });
    }
    return JSON.stringify({});
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
      if (e.disabled) throw new Error("element " + id + " is disabled");
      var r = point(e, true);
      // The same events a real tap produces, so sites that listen for pointerdown/mousedown (menus, custom buttons) react too.
      var init = { bubbles: true, cancelable: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerType: "touch", isPrimary: true };
      fire(e, "pointerdown", init);
      fire(e, "mousedown", init);
      if (e.focus) e.focus();
      fire(e, "pointerup", init);
      fire(e, "mouseup", init);
      e.click();
      return "ok";
    },
    type: function (id, text, submit, fp) {
      var e = get(id, fp);
      point(e, false);
      e.focus();
      setValue(e, text);
      if (submit) {
        var form = e.form;
        if (form && form.requestSubmit) form.requestSubmit();
        else pressEnter(e);
      }
      return "ok";
    },
    // Used for both model-requested paste and native secret fill. Value is passed by native code only.
    fill: function (id, value, fp) {
      var e = get(id, fp);
      point(e, false);
      e.focus();
      setValue(e, value);
      return "ok";
    },
    scroll: function (dir) {
      var step = Math.round(window.innerHeight * 0.8) * (dir === "up" ? -1 : 1);
      window.scrollBy({ top: step, left: 0, behavior: "instant" });
      return "ok";
    },
    highlight: highlight,
    findCode: findCode,
    // Center of the element in CSS px (for native trusted taps, e.g. file choosers that need a user gesture).
    rect: function (id, fp) {
      var e = get(id, fp);
      if (isFileInput(e) && !visible(e)) {
        // Only a real <label> for this input: clicking it activates exactly this input, never some other control.
        e = (e.labels && e.labels[0]) || e.closest("label");
        if (!e) throw new Error("hidden file input has no label to tap; ask the user");
      }
      var r = point(e, true); // the native tap that follows lands exactly here: the pointer and ripple show it
      var top = topAt(r.left + r.width / 2, r.top + r.height / 2);
      // Something else (a cookie banner, a modal, an overlay) would receive the tap: the caller falls back to a script click on the element itself.
      if (top && !inside(top, e)) throw new Error("element " + id + " is covered by another element");
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
