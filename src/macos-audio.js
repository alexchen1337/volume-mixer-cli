const { execFileSync } = require("node:child_process");

function ensureMacOS() {
  if (process.platform !== "darwin") {
    throw new Error("This CLI only works on macOS.");
  }
}

function runAppleScript(script, args = []) {
  const cmdArgs = ["-e", script];
  if (args.length > 0) {
    cmdArgs.push("--", ...args);
  }

  try {
    return execFileSync("osascript", cmdArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 4000
    }).trim();
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ETIMEDOUT") {
      throw new Error(
        "AppleScript request timed out. Grant Automation permission for Terminal in System Settings."
      );
    }

    const stderr = error && typeof error === "object" ? String(error.stderr || "").trim() : "";
    throw new Error(stderr || "Failed to run AppleScript command.");
  }
}

function parseVolumeSettings(raw) {
  const output = /output volume:(\d+)/i.exec(raw);
  const input = /input volume:(\d+)/i.exec(raw);
  const muted = /output muted:(true|false)/i.exec(raw);

  return {
    outputVolume: output ? Number(output[1]) : 0,
    inputVolume: input ? Number(input[1]) : 0,
    outputMuted: muted ? muted[1].toLowerCase() === "true" : false
  };
}

function clampVolume(value) {
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new Error("Invalid volume value.");
  }

  return Math.max(0, Math.min(100, Math.round(n)));
}

function getSystemVolumes() {
  ensureMacOS();
  const raw = runAppleScript("get volume settings");
  return parseVolumeSettings(raw);
}

function setSystemOutputVolume(volume) {
  ensureMacOS();
  const safe = clampVolume(volume);
  runAppleScript(`set volume output volume ${safe}`);
  return safe;
}

function setMicInputVolume(volume) {
  ensureMacOS();
  const safe = clampVolume(volume);
  runAppleScript(`set volume input volume ${safe}`);
  return safe;
}

function getUserApps() {
  ensureMacOS();
  const script = `
tell application "System Events"
  set appNames to name of every application process whose background only is false
end tell
set text item delimiters to linefeed
return appNames as text
`;
  const raw = runAppleScript(script);

  return raw
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function getAppVolume(appName) {
  ensureMacOS();
  const script = `
on run argv
  set targetApp to item 1 of argv
  try
    tell application targetApp to return (sound volume as integer)
  on error
    return "__UNSUPPORTED__"
  end try
end run
`;
  const raw = runAppleScript(script, [appName]);

  if (raw === "__UNSUPPORTED__") {
    return null;
  }

  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function setAppVolume(appName, volume) {
  ensureMacOS();
  const safe = clampVolume(volume);
  const script = `
on run argv
  set targetApp to item 1 of argv
  set targetVolume to item 2 of argv as integer
  tell application targetApp to set sound volume to targetVolume
  return targetVolume
end run
`;

  const raw = runAppleScript(script, [appName, String(safe)]);
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    return safe;
  }

  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function getControllableApps() {
  const names = getUserApps();
  const uniqueSorted = Array.from(new Set(names)).sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" })
  );

  const items = [];
  for (const name of uniqueSorted) {
    const volume = getAppVolume(name);
    if (volume === null) {
      continue;
    }

    items.push({
      kind: "app",
      id: `app:${name}`,
      label: name,
      volume
    });
  }

  return items;
}

module.exports = {
  clampVolume,
  getSystemVolumes,
  setSystemOutputVolume,
  setMicInputVolume,
  getControllableApps,
  getAppVolume,
  setAppVolume
};
