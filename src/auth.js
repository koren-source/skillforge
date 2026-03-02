import process from "node:process";

/**
 * Detects if a key looks like a Claude OAuth token vs standard API key
 */
function isOAuthToken(key) {
  // OAuth tokens: sk-ant-oat01-...
  // Standard API keys: sk-ant-api03-...
  return key && key.startsWith("sk-ant-oat01-");
}

/**
 * Validates Anthropic API key format and attempts a lightweight API call
 */
async function validateAnthropicKey(key) {
  if (!key) {
    return { valid: false, error: "No key provided" };
  }

  if (isOAuthToken(key)) {
    return {
      valid: false,
      error: "OAuth token detected",
      isOAuthToken: true,
      hint:
        "You're using a Claude.ai OAuth token (sk-ant-oat01-...). " +
        "SkillForge needs a standard API key (sk-ant-api03-...) from console.anthropic.com",
    };
  }

  // Check format
  if (!key.startsWith("sk-ant-")) {
    return {
      valid: false,
      error: "Invalid key format",
      hint: "Anthropic API keys should start with 'sk-ant-api03-'",
    };
  }

  // Try a minimal API call to validate
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    if (response.ok) {
      return { valid: true };
    }

    const body = await response.json().catch(() => ({}));
    const errorType = body?.error?.type || "unknown";
    const errorMsg = body?.error?.message || response.statusText;

    if (response.status === 401) {
      return {
        valid: false,
        error: "Authentication failed",
        hint: `Invalid API key. Get a key from console.anthropic.com (${errorMsg})`,
      };
    }

    if (response.status === 400 && errorMsg.includes("credit")) {
      // Key is valid but no credits - that's still a valid key
      return { valid: true, warning: "Key is valid but account may have no credits" };
    }

    return {
      valid: false,
      error: `API error: ${errorType}`,
      hint: errorMsg,
    };
  } catch (err) {
    return {
      valid: false,
      error: "Network error",
      hint: `Could not reach Anthropic API: ${err.message}`,
    };
  }
}

/**
 * Validates OpenAI API key
 */
async function validateOpenAIKey(key) {
  if (!key) {
    return { valid: false, error: "No key provided" };
  }

  if (!key.startsWith("sk-")) {
    return {
      valid: false,
      error: "Invalid key format",
      hint: "OpenAI API keys should start with 'sk-'",
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });

    if (response.ok) {
      return { valid: true };
    }

    const body = await response.json().catch(() => ({}));
    const errorMsg = body?.error?.message || response.statusText;

    if (response.status === 401) {
      return {
        valid: false,
        error: "Authentication failed",
        hint: `Invalid API key. Get a key from platform.openai.com (${errorMsg})`,
      };
    }

    return {
      valid: false,
      error: `API error: ${response.status}`,
      hint: errorMsg,
    };
  } catch (err) {
    return {
      valid: false,
      error: "Network error",
      hint: `Could not reach OpenAI API: ${err.message}`,
    };
  }
}

/**
 * Checks environment for valid API keys
 */
async function checkAuth({ validate = false } = {}) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const openaiBase = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE;

  const result = {
    hasAnyKey: false,
    anthropic: { set: false, valid: null, error: null, hint: null },
    openai: { set: false, valid: null, error: null, hint: null },
    proxy: { configured: !!openaiBase, baseUrl: openaiBase || null },
  };

  if (anthropicKey) {
    result.anthropic.set = true;
    result.hasAnyKey = true;

    if (isOAuthToken(anthropicKey)) {
      result.anthropic.valid = false;
      result.anthropic.isOAuthToken = true;
      result.anthropic.error = "OAuth token (not supported)";
      result.anthropic.hint =
        "Claude.ai OAuth tokens (sk-ant-oat01-...) don't work with the Anthropic API. " +
        "Get a standard API key from console.anthropic.com";
    } else if (validate) {
      const validation = await validateAnthropicKey(anthropicKey);
      result.anthropic.valid = validation.valid;
      result.anthropic.error = validation.error;
      result.anthropic.hint = validation.hint;
      result.anthropic.warning = validation.warning;
    }
  }

  if (openaiKey) {
    result.openai.set = true;
    result.hasAnyKey = true;

    if (validate && !openaiBase) {
      const validation = await validateOpenAIKey(openaiKey);
      result.openai.valid = validation.valid;
      result.openai.error = validation.error;
      result.openai.hint = validation.hint;
    } else if (openaiBase) {
      // Can't validate custom endpoints without knowing their API
      result.openai.valid = null;
      result.openai.hint = `Using custom endpoint: ${openaiBase}`;
    }
  }

  return result;
}

/**
 * Returns a user-friendly error message for missing/invalid auth
 */
function getAuthErrorMessage(authResult) {
  const lines = [];

  lines.push("SkillForge needs an AI API key to synthesize knowledge.");
  lines.push("");

  if (authResult.anthropic.isOAuthToken) {
    lines.push("ISSUE: You're using a Claude.ai OAuth token (sk-ant-oat01-...)");
    lines.push("These tokens are for claude.ai web access, NOT the Anthropic API.");
    lines.push("");
  }

  lines.push("SETUP OPTIONS:");
  lines.push("");
  lines.push("  Option 1: Anthropic API Key (recommended)");
  lines.push("    1. Go to console.anthropic.com");
  lines.push("    2. Create an API key (starts with sk-ant-api03-)");
  lines.push("    3. export ANTHROPIC_API_KEY=sk-ant-api03-...");
  lines.push("");
  lines.push("  Option 2: OpenAI API Key");
  lines.push("    1. Go to platform.openai.com");
  lines.push("    2. Create an API key");
  lines.push("    3. export OPENAI_API_KEY=sk-...");
  lines.push("    4. Use --model gpt-4o-mini (or another OpenAI model)");
  lines.push("");
  lines.push("  Option 3: OpenAI-compatible proxy (LiteLLM, Ollama, etc.)");
  lines.push("    1. Set OPENAI_BASE_URL to your proxy endpoint");
  lines.push("    2. Set OPENAI_API_KEY (even if just a placeholder)");
  lines.push("    3. Use --model with your proxy's model name");
  lines.push("");
  lines.push("Run `skillforge check-auth` to verify your setup.");

  return lines.join("\n");
}

export {
  isOAuthToken,
  validateAnthropicKey,
  validateOpenAIKey,
  checkAuth,
  getAuthErrorMessage,
};
