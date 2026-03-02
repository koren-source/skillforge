import { spawnSync } from "node:child_process";

/**
 * Strip ANSI escape codes from CLI output
 */
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Check if Claude CLI is installed and authenticated
 * Runs a simple test prompt to verify everything works
 */
function checkClaudeCliAuth({ validate = false } = {}) {
  const result = {
    installed: false,
    authenticated: false,
    error: null,
    hint: null,
  };

  // First check if claude CLI exists
  const whichResult = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (whichResult.status !== 0) {
    result.error = "Claude CLI not found";
    result.hint = "Install from https://claude.ai/code then run: claude login";
    return result;
  }

  result.installed = true;

  if (!validate) {
    // Without validate flag, we just check if claude exists
    result.authenticated = null; // Unknown without testing
    return result;
  }

  // Test authentication with a simple prompt
  const testResult = spawnSync(
    "claude",

    ["-p", "respond with only the word READY", "--model", "sonnet"],
    {
      encoding: "utf8",
      timeout: 30000, // 30 second timeout
    }
  );

  if (testResult.error) {
    if (testResult.error.code === "ETIMEDOUT") {
      result.error = "Timeout waiting for Claude CLI";
      result.hint = "The request took too long. Check your network connection.";
    } else {
      result.error = `Claude CLI error: ${testResult.error.message}`;
    }
    return result;
  }

  if (testResult.status !== 0) {
    const stderr = stripAnsi(testResult.stderr || "").trim();
    const stderrLower = stderr.toLowerCase();

    if (stderrLower.includes("not logged in") || stderrLower.includes("login")) {
      result.error = "Not authenticated";
      result.hint = "Run: claude login";
    } else if (stderrLower.includes("rate limit") || stderrLower.includes("quota")) {
      // Rate limited but authenticated
      result.authenticated = true;
      result.error = "Rate limited";
      result.hint = "You're authenticated but rate limited. Wait and try again.";
    } else {
      result.error = stderr || "Unknown authentication error";
      result.hint = "Run: claude login";
    }
    return result;
  }

  const stdout = stripAnsi(testResult.stdout || "").trim();
  if (stdout.includes("READY")) {
    result.authenticated = true;
  } else {
    // Got output but not what we expected - still counts as working
    result.authenticated = true;
  }

  return result;
}

/**
 * Returns a user-friendly error message for missing/invalid auth
 */
function getAuthErrorMessage(authResult) {
  const lines = [];

  lines.push("SkillForge requires the Claude CLI to synthesize knowledge.");
  lines.push("");

  if (!authResult.installed) {
    lines.push("ISSUE: Claude CLI not found");
    lines.push("");
    lines.push("SETUP:");
    lines.push("  1. Install Claude Code from https://claude.ai/code");
    lines.push("  2. Run: claude login");
    lines.push("  3. Verify: skillforge check-auth");
  } else if (!authResult.authenticated) {
    lines.push(`ISSUE: ${authResult.error || "Not authenticated"}`);
    if (authResult.hint) {
      lines.push("");
      lines.push(`FIX: ${authResult.hint}`);
    }
  }

  return lines.join("\n");
}

// Legacy exports for backward compatibility (no-ops)
function isOAuthToken() {
  return false;
}

async function checkAuth(options = {}) {
  return checkClaudeCliAuth(options);
}

export {
  isOAuthToken,
  checkAuth,
  checkClaudeCliAuth,
  getAuthErrorMessage,
};
