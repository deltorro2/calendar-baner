/* Prism sync endpoint — a Worker running on the Pages origin.
 *
 * One route does the whole job: the client posts the tasks it has changed
 * since its last successful sync and the cursor it got back then; the reply
 * carries everything the server has seen since that cursor. Merging is
 * last-write-wins per task id, using the client's `updated` timestamp.
 *
 * Bindings: DB (D1 database), SYNC_KEY (secret).
 */

var MAX_PUSH = 500;    // tasks accepted per request
var MAX_PULL = 5000;   // rows returned per request
var MAX_TITLE = 500;   // characters
var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
var SKEW_MS = 5 * 60 * 1000;

export async function onRequestPost(context) {
  var request = context.request;
  var env = context.env;

  var denied = check(request, env);
  if (denied) return denied;

  var body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "Body must be JSON" }, 400);
  }

  var since = Number(body.since) || 0;
  var incoming = Array.isArray(body.tasks) ? body.tasks : [];
  if (incoming.length > MAX_PUSH) {
    return json({ error: "Too many tasks in one request (max " + MAX_PUSH + ")" }, 413);
  }

  var clean = [];
  for (var i = 0; i < incoming.length; i++) {
    var task = validate(incoming[i]);
    if (task.error) return json({ error: "Task " + i + ": " + task.error }, 400);
    clean.push(task.value);
  }

  if (clean.length) {
    var upsert = env.DB.prepare(
      "INSERT INTO tasks (id, day, title, done, position, updated, deleted) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) " +
      "ON CONFLICT(id) DO UPDATE SET " +
      "  day = excluded.day, title = excluded.title, done = excluded.done, " +
      "  position = excluded.position, updated = excluded.updated, deleted = excluded.deleted " +
      "WHERE excluded.updated > tasks.updated"
    );
    await env.DB.batch(clean.map(function (t) {
      return upsert.bind(t.id, t.day, t.title, t.done, t.position, t.updated, t.deleted);
    }));
  }

  var changed = await env.DB
    .prepare("SELECT id, day, title, done, position, updated, deleted FROM tasks " +
             "WHERE updated > ?1 ORDER BY updated LIMIT ?2")
    .bind(since, MAX_PULL)
    .all();

  return json({
    now: Date.now(),
    tasks: (changed.results || []).map(toClient)
  });
}

/* A signed-in client can check the connection without changing anything. */
export async function onRequestGet(context) {
  var denied = check(context.request, context.env);
  if (denied) return denied;

  var row = await context.env.DB
    .prepare("SELECT COUNT(*) AS total FROM tasks WHERE deleted = 0")
    .first();

  return json({ ok: true, tasks: row ? row.total : 0, now: Date.now() });
}

function check(request, env) {
  if (!env.SYNC_KEY) {
    return json({ error: "This deployment has no SYNC_KEY secret set" }, 503);
  }
  if (!env.DB) {
    return json({ error: "This deployment has no D1 database bound as DB" }, 503);
  }
  var header = request.headers.get("authorization") || "";
  var offered = header.replace(/^Bearer\s+/i, "");
  if (!sameSecret(offered, env.SYNC_KEY)) {
    return json({ error: "Sync key rejected" }, 401);
  }
  return null;
}

/* Compare without leaking length or position through timing. */
function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function validate(raw) {
  if (!raw || typeof raw !== "object") return { error: "not an object" };

  var id = raw.id;
  if (typeof id !== "string" || !id || id.length > 64) return { error: "bad id" };

  var day = raw.day;
  if (typeof day !== "string" || !DAY_RE.test(day)) return { error: "bad day" };

  var title = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!title || title.length > MAX_TITLE) return { error: "bad text" };

  var updated = Number(raw.updated);
  if (!isFinite(updated) || updated <= 0 || updated > Date.now() + SKEW_MS) {
    return { error: "bad updated timestamp" };
  }

  return {
    value: {
      id: id,
      day: day,
      title: title,
      done: raw.done ? 1 : 0,
      position: Number(raw.position) || 0,
      updated: Math.round(updated),
      deleted: raw.deleted ? 1 : 0
    }
  };
}

function toClient(row) {
  return {
    id: row.id,
    day: row.day,
    text: row.title,
    done: row.done ? 1 : 0,
    position: row.position,
    updated: row.updated,
    deleted: row.deleted ? 1 : 0
  };
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
