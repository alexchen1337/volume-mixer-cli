# volume-mixer-cli

Interactive macOS terminal mixer for:

- System output volume
- Microphone input volume
- Scriptable app volumes (`sound volume`-capable apps, e.g. Music/Spotify)

## Run

```bash
npx volume-mixer-cli
```

Or install globally:

```bash
npm i -g volume-mixer-cli
volume-mixer
```

## Controls

- `↑` / `↓`: select item
- `←` / `→`: decrease/increase volume
- Hold `←` / `→`: accelerated volume changes
- `0-100` + `Enter`: set exact volume for selected item
- `Backspace`: edit numeric input
- `r`: refresh app list
- `q` or `Ctrl+C`: quit

## Notes

- This is macOS-only (`osascript` + System Events).
- Generic per-app volume on macOS is limited; this CLI controls apps that expose AppleScript `sound volume`.
- You may be prompted to grant Automation/Accessibility permissions for Terminal.
