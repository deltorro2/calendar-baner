/* ---------------------------------------------------------------
   Prism — a colorful week calendar with per-day task lists.

   Local-first: every change is written to localStorage and rendered
   immediately. When a sync key is set, changes are also pushed to the
   D1-backed API and merged with whatever other devices have written.
   The app stays fully usable with no key and no connection.
   --------------------------------------------------------------- */
(function () {
  "use strict";

  var STORAGE_KEY = "prism.calendar.v2";
  var LEGACY_KEY = "prism.calendar.v1";
  var KEY_STORAGE = "prism.sync.key";
  var SYNC_URL = "api/sync";

  var DAYS_SHOWN = 7;
  var WEEK_STARTS_ON = 1; // 0 = Sunday, 1 = Monday
  var SYNC_DEBOUNCE = 900;
  var SYNC_INTERVAL = 60000;
  var TOMBSTONE_TTL = 30 * 86400000; // forget deletions after 30 days

  var WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  var EMPTY_PROMPTS = ["Nothing yet", "Wide open", "All clear", "Free day", "Blank slate", "Nothing planned", "Empty"];

  /* ---------------- DOM ---------------- */
  var board = document.getElementById("board");
  var rangeLabel = document.getElementById("rangeLabel");
  var statTotal = document.getElementById("statTotal");
  var statDone = document.getElementById("statDone");
  var scrim = document.getElementById("scrim");
  var sheet = document.getElementById("sheet");
  var sheetDate = document.getElementById("sheetDate");
  var sheetTitle = document.getElementById("sheetTitle");
  var taskForm = document.getElementById("taskForm");
  var taskInput = document.getElementById("taskInput");
  var toastEl = document.getElementById("toast");

  var syncBtn = document.getElementById("syncBtn");
  var syncLabel = document.getElementById("syncLabel");
  var syncPanel = document.getElementById("syncPanel");
  var syncForm = document.getElementById("syncForm");
  var syncKeyInput = document.getElementById("syncKey");
  var syncStatus = document.getElementById("syncStatus");

  /* ---------------- State ---------------- */
  /* state.tasks is a flat map by id. `dirty` is local-only bookkeeping:
     it marks a task as not yet accepted by the server. */
  var state = load();
  var anchor = startOfWeek(new Date());
  var activeKey = null;
  var lastFocused = null;
  var toastTimer = null;

  var sync = {
    key: readRaw(KEY_STORAGE) || "",
    phase: "off",     // off | syncing | ok | offline | rejected | error
    at: 0,
    timer: null,
    inFlight: false
  };

  /* ---------------- Storage ---------------- */
  var storageWarned = false;

  function readRaw(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function writeRaw(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      if (!storageWarned) {
        storageWarned = true;
        toast("Storage is blocked here — changes last until you reload");
      }
      return false;
    }
  }

  function load() {
    var raw = readRaw(STORAGE_KEY);
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.tasks) return prune(parsed);
      } catch (err) { /* fall through to the legacy read */ }
    }

    var legacy = readRaw(LEGACY_KEY);
    if (legacy) {
      try {
        return migrate(JSON.parse(legacy));
      } catch (err) { /* start clean */ }
    }
    return { tasks: {}, lastSync: 0 };
  }

  /* v1 stored day -> [{id, text, done}]. Carry it into the flat shape so
     nobody loses a task by upgrading. */
  function migrate(old) {
    var next = { tasks: {}, lastSync: 0 };
    var stamp = Date.now();
    Object.keys(old).forEach(function (day) {
      if (!Array.isArray(old[day])) return;
      old[day].forEach(function (task, i) {
        if (!task || typeof task.text !== "string") return;
        var id = task.id || newId();
        next.tasks[id] = {
          id: id,
          day: day,
          text: task.text,
          done: !!task.done,
          position: i,
          updated: stamp,
          deleted: false,
          dirty: true
        };
      });
    });
    return next;
  }

  function prune(loaded) {
    var cutoff = Date.now() - TOMBSTONE_TTL;
    Object.keys(loaded.tasks).forEach(function (id) {
      var task = loaded.tasks[id];
      if (task.deleted && !task.dirty && task.updated < cutoff) delete loaded.tasks[id];
    });
    if (typeof loaded.lastSync !== "number") loaded.lastSync = 0;
    return loaded;
  }

  function save() {
    writeRaw(STORAGE_KEY, JSON.stringify(state));
  }

  function newId() {
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------------- Dates ---------------- */
  function startOfWeek(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var shift = (d.getDay() - WEEK_STARTS_ON + 7) % 7;
    d.setDate(d.getDate() - shift);
    return d;
  }

  function addDays(date, n) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + n);
    return d;
  }

  function keyOf(date) {
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    return date.getFullYear() + "-" + m + "-" + d;
  }

  function isToday(date) {
    return keyOf(date) === keyOf(new Date());
  }

  function isPast(date) {
    var today = new Date();
    return date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }

  function relativeLabel(date) {
    var diff = Math.round((date - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    return null;
  }

  /* ---------------- Task queries ---------------- */
  function byDay() {
    var index = {};
    Object.keys(state.tasks).forEach(function (id) {
      var task = state.tasks[id];
      if (task.deleted) return;
      (index[task.day] = index[task.day] || []).push(task);
    });
    Object.keys(index).forEach(function (day) {
      index[day].sort(function (a, b) {
        return a.position - b.position || a.updated - b.updated;
      });
    });
    return index;
  }

  /* ---------------- Rendering ---------------- */
  function render() {
    var index = byDay();
    board.textContent = "";
    var frag = document.createDocumentFragment();
    var total = 0;
    var done = 0;

    for (var i = 0; i < DAYS_SHOWN; i++) {
      var date = addDays(anchor, i);
      var tasks = index[keyOf(date)] || [];
      total += tasks.length;
      for (var t = 0; t < tasks.length; t++) {
        if (tasks[t].done) done++;
      }
      frag.appendChild(buildTile(date, tasks, i));
    }

    board.appendChild(frag);
    statTotal.textContent = String(total);
    statDone.textContent = String(done);
    renderRange();
  }

  function renderRange() {
    var first = anchor;
    var last = addDays(anchor, DAYS_SHOWN - 1);
    var label;
    if (first.getMonth() === last.getMonth()) {
      label = MONTH_LONG[first.getMonth()] + " " + first.getDate() + " – " + last.getDate() + ", " + last.getFullYear();
    } else {
      label = MONTH_SHORT[first.getMonth()] + " " + first.getDate() + " – " +
        MONTH_SHORT[last.getMonth()] + " " + last.getDate() + ", " + last.getFullYear();
    }
    rangeLabel.textContent = label;
  }

  function buildTile(date, tasks, index) {
    var key = keyOf(date);
    var dow = date.getDay();

    var tile = document.createElement("article");
    tile.className = "day";
    tile.dataset.key = key;
    tile.tabIndex = 0;
    tile.setAttribute("role", "button");
    tile.setAttribute("aria-label",
      "Add a task on " + WEEKDAY_LONG[dow] + ", " + MONTH_LONG[date.getMonth()] + " " + date.getDate());
    tile.style.setProperty("--accent", "var(--d" + dow + "-a)");
    tile.style.setProperty("--accent-2", "var(--d" + dow + "-b)");
    tile.style.animationDelay = (index * 45) + "ms";
    if (isToday(date)) tile.classList.add("day--today");
    else if (isPast(date)) tile.classList.add("day--past");

    var head = document.createElement("header");
    head.className = "day__head";

    var headText = document.createElement("div");
    var weekday = document.createElement("p");
    weekday.className = "day__weekday";
    weekday.textContent = WEEKDAY_SHORT[dow];
    var number = document.createElement("p");
    number.className = "day__number";
    number.textContent = String(date.getDate());
    var month = document.createElement("p");
    month.className = "day__month";
    month.textContent = MONTH_SHORT[date.getMonth()];
    headText.appendChild(weekday);
    headText.appendChild(number);
    headText.appendChild(month);
    head.appendChild(headText);

    if (isToday(date)) {
      var badge = document.createElement("span");
      badge.className = "day__badge";
      badge.textContent = "Today";
      head.appendChild(badge);
    } else if (tasks.length) {
      var count = document.createElement("span");
      count.className = "day__count";
      count.textContent = String(tasks.length);
      head.appendChild(count);
    }
    tile.appendChild(head);

    if (tasks.length) {
      var list = document.createElement("ol");
      list.className = "day__tasks";
      for (var i = 0; i < tasks.length; i++) {
        list.appendChild(buildTask(tasks[i]));
      }
      tile.appendChild(list);
    } else {
      var empty = document.createElement("p");
      empty.className = "day__empty";
      var icon = document.createElement("span");
      icon.textContent = "✧";
      empty.appendChild(icon);
      empty.appendChild(document.createTextNode(EMPTY_PROMPTS[dow % EMPTY_PROMPTS.length]));
      tile.appendChild(empty);
    }

    var add = document.createElement("button");
    add.type = "button";
    add.className = "day__add";
    add.dataset.action = "add";
    add.textContent = "+ Add task";
    tile.appendChild(add);

    return tile;
  }

  function buildTask(task) {
    var li = document.createElement("li");
    li.className = "task" + (task.done ? " task--done" : "");
    li.dataset.id = task.id;

    var num = document.createElement("span");
    num.className = "task__num";
    num.setAttribute("aria-hidden", "true");

    var text = document.createElement("span");
    text.className = "task__text";
    text.dataset.action = "toggle";
    text.textContent = task.text;
    text.setAttribute("role", "checkbox");
    text.setAttribute("tabindex", "0");
    text.setAttribute("aria-checked", task.done ? "true" : "false");

    var del = document.createElement("button");
    del.type = "button";
    del.className = "task__del";
    del.dataset.action = "delete";
    del.setAttribute("aria-label", "Delete task: " + task.text);
    del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

    li.appendChild(num);
    li.appendChild(text);
    li.appendChild(del);
    return li;
  }

  /* ---------------- Mutations ---------------- */
  function touch(task) {
    task.updated = Date.now();
    task.dirty = true;
  }

  function commit() {
    save();
    render();
    scheduleSync();
  }

  function addTask(day, text) {
    var clean = text.trim();
    if (!clean) return false;

    var siblings = byDay()[day] || [];
    var last = siblings.length ? siblings[siblings.length - 1].position : -1;
    var id = newId();
    state.tasks[id] = {
      id: id,
      day: day,
      text: clean,
      done: false,
      position: last + 1,
      updated: Date.now(),
      deleted: false,
      dirty: true
    };
    commit();
    return true;
  }

  function toggleTask(id) {
    var task = state.tasks[id];
    if (!task) return;
    task.done = !task.done;
    touch(task);
    commit();
  }

  function deleteTask(id) {
    var task = state.tasks[id];
    if (!task) return;
    /* Kept as a tombstone so the deletion reaches the other devices. */
    task.deleted = true;
    touch(task);
    commit();
    toast("Task deleted");
  }

  /* ---------------- Sync ---------------- */
  function pending() {
    var out = [];
    Object.keys(state.tasks).forEach(function (id) {
      var task = state.tasks[id];
      if (!task.dirty) return;
      out.push({
        id: task.id,
        day: task.day,
        text: task.text,
        done: task.done ? 1 : 0,
        position: task.position,
        updated: task.updated,
        deleted: task.deleted ? 1 : 0
      });
    });
    return out;
  }

  function scheduleSync() {
    if (!sync.key) return;
    clearTimeout(sync.timer);
    sync.timer = setTimeout(syncNow, SYNC_DEBOUNCE);
  }

  function syncNow() {
    if (!sync.key || sync.inFlight) return;

    var push = pending();
    sync.inFlight = true;
    setPhase("syncing");

    fetch(SYNC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + sync.key
      },
      body: JSON.stringify({ since: state.lastSync, tasks: push })
    }).then(function (response) {
      if (response.status === 401) {
        setPhase("rejected");
        return null;
      }
      if (!response.ok) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          setPhase("error", data.error);
          return null;
        });
      }
      return response.json();
    }).then(function (data) {
      if (!data) return;

      /* Anything the server accepted is no longer a local-only change,
         unless it was edited again while the request was in flight. */
      push.forEach(function (sent) {
        var task = state.tasks[sent.id];
        if (task && task.updated === sent.updated) task.dirty = false;
      });

      var applied = merge(data.tasks || []);
      state.lastSync = data.now || state.lastSync;
      save();
      if (applied) render();
      setPhase("ok");
    }).catch(function () {
      setPhase("offline");
    }).then(function () {
      sync.inFlight = false;
    });
  }

  function merge(rows) {
    var changed = false;
    rows.forEach(function (row) {
      var local = state.tasks[row.id];
      if (local && local.updated >= row.updated) return; // ours is newer or identical
      state.tasks[row.id] = {
        id: row.id,
        day: row.day,
        text: row.text,
        done: !!row.done,
        position: row.position,
        updated: row.updated,
        deleted: !!row.deleted,
        dirty: false
      };
      changed = true;
    });
    return changed;
  }

  function setPhase(phase, detail) {
    sync.phase = phase;
    if (phase === "ok") sync.at = Date.now();
    renderSync(detail);
  }

  function renderSync(detail) {
    var label = "Sync off";
    var status = "Not connected. Tasks stay on this device.";

    if (sync.phase === "syncing") {
      label = "Syncing…";
      status = "Talking to the server.";
    } else if (sync.phase === "ok") {
      var time = new Date(sync.at);
      label = "Synced " + String(time.getHours()).padStart(2, "0") + ":" +
        String(time.getMinutes()).padStart(2, "0");
      status = "Up to date with the server.";
    } else if (sync.phase === "offline") {
      label = "Offline";
      status = "No connection. Changes are saved here and will go up on the next sync.";
    } else if (sync.phase === "rejected") {
      label = "Key rejected";
      status = "The server refused that sync key. Check it and connect again.";
    } else if (sync.phase === "error") {
      label = "Sync error";
      status = detail || "The server returned an error.";
    } else if (sync.key) {
      label = "Sync on";
      status = "Connected. Nothing synced yet.";
    }

    syncBtn.dataset.phase = sync.phase;
    syncLabel.textContent = label;
    syncStatus.textContent = status;
    syncKeyInput.value = sync.key;
    document.getElementById("syncOff").hidden = !sync.key;
  }

  function connect(key) {
    sync.key = key.trim();
    if (!sync.key) return;
    writeRaw(KEY_STORAGE, sync.key);
    /* A fresh key means a fresh conversation: push everything we hold. */
    Object.keys(state.tasks).forEach(function (id) { state.tasks[id].dirty = true; });
    state.lastSync = 0;
    save();
    setPhase("idle");
    syncNow();
  }

  function disconnect() {
    sync.key = "";
    try {
      localStorage.removeItem(KEY_STORAGE);
    } catch (err) { /* nothing to remove */ }
    setPhase("off");
    toast("Sync disconnected — tasks stay on this device");
  }

  /* ---------------- Sheet ---------------- */
  function openSheet(key) {
    var parts = key.split("-");
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var dow = date.getDay();

    activeKey = key;
    lastFocused = document.activeElement;

    sheet.style.setProperty("--accent", "var(--d" + dow + "-a)");
    sheet.style.setProperty("--accent-2", "var(--d" + dow + "-b)");
    sheetDate.textContent = relativeLabel(date) || WEEKDAY_LONG[dow];
    sheetTitle.textContent = MONTH_LONG[date.getMonth()] + " " + date.getDate();

    scrim.hidden = false;
    sheet.hidden = false;
    document.body.classList.add("sheet-open");
    taskInput.value = "";
    requestAnimationFrame(function () { taskInput.focus(); });
    document.addEventListener("keydown", onSheetKeydown);
  }

  function closeSheet() {
    scrim.hidden = true;
    sheet.hidden = true;
    document.body.classList.remove("sheet-open");
    activeKey = null;
    document.removeEventListener("keydown", onSheetKeydown);
    if (lastFocused && document.contains(lastFocused)) {
      lastFocused.focus();
    } else {
      var tile = board.querySelector(".day");
      if (tile) tile.focus();
    }
  }

  function onSheetKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSheet();
    }
  }

  /* ---------------- Toast ---------------- */
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("toast--show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("toast--show");
    }, 1900);
  }

  /* ---------------- Events ---------------- */
  board.addEventListener("click", function (event) {
    var tile = event.target.closest(".day");
    if (!tile) return;
    var actionEl = event.target.closest("[data-action]");
    var action = actionEl ? actionEl.dataset.action : null;

    if (action === "delete") {
      deleteTask(actionEl.closest(".task").dataset.id);
      return;
    }
    if (action === "toggle") {
      toggleTask(actionEl.closest(".task").dataset.id);
      return;
    }
    openSheet(tile.dataset.key);
  });

  board.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var target = event.target;

    if (target.classList.contains("task__text")) {
      event.preventDefault();
      toggleTask(target.closest(".task").dataset.id);
      return;
    }
    if (target.classList.contains("day")) {
      event.preventDefault();
      openSheet(target.dataset.key);
    }
  });

  taskForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!activeKey) return;
    var key = activeKey;
    if (addTask(key, taskInput.value)) {
      toast("Task added");
      taskInput.value = "";
      activeKey = key;
      taskInput.focus();
    }
  });

  scrim.addEventListener("click", closeSheet);
  document.getElementById("sheetClose").addEventListener("click", closeSheet);

  document.getElementById("prevWeek").addEventListener("click", function () {
    anchor = addDays(anchor, -DAYS_SHOWN);
    render();
  });

  document.getElementById("nextWeek").addEventListener("click", function () {
    anchor = addDays(anchor, DAYS_SHOWN);
    render();
  });

  document.getElementById("todayBtn").addEventListener("click", function () {
    anchor = startOfWeek(new Date());
    render();
  });

  document.getElementById("clearWeek").addEventListener("click", function () {
    var index = byDay();
    var doomed = [];
    for (var i = 0; i < DAYS_SHOWN; i++) {
      doomed = doomed.concat(index[keyOf(addDays(anchor, i))] || []);
    }
    if (!doomed.length) {
      toast("Nothing to clear");
      return;
    }
    if (!window.confirm("Delete every task shown this week?")) return;
    doomed.forEach(function (task) {
      task.deleted = true;
      touch(task);
    });
    commit();
    toast("Week cleared");
  });

  /* Sync panel */
  syncBtn.addEventListener("click", function () {
    var open = syncPanel.hidden;
    syncPanel.hidden = !open;
    syncBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) syncKeyInput.focus();
  });

  syncForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!syncKeyInput.value.trim()) return;
    connect(syncKeyInput.value);
    syncPanel.hidden = true;
    syncBtn.setAttribute("aria-expanded", "false");
  });

  document.getElementById("syncNow").addEventListener("click", function () {
    if (!sync.key) {
      toast("Add a sync key first");
      return;
    }
    syncNow();
  });

  document.getElementById("syncOff").addEventListener("click", function () {
    disconnect();
    syncPanel.hidden = true;
    syncBtn.setAttribute("aria-expanded", "false");
  });

  document.addEventListener("click", function (event) {
    if (syncPanel.hidden) return;
    if (syncPanel.contains(event.target) || syncBtn.contains(event.target)) return;
    syncPanel.hidden = true;
    syncBtn.setAttribute("aria-expanded", "false");
  });

  document.addEventListener("keydown", function (event) {
    if (!sheet.hidden) return;
    if (event.key === "Escape" && !syncPanel.hidden) {
      syncPanel.hidden = true;
      syncBtn.setAttribute("aria-expanded", "false");
      return;
    }
    var tag = document.activeElement ? document.activeElement.tagName : "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (event.key === "ArrowLeft") {
      anchor = addDays(anchor, -DAYS_SHOWN);
      render();
    } else if (event.key === "ArrowRight") {
      anchor = addDays(anchor, DAYS_SHOWN);
      render();
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    render();
    if (sync.key) syncNow();
  });

  window.addEventListener("online", function () {
    if (sync.key) syncNow();
  });

  setInterval(function () {
    if (sync.key && !document.hidden) syncNow();
  }, SYNC_INTERVAL);

  /* Offline support once the app is served over http(s). Opening index.html
     straight off disk has no service worker scope, so skip it there. */
  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {
        // Offline caching is a bonus; the app works fine without it.
      });
    });
  }

  render();
  renderSync();
  if (sync.key) syncNow();
})();
