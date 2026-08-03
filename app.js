/* ---------------------------------------------------------------
   Prism — a colorful week calendar with per-day task lists.
   No dependencies, no build step. State lives in localStorage.
   --------------------------------------------------------------- */
(function () {
  "use strict";

  var STORAGE_KEY = "prism.calendar.v1";
  var DAYS_SHOWN = 7;
  var WEEK_STARTS_ON = 1; // 0 = Sunday, 1 = Monday

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

  /* ---------------- State ---------------- */
  var store = load();
  var anchor = startOfWeek(new Date());   // first day currently displayed
  var activeKey = null;                   // day key the sheet is editing
  var lastFocused = null;
  var toastTimer = null;

  /* ---------------- Persistence ---------------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (err) {
      toast("Couldn't save — storage is unavailable");
    }
  }

  function tasksFor(key) {
    return store[key] || [];
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

  /* ---------------- Rendering ---------------- */
  function render() {
    board.textContent = "";
    var frag = document.createDocumentFragment();
    var total = 0;
    var done = 0;

    for (var i = 0; i < DAYS_SHOWN; i++) {
      var date = addDays(anchor, i);
      var tasks = tasksFor(keyOf(date));
      total += tasks.length;
      for (var t = 0; t < tasks.length; t++) {
        if (tasks[t].done) done++;
      }
      var tile = buildTile(date, i);
      frag.appendChild(tile);
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

  function buildTile(date, index) {
    var key = keyOf(date);
    var tasks = tasksFor(key);
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

    /* Header */
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

    /* Numbered task list */
    if (tasks.length) {
      var list = document.createElement("ol");
      list.className = "day__tasks";
      for (var i = 0; i < tasks.length; i++) {
        list.appendChild(buildTask(key, tasks[i]));
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

    /* Add button */
    var add = document.createElement("button");
    add.type = "button";
    add.className = "day__add";
    add.dataset.action = "add";
    add.textContent = "+ Add task";
    tile.appendChild(add);

    return tile;
  }

  function buildTask(key, task) {
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
  function addTask(key, text) {
    var clean = text.trim();
    if (!clean) return false;
    if (!store[key]) store[key] = [];
    store[key].push({
      id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text: clean,
      done: false
    });
    save();
    render();
    return true;
  }

  function toggleTask(key, id) {
    var tasks = tasksFor(key);
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id) {
        tasks[i].done = !tasks[i].done;
        break;
      }
    }
    save();
    render();
  }

  function deleteTask(key, id) {
    var tasks = tasksFor(key);
    store[key] = tasks.filter(function (t) { return t.id !== id; });
    if (!store[key].length) delete store[key];
    save();
    render();
    toast("Task deleted");
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
    // Delay focus a frame so the sheet animation and iOS keyboard play nicely.
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
    var key = tile.dataset.key;
    var actionEl = event.target.closest("[data-action]");
    var action = actionEl ? actionEl.dataset.action : null;

    if (action === "delete") {
      deleteTask(key, actionEl.closest(".task").dataset.id);
      return;
    }
    if (action === "toggle") {
      toggleTask(key, actionEl.closest(".task").dataset.id);
      return;
    }
    // Anywhere else on the tile (including "+ Add task") opens the composer.
    openSheet(key);
  });

  board.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var target = event.target;

    if (target.classList.contains("task__text")) {
      event.preventDefault();
      toggleTask(target.closest(".day").dataset.key, target.closest(".task").dataset.id);
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
      // Keep the sheet open so several tasks can be added in a row.
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
    var touched = false;
    for (var i = 0; i < DAYS_SHOWN; i++) {
      var key = keyOf(addDays(anchor, i));
      if (store[key]) { touched = true; break; }
    }
    if (!touched) {
      toast("Nothing to clear");
      return;
    }
    if (!window.confirm("Delete every task shown this week?")) return;
    for (var j = 0; j < DAYS_SHOWN; j++) {
      delete store[keyOf(addDays(anchor, j))];
    }
    save();
    render();
    toast("Week cleared");
  });

  // Arrow keys page through weeks when nothing is being typed.
  document.addEventListener("keydown", function (event) {
    if (!sheet.hidden) return;
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

  // Keep "today" correct if the tab is left open across midnight.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) render();
  });

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
})();
