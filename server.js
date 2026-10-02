// Skin Decode server
// Serves the website, AI chat, and simple SQLite showcase database.
const http = require("http");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
// ---------------- DATABASE ----------------
const dbPath = path.join(__dirname, "skin-decode.db");
const db = new Database(dbPath);
console.log("DATABASE API VERSION: 2";
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT
  );
  CREATE TABLE IF NOT EXISTS skin_scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    skin_type TEXT,
    concern TEXT,
    sensitivity TEXT
  );
  CREATE TABLE IF NOT EXISTS saved_routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    routine_name TEXT
  );
`);
// Demo data for showcasing the database.
// Only inserted when the database is empty.
const userCount = db
  .prepare("SELECT COUNT(*) AS count FROM users")
  .get();
if (userCount.count === 0) {
  const insertUser = db.prepare(`
    INSERT INTO users (name, email)
    VALUES (?, ?)
  `);
  const user = insertUser.run(
    "Demo User",
    "demo@skindecode.com"
  );
  db.prepare(`
    INSERT INTO skin_scans
    (user_id, skin_type, concern, sensitivity)
    VALUES (?, ?, ?, ?)
  `).run(
    user.lastInsertRowid,
    "Combination",
    "Acne & pores",
    "Moderate"
  );
  db.prepare(`
    INSERT INTO saved_routines
    (user_id, routine_name)
    VALUES (?, ?)
  `).run(
    user.lastInsertRowid,
    "Morning Glow Routine"
  );
}
// ---------------- ENVIRONMENT ----------------
try {
  const envPath = path.join(__dirname, ".env");
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .forEach(line => {
      const match = line.match(
        /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/
      );
      if (match && !process.env[match[1]]) {
        process.env[match[1]] =
          match[2].replace(/^["']|["']$/g, "");
      }
    });
} catch {
  // .env is optional
}
const PORT = process.env.PORT || 3000;
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL =
  process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
// ---------------- AI SYSTEM ----------------
const SYSTEM = `
You are Skin AI, the skincare assistant on the Skin Decode website.
Tagline: "Because your skin deserves better."
You help customers with:
1. Product suggestions
2. Morning or night routines
3. Information about skincare products or ingredients
Style:
- Warm, clear and concise
- Under 180 words unless a routine is requested
- Use short bullet lists with "- "
- Bold key names with **double asterisks**
- Ask one short follow-up question when skin type or concern is missing
Brands:
Korean:
COSRX, Beauty of Joseon, Anua, Skin1004, Laneige,
Isntree, Round Lab, Some By Mi, Innisfree.
Indian:
Minimalist, The Derma Co, Dot & Key, Plum,
Re'equil, Dr. Sheth's, Foxtale, Aqualogica.
When the customer names a product type such as cleanser,
toner, serum, essence, moisturiser or sunscreen,
give 2 to 3 suitable picks.
Rules:
- Never invent products, prices or claims.
- Recommend patch testing.
- Recommend sunscreen every morning.
- Introduce one new active at a time.
- Warn about retinol and strong acids in pregnancy.
- For severe, painful, spreading or persistent skin problems,
  advise seeing a dermatologist.
- You are not a doctor and never diagnose.
- Stay on skincare topics.
`;
// ---------------- RATE LIMIT ----------------
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || [])
    .filter(time => now - time < 60000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 20;
}
// ---------------- HELPERS ----------------
const send = (res, code, obj) => {
  res.writeHead(code, {
    "Content-Type": "application/json"
  });
  res.end(JSON.stringify(obj));
};
const clip = (value, length) =>
  String(value == null ? "" : value)
    .replace(/[\r\n]+/g, " ")
    .slice(0, length);
// ---------------- AI CHAT ----------------
async function chat(req, res) {
  if (!KEY) {
    return send(res, 503, {
      error: "no_key"
    });
  }
  if (limited(req.socket.remoteAddress)) {
    return send(res, 429, {
      error: "slow_down"
    });
  }
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20000) {
      return send(res, 413, {
        error: "too_large"
      });
    }
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return send(res, 400, {
      error: "bad_json"
    });
  }
  let messages =
    Array.isArray(data.messages)
      ? data.messages
      : [];
  messages = messages
    .filter(
      message =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string" &&
        message.content.trim()
    )
    .slice(-12)
    .map(message => ({
      role: message.role,
      content: message.content.slice(0, 1500)
    }));
  while (
    messages.length &&
    messages[0].role !== "user"
  ) {
    messages.shift();
  }
  if (
    !messages.length ||
    messages[messages.length - 1].role !== "user"
  ) {
    return send(res, 400, {
      error: "no_message"
    });
  }
  const profile =
    data.profile &&
    typeof data.profile === "object"
      ? data.profile
      : null;
  const system =
    SYSTEM +
    (
      profile
        ? `
Customer's saved Skin Scan:
skin type ${clip(profile.type, 30)},
main concern ${clip(profile.concern, 30)},
sensitivity ${clip(profile.sens, 30)}.
Use it unless they say otherwise.
`
        : ""
    );
  try {
    const response = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 800,
          system,
          messages
        })
      }
    );
    const json = await response.json();
    if (!response.ok) {
      console.error(
        "Anthropic error",
        response.status,
        json &&
        json.error &&
        json.error.message
      );
      return send(res, 502, {
        error: "upstream"
      });
    }
    const reply = (json.content || [])
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("\n")
      .trim();
    send(res, 200, {
      reply
    });
  } catch (error) {
    console.error(error.message);
    send(res, 502, {
      error: "upstream"
    });
  }
}
// ---------------- WEBSITE ----------------
const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};
function serve(req, res) {
  let requestedPath =
    decodeURIComponent(
      req.url.split("?")[0]
    );
  if (requestedPath === "/") {
    requestedPath = "/index.html";
  }
  const filePath = path.join(
    __dirname,
    path.normalize(requestedPath)
  );
  const extension =
    path.extname(filePath).toLowerCase();
  const safe =
    filePath.startsWith(__dirname + path.sep) &&
    TYPES[extension];
  if (!safe) {
    return send(res, 404, {
      error: "not_found"
    });
  }
  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      return send(res, 404, {
        error: "not_found"
      });
    }
    res.writeHead(200, {
      "Content-Type": TYPES[extension]
    });
    res.end(buffer);
  });
}
// ---------------- SERVER ----------------
http
  .createServer((req, res) => {
    // AI chat
    if (
      req.method === "POST" &&
      req.url === "/api/chat"
    ) {
      return chat(req, res);
    }
    // AI status
    if (
      req.method === "GET" &&
      req.url === "/api/status"
    ) {
      return send(res, 200, {
        ai: !!KEY
      });
    }
    // DATABASE SHOWCASE
    if (
      req.method === "GET" &&
      req.url === "/api/database"
    ) {
      try {
        return send(res, 200, {
          users: db
            .prepare("SELECT * FROM users")
            .all(),
          skin_scans: db
            .prepare("SELECT * FROM skin_scans")
            .all(),
          saved_routines: db
            .prepare("SELECT * FROM saved_routines")
            .all()
        });
      } catch (error) {
        console.error(
          "Database API error:",
          error.message
        );
        return send(res, 500, {
          error: "database_error"
        });
      }
    }
    // Website
    if (req.method === "GET") {
      return serve(req, res);
    }
    send(res, 405, {
      error: "method"
    });
  })
  .listen(PORT, () => {
    console.log(
      `Skin Decode on http://localhost:${PORT} | AI: ${
        KEY
          ? "on (" + MODEL + ")"
          : "OFF, set ANTHROPIC_API_KEY"
      }`
    );
  });
