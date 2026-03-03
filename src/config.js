import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const CONFIG_PATH = path.join(os.homedir(), ".skillforge", "config.json");

async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { trusted_creators: [] };
  }
}

async function saveConfig(config) {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
}

async function isTrusted(creator) {
  const config = await loadConfig();
  const normalized = creator.startsWith("@") ? creator : `@${creator}`;
  return config.trusted_creators.some(
    (c) => c.toLowerCase() === normalized.toLowerCase()
  );
}

async function addTrusted(creator) {
  const config = await loadConfig();
  const normalized = creator.startsWith("@") ? creator : `@${creator}`;
  if (!config.trusted_creators.some((c) => c.toLowerCase() === normalized.toLowerCase())) {
    config.trusted_creators.push(normalized);
    await saveConfig(config);
  }
  return normalized;
}

async function removeTrusted(creator) {
  const config = await loadConfig();
  const normalized = creator.startsWith("@") ? creator : `@${creator}`;
  const before = config.trusted_creators.length;
  config.trusted_creators = config.trusted_creators.filter(
    (c) => c.toLowerCase() !== normalized.toLowerCase()
  );
  if (config.trusted_creators.length < before) {
    await saveConfig(config);
    return true;
  }
  return false;
}

async function hasConsented() {
  const config = await loadConfig();
  return config.consented === true;
}

async function setConsented() {
  const config = await loadConfig();
  config.consented = true;
  await saveConfig(config);
}

export { loadConfig, saveConfig, isTrusted, addTrusted, removeTrusted, hasConsented, setConsented };
