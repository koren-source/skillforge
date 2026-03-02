import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { listAll } from "./library.js";

const DB_DIR = path.join(os.homedir(), ".skillforge");
const DB_PATH = path.join(DB_DIR, "skills.db");

function ensureDb() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator TEXT NOT NULL,
      topic TEXT NOT NULL,
      slug TEXT NOT NULL,
      content TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      UNIQUE(creator, topic)
    )
  `);
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
      creator, topic, slug, content,
      content='skills',
      content_rowid='id'
    )
  `);
  // Triggers to keep FTS in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
      INSERT INTO skills_fts(rowid, creator, topic, slug, content)
        VALUES (new.id, new.creator, new.topic, new.slug, new.content);
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS skills_ad AFTER DELETE ON skills BEGIN
      INSERT INTO skills_fts(skills_fts, rowid, creator, topic, slug, content)
        VALUES ('delete', old.id, old.creator, old.topic, old.slug, old.content);
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
      INSERT INTO skills_fts(skills_fts, rowid, creator, topic, slug, content)
        VALUES ('delete', old.id, old.creator, old.topic, old.slug, old.content);
      INSERT INTO skills_fts(rowid, creator, topic, slug, content)
        VALUES (new.id, new.creator, new.topic, new.slug, new.content);
    END
  `);
  return db;
}

function indexSkill(db, creator, topic, slug, content) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO skills (creator, topic, slug, content, indexed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(creator, topic) DO UPDATE SET
      slug = excluded.slug,
      content = excluded.content,
      indexed_at = excluded.indexed_at
  `);
  stmt.run(creator, topic, slug, content, now);
}

async function rebuildIndex(db) {
  const allSkills = await listAll();

  // Get existing indexed_at timestamps to skip unchanged files
  const existing = new Map();
  try {
    const rows = db.prepare("SELECT creator, topic, indexed_at FROM skills").all();
    for (const row of rows) {
      existing.set(`${row.creator}/${row.topic}`, row.indexed_at);
    }
  } catch {
    // Table may be empty on first run
  }

  // Track which skills still exist on disk (for pruning deleted ones)
  const currentKeys = new Set();
  let updated = 0;

  const upsert = db.transaction((skills) => {
    for (const skill of skills) {
      const key = `${skill.creator}/${skill.topic}`;
      currentKeys.add(key);

      // Check file modification time against last indexed time
      let stat;
      try {
        stat = fs.statSync(skill.path);
      } catch {
        continue;
      }

      const lastIndexed = existing.get(key);
      if (lastIndexed && new Date(lastIndexed).getTime() >= stat.mtimeMs) {
        continue; // File hasn't changed since last index
      }

      let content = "";
      try {
        content = fs.readFileSync(skill.path, "utf8");
      } catch {
        continue;
      }
      indexSkill(db, skill.creator, skill.topic, skill.topic, content);
      updated++;
    }

    // Remove skills that no longer exist on disk
    for (const key of existing.keys()) {
      if (!currentKeys.has(key)) {
        const [creator, topic] = key.split("/");
        db.prepare("DELETE FROM skills WHERE creator = ? AND topic = ?").run(creator, topic);
      }
    }
  });

  upsert(allSkills);
  if (updated > 0) {
    process.stderr.write(`[skillforge] Updated ${updated} skill(s) in index\n`);
  }
  return allSkills.length;
}

function searchSkills(db, query, limit = 10) {
  // Tokenize and create FTS5 match query
  const tokens = String(query || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

  if (tokens.length === 0) {
    // Return all skills
    return db.prepare("SELECT creator, topic, slug FROM skills ORDER BY indexed_at DESC LIMIT ?").all(limit);
  }

  const ftsQuery = tokens.map((t) => `"${t}"*`).join(" OR ");
  try {
    const rows = db.prepare(`
      SELECT s.creator, s.topic, s.slug,
             snippet(skills_fts, 3, '>>>', '<<<', '...', 40) as snippet
      FROM skills_fts f
      JOIN skills s ON s.id = f.rowid
      WHERE skills_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit);
    return rows;
  } catch {
    // Fallback to LIKE search
    const likeClauses = tokens.map(() => "content LIKE ?").join(" OR ");
    const likeParams = tokens.map((t) => `%${t}%`);
    return db.prepare(`
      SELECT creator, topic, slug
      FROM skills WHERE ${likeClauses}
      ORDER BY indexed_at DESC LIMIT ?
    `).all(...likeParams, limit);
  }
}

function readSkillContent(db, creator, topic) {
  const row = db.prepare("SELECT content FROM skills WHERE creator = ? AND topic = ?").get(creator, topic);
  return row ? row.content : null;
}

async function startServer() {
  const db = ensureDb();

  // Rebuild index on startup
  const count = await rebuildIndex(db);
  process.stderr.write(`[skillforge] Indexed ${count} skill(s) into SQLite\n`);

  const server = new Server(
    { name: "skillforge", version: "4.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "skillforge_recall",
        description:
          "Search the SkillForge library for agent-ready skills by intent, topic, or keyword. Returns matching skill documents synthesized from YouTube content.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Intent or topic to search for (e.g., 'meta ads scaling', 'cold email outreach')",
            },
            limit: {
              type: "number",
              description: "Maximum results to return (default: 5)",
            },
            full: {
              type: "boolean",
              description: "If true, return full skill content instead of snippets (default: false)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "skillforge_list",
        description: "List all skills in the SkillForge library, grouped by creator.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "skillforge_recall") {
      const query = args?.query || "";
      const limit = args?.limit || 5;
      const full = args?.full || false;
      const results = searchSkills(db, query, limit);

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No skills found for: "${query}"` }],
        };
      }

      if (full) {
        const fullResults = results.map((r) => {
          const content = readSkillContent(db, r.creator, r.topic);
          return `## ${r.creator}/${r.topic}\n\n${content || "(content unavailable)"}`;
        });
        return {
          content: [{ type: "text", text: fullResults.join("\n\n---\n\n") }],
        };
      }

      const summary = results.map((r) => {
        const parts = [`- **${r.creator}/${r.topic}**`];
        if (r.snippet) parts.push(`  ${r.snippet}`);
        return parts.join("\n");
      });
      return {
        content: [{ type: "text", text: `Found ${results.length} skill(s):\n\n${summary.join("\n")}` }],
      };
    }

    if (name === "skillforge_list") {
      const all = db.prepare("SELECT creator, topic, slug, indexed_at FROM skills ORDER BY creator, topic").all();
      if (all.length === 0) {
        return {
          content: [{ type: "text", text: "No skills in the library yet." }],
        };
      }

      const grouped = {};
      for (const row of all) {
        if (!grouped[row.creator]) grouped[row.creator] = [];
        grouped[row.creator].push(row.topic);
      }

      const lines = Object.entries(grouped).map(
        ([creator, topics]) => `**@${creator}**: ${topics.join(", ")}`
      );
      return {
        content: [{ type: "text", text: `${all.length} skill(s) in library:\n\n${lines.join("\n")}` }],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[skillforge] MCP server running on stdio\n");
}

export { startServer, ensureDb, rebuildIndex, searchSkills };
