const terminal = document.getElementById("terminal-output");

const demoLines = [
  { text: "skillforge watch https://youtube.com/@alexhormozi", type: "command" },
  { text: "Fetching transcript from @AlexHormozi...", type: "output" },
  { text: "Creator detected: @AlexHormozi", type: "output" },
  { text: "Proposed skill: sales-funnel-and-closing-framework", type: "output" },
  { text: "Preview:", type: "output" },
  { text: "  when_to_use: Drafting funnel strategy", type: "output" },
  { text: "  frameworks: value-stack, urgency, proof", type: "output" },
  { text: "  instructions: Lead with value-stack...", type: "output" },
  { text: "Save to ~/.skillforge/library/@alexhormozi/? [y/N]", type: "output" },
  { text: "y", type: "command" },
  { text: "~/.skillforge/library/@alexhormozi/sales-funnel-and-closing-framework/", type: "output" },
  { text: "└── SKILL.md", type: "output" },
  { text: "skillforge recall \"sales funnel\"", type: "command" },
  { text: "Found: @alexhormozi/sales-funnel-and-closing-framework", type: "output" },
  { text: "Skill loaded. Your agent is ready.", type: "output" }
];

const delays = {
  character: 24,
  line: 440,
  loop: 1800
};

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

function render(text) {
  terminal.innerHTML = `${text}<span class="cursor" aria-hidden="true"></span>`;
}

async function typeLine(currentText, line) {
  const prefix = line.type === "command" ? "$ " : "";
  for (const char of `${prefix}${line.text}`) {
    currentText += char;
    render(currentText);
    await sleep(delays.character);
  }

  currentText += "\n";
  render(currentText);
  await sleep(delays.line);
  terminal.scrollTop = terminal.scrollHeight;
  return currentText;
}

async function runDemo() {
  while (true) {
    let currentText = "";
    render(currentText);

    for (const line of demoLines) {
      currentText = await typeLine(currentText, line);
    }

    await sleep(delays.loop);

    for (let i = currentText.length; i >= 0; i -= 3) {
      render(currentText.slice(0, i));
      await sleep(10);
    }

    await sleep(300);
  }
}

runDemo();
