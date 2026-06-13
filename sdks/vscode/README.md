# MiMo-Code VS Code Extension

A Visual Studio Code extension that integrates [MiMo Code](https://github.com/Zepp-Hanzj/MiMo-Code/tree/feat/vscode-webview) AI assistant directly into your development workflow.

## Features

- **Sidebar Panel**: MiMo Code appears as a sidebar view alongside Chat, Codex, and Cline — no separate window needed.
- **Auto-Download**: The extension automatically downloads the MiMo Code server binary on first use. No manual CLI installation required.
- **Workspace Integration**: Automatically opens your current VS Code project directory in MiMo Code.
- **Dark Theme**: Respects your VS Code color theme.
- **Terminal Mode**: Use `Cmd+Esc` / `Ctrl+Esc` to open MiMo Code in a split terminal as an alternative.

## Quick Start

1. Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Roger-Han.mimo-code)
2. Click the **MiMo Code** icon in the Activity Bar (left sidebar)
3. The extension will auto-download the server and load the UI

## Manual CLI Installation (Optional)

If you prefer to install the MiMo Code CLI manually:

```bash
npm i -g @mimo-ai/cli
```

## Keybindings

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Open Terminal Mode | `Cmd+Esc` | `Ctrl+Esc` |
| Open in New Tab | `Cmd+Shift+Esc` | `Ctrl+Shift+Esc` |
| Insert File Reference | `Cmd+Option+K` | `Alt+Ctrl+K` |

## Development

1. `code sdks/vscode` - Open the `sdks/vscode` directory in VS Code. **Do not open from repo root.**
2. `npm install` - Run inside the `sdks/vscode` directory.
3. Press `F5` to start debugging - This launches a new VS Code window with the extension loaded.

### Making Changes

The extension uses `tsc` for type checking and `esbuild` for bundling. Both run automatically during debugging.

To test your changes:

1. In the debug VS Code window, press `Cmd+Shift+P`
2. Search for `Developer: Reload Window`
3. Reload to see your changes without restarting the debug session

## License

MIT
