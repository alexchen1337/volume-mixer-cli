const readline = require("node:readline");
const {
  clampVolume,
  getSystemVolumes,
  setSystemOutputVolume,
  setMicInputVolume,
  getControllableApps,
  getAppVolume,
  setAppVolume
} = require("./macos-audio");

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function hideCursor() {
  process.stdout.write("\x1b[?25l");
}

function showCursor() {
  process.stdout.write("\x1b[?25h");
}

function color(text, code) {
  return `\x1b[${code}m${text}\x1b[0m`;
}

function buildItems(options = {}) {
  const { allowAppFailure = false } = options;
  const sys = getSystemVolumes();
  const items = [
    {
      kind: "system-output",
      id: "system-output",
      label: "System Output",
      volume: sys.outputVolume
    },
    {
      kind: "mic-input",
      id: "mic-input",
      label: "Microphone Input",
      volume: sys.inputVolume
    }
  ];

  let appError = null;
  let apps = [];
  try {
    apps = getControllableApps();
  } catch (error) {
    appError = error instanceof Error ? error.message : String(error);
    if (!allowAppFailure) {
      throw error;
    }
  }

  return {
    items: items.concat(apps),
    appError
  };
}

function refreshItemVolume(item) {
  if (!item) {
    return;
  }

  if (item.kind === "system-output") {
    item.volume = getSystemVolumes().outputVolume;
  } else if (item.kind === "mic-input") {
    item.volume = getSystemVolumes().inputVolume;
  } else if (item.kind === "app") {
    const next = getAppVolume(item.label);
    if (next === null) {
      throw new Error(`"${item.label}" does not expose sound volume anymore.`);
    }

    item.volume = next;
  }
}

function progressBar(volume) {
  const total = 20;
  const filled = Math.round((volume / 100) * total);
  const left = "#".repeat(Math.max(0, Math.min(total, filled)));
  const right = "-".repeat(total - left.length);
  return `[${left}${right}]`;
}

function draw(state) {
  clearScreen();

  const header = color("volume-mixer-cli (macOS)", "1;36");
  const hint = "Up/Down select  Left/Right change  0-100 + Enter set  r refresh  q quit";
  process.stdout.write(`${header}\n${hint}\n\n`);

  if (state.items.length === 0) {
    process.stdout.write(
      `${color("No controllable apps found.", "33")} System and mic should still be available.\n\n`
    );
  }

  state.items.forEach((item, idx) => {
    const selected = idx === state.selectedIndex;
    const caret = selected ? color(">", "32") : " ";
    const line = `${caret} ${item.label.padEnd(24)} ${String(item.volume).padStart(3)}% ${progressBar(
      item.volume
    )}`;
    process.stdout.write(`${line}\n`);
  });

  process.stdout.write("\n");

  if (state.numericInput.length > 0) {
    process.stdout.write(`Set selected to: ${state.numericInput}\n`);
  } else {
    process.stdout.write("Set selected to: \n");
  }

  if (state.status) {
    const rendered =
      state.statusKind === "error" ? color(state.status, "31") : color(state.status, "90");
    process.stdout.write(`${rendered}\n`);
  } else {
    process.stdout.write("\n");
  }
}

function runCli() {
  if (process.argv.includes("--self-test")) {
    try {
      const result = buildItems({ allowAppFailure: true });
      const names = result.items.map((x) => `${x.label}:${x.volume}`).join(", ");
      process.stdout.write(`${names}\n`);
      if (result.appError) {
        process.stderr.write(`App volumes unavailable: ${result.appError}\n`);
      }
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (process.platform !== "darwin") {
    process.stderr.write("This CLI only supports macOS.\n");
    process.exitCode = 1;
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("This command must run in an interactive TTY.\n");
    process.exitCode = 1;
    return;
  }

  const state = {
    items: [],
    selectedIndex: 0,
    numericInput: "",
    status: "",
    statusKind: "info",
    arrowBurst: {
      name: "",
      lastAt: 0,
      burst: 0
    }
  };

  function setStatus(message, kind = "info") {
    state.status = message;
    state.statusKind = kind;
  }

  function selectedItem() {
    return state.items[state.selectedIndex] || null;
  }

  function loadItems() {
    const current = selectedItem();
    const currentId = current ? current.id : null;
    const result = buildItems({ allowAppFailure: true });
    state.items = result.items;

    if (state.items.length === 0) {
      state.selectedIndex = 0;
      return result.appError;
    }

    if (currentId) {
      const idx = state.items.findIndex((x) => x.id === currentId);
      if (idx >= 0) {
        state.selectedIndex = idx;
        return result.appError;
      }
    }

    state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, state.items.length - 1));
    return result.appError;
  }

  function adjustVolume(delta) {
    const item = selectedItem();
    if (!item) {
      return;
    }

    const next = clampVolume(item.volume + delta);
    if (next === item.volume) {
      return;
    }

    if (item.kind === "system-output") {
      item.volume = setSystemOutputVolume(next);
      return;
    }

    if (item.kind === "mic-input") {
      item.volume = setMicInputVolume(next);
      return;
    }

    if (item.kind === "app") {
      item.volume = setAppVolume(item.label, next);
    }
  }

  function setExactVolume(value) {
    const item = selectedItem();
    if (!item) {
      return;
    }

    const safe = clampVolume(value);
    if (item.kind === "system-output") {
      item.volume = setSystemOutputVolume(safe);
      return;
    }

    if (item.kind === "mic-input") {
      item.volume = setMicInputVolume(safe);
      return;
    }

    if (item.kind === "app") {
      item.volume = setAppVolume(item.label, safe);
    }
  }

  function accelStep(name) {
    const now = Date.now();
    if (state.arrowBurst.name === name && now - state.arrowBurst.lastAt < 140) {
      state.arrowBurst.burst += 1;
    } else {
      state.arrowBurst.burst = 0;
    }

    state.arrowBurst.name = name;
    state.arrowBurst.lastAt = now;

    if (state.arrowBurst.burst >= 16) {
      return 10;
    }

    if (state.arrowBurst.burst >= 8) {
      return 5;
    }

    if (state.arrowBurst.burst >= 3) {
      return 2;
    }

    return 1;
  }

  function teardown() {
    process.stdin.removeListener("keypress", onKeypress);
    process.stdin.setRawMode(false);
    showCursor();
    process.stdout.write("\n");
  }

  function quit() {
    teardown();
    process.exit(0);
  }

  function onKeypress(str, key) {
    try {
      if (key.ctrl && key.name === "c") {
        quit();
        return;
      }

      if (key.name === "q") {
        quit();
        return;
      }

      if (key.name === "up") {
        state.numericInput = "";
        if (state.items.length > 0) {
          state.selectedIndex =
            (state.selectedIndex - 1 + state.items.length) % state.items.length;
        }
        draw(state);
        return;
      }

      if (key.name === "down") {
        state.numericInput = "";
        if (state.items.length > 0) {
          state.selectedIndex = (state.selectedIndex + 1) % state.items.length;
        }
        draw(state);
        return;
      }

      if (key.name === "left" || key.name === "right") {
        state.numericInput = "";
        const sign = key.name === "right" ? 1 : -1;
        const step = accelStep(key.name);
        adjustVolume(sign * step);
        const item = selectedItem();
        if (item) {
          setStatus(`${item.label} -> ${item.volume}%`);
        }
        draw(state);
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        if (state.numericInput.length === 0) {
          draw(state);
          return;
        }

        const next = Number(state.numericInput);
        if (Number.isNaN(next) || next < 0 || next > 100) {
          setStatus("Enter a number from 0 to 100.", "error");
          state.numericInput = "";
          draw(state);
          return;
        }

        setExactVolume(next);
        const item = selectedItem();
        if (item) {
          setStatus(`${item.label} set to ${item.volume}%`);
        }
        state.numericInput = "";
        draw(state);
        return;
      }

      if (key.name === "backspace" || key.name === "delete") {
        state.numericInput = state.numericInput.slice(0, -1);
        draw(state);
        return;
      }

      if (key.name === "r") {
        state.numericInput = "";
        const appError = loadItems();
        if (appError) {
          setStatus(`App volumes unavailable: ${appError}`, "error");
        } else {
          setStatus("App list refreshed.");
        }
        draw(state);
        return;
      }

      if (str >= "0" && str <= "9") {
        if (state.numericInput.length < 3) {
          state.numericInput += str;
        }
        draw(state);
      }
    } catch (error) {
      const item = selectedItem();
      if (item) {
        try {
          refreshItemVolume(item);
        } catch (_ignored) {
          loadItems();
        }
      }

      setStatus(error instanceof Error ? error.message : String(error), "error");
      draw(state);
    }
  }

  try {
    const appError = loadItems();
    if (appError) {
      setStatus(`App volumes unavailable: ${appError}`, "error");
    } else {
      setStatus("Ready.");
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n` +
        "Make sure Terminal has Automation permissions for System Events.\n"
    );
    process.exitCode = 1;
    return;
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  hideCursor();
  draw(state);
  process.stdin.on("keypress", onKeypress);
}

module.exports = {
  runCli
};

if (require.main === module) {
  runCli();
}
