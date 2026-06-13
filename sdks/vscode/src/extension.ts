import * as vscode from "vscode"
import { ChildProcess, spawn, execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import * as https from "https"

const TERMINAL_NAME = "opencode"
const WEBVIEW_VIEW_TYPE = "mimocode.sidebar"
const BINARY_NAME = "mimocode-server"
const NPM_PACKAGE = "@mimo-ai/cli"

let serverProcess: ChildProcess | undefined
let serverPort: number | undefined
let cachedBinaryPath: string | undefined

export function activate(context: vscode.ExtensionContext) {
  // --- Sidebar WebView View ---
  const viewProvider = new MimocodeViewProvider(context)
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(WEBVIEW_VIEW_TYPE, viewProvider, {
    webviewOptions: { retainContextWhenHidden: true },
  }))

  // --- Terminal commands (original) ---
  const openNewTerminalDisposable = vscode.commands.registerCommand("opencode.openNewTerminal", async () => {
    await openTerminal(context)
  })

  const openTerminalDisposable = vscode.commands.registerCommand("opencode.openTerminal", async () => {
    const existingTerminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
    if (existingTerminal) {
      existingTerminal.show()
      return
    }
    await openTerminal(context)
  })

  const addFilepathDisposable = vscode.commands.registerCommand("opencode.addFilepathToTerminal", async () => {
    const fileRef = getActiveFile()
    if (!fileRef) return

    const terminal = vscode.window.activeTerminal
    if (!terminal) return

    if (terminal.name === TERMINAL_NAME) {
      // @ts-ignore
      const port = terminal.creationOptions.env?.["_EXTENSION_OPENCODE_PORT"]
      port ? await appendPrompt(parseInt(port), fileRef) : terminal.sendText(fileRef, false)
      terminal.show()
    }
  })

  context.subscriptions.push(openNewTerminalDisposable, openTerminalDisposable, addFilepathDisposable)
}

// --- Binary management ---

function getPlatformInfo() {
  const platform = os.platform()
  const arch = os.arch()
  return { platform, arch }
}

function getBinaryDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "binaries")
}

function getBinaryPath(context: vscode.ExtensionContext): string {
  const { platform } = getPlatformInfo()
  const ext = platform === "win32" ? ".exe" : ""
  return path.join(getBinaryDir(context), `${BINARY_NAME}${ext}`)
}

async function ensureMimoBinary(context: vscode.ExtensionContext): Promise<string> {
  // Check cached binary first
  if (cachedBinaryPath && fs.existsSync(cachedBinaryPath)) {
    return cachedBinaryPath
  }

  // Check if mimo is already in PATH
  const pathBinary = findMimoInPath()
  if (pathBinary) {
    cachedBinaryPath = pathBinary
    return pathBinary
  }

  // Download binary
  const binaryPath = getBinaryPath(context)
  if (fs.existsSync(binaryPath)) {
    cachedBinaryPath = binaryPath
    return binaryPath
  }

  // Show progress and download
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "MiMo Code",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Downloading MiMo Code server..." })
      await downloadBinary(context, binaryPath)
      progress.report({ message: "Download complete!" })
    },
  )

  cachedBinaryPath = binaryPath
  return binaryPath
}

function findMimoInPath(): string | undefined {
  try {
    const cmd = os.platform() === "win32" ? "where mimo" : "which mimo"
    const result = execSync(cmd, { encoding: "utf8", timeout: 5000 }).trim()
    return result || undefined
  } catch {
    return undefined
  }
}

async function downloadBinary(context: vscode.ExtensionContext, targetPath: string): Promise<void> {
  const { platform, arch } = getPlatformInfo()
  const dir = path.dirname(targetPath)
  fs.mkdirSync(dir, { recursive: true })

  // Platform mapping matching bin/mimo
  const platformMap: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" }
  const archMap: Record<string, string> = { x64: "x64", arm64: "arm64" }
  const p = platformMap[platform] ?? platform
  const a = archMap[arch] ?? arch
  const pkgName = `opencode-${p}-${a}`

  // Try to get latest version from npm registry
  const version = await getLatestVersion(pkgName)
  if (!version) {
    throw new Error(`Could not find MiMo Code binary for ${p}-${a}`)
  }

  // Download tarball from npm
  const tarballUrl = `https://registry.npmjs.org/${pkgName}/-/${pkgName}-${version}.tgz`
  const tarballPath = path.join(dir, "download.tgz")

  await downloadFile(tarballUrl, tarballPath)

  // Extract the binary
  const { execSync } = require("child_process")
  try {
    // npm pack extracts to a "package" directory
    execSync(`tar -xzf "${tarballPath}" -C "${dir}"`, { timeout: 30000 })

    // Find the binary in extracted files
    const binDir = path.join(dir, "package", "bin")
    const binaryName = platform === "win32" ? "opencode.exe" : "opencode"
    const extractedBinary = path.join(binDir, binaryName)

    if (fs.existsSync(extractedBinary)) {
      fs.copyFileSync(extractedBinary, targetPath)
      fs.chmodSync(targetPath, 0o755)
    } else {
      // Try finding it recursively
      const found = findBinaryInDir(path.join(dir, "package"), binaryName)
      if (found) {
        fs.copyFileSync(found, targetPath)
        fs.chmodSync(targetPath, 0o755)
      } else {
        throw new Error("Binary not found in downloaded package")
      }
    }
  } finally {
    // Cleanup
    try { fs.rmSync(tarballPath, { force: true }) } catch {}
    try { fs.rmSync(path.join(dir, "package"), { recursive: true, force: true }) } catch {}
  }
}

function findBinaryInDir(dir: string, name: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return full
    if (entry.isDirectory()) {
      const found = findBinaryInDir(full, name)
      if (found) return found
    }
  }
  return undefined
}

function getLatestVersion(packageName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const url = `https://registry.npmjs.org/${packageName}/latest`
    https
      .get(url, { timeout: 10000 }, (res) => {
        let data = ""
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => {
          try {
            const json = JSON.parse(data)
            resolve(json.version ?? null)
          } catch {
            resolve(null)
          }
        })
      })
      .on("error", () => resolve(null))
      .on("timeout", function (this: any) {
        this.destroy()
        resolve(null)
      })
  })
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    https
      .get(url, { timeout: 60000 }, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          file.close()
          fs.unlinkSync(destPath)
          downloadFile(res.headers.location!, destPath).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          file.close()
          fs.unlinkSync(destPath)
          reject(new Error(`Download failed: HTTP ${res.statusCode}`))
          return
        }
        res.pipe(file)
        file.on("finish", () => {
          file.close()
          resolve()
        })
      })
      .on("error", (err) => {
        file.close()
        try { fs.unlinkSync(destPath) } catch {}
        reject(err)
      })
  })
}

// --- Sidebar WebView View Provider ---

class MimocodeViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    }

    try {
      const binaryPath = await ensureMimoBinary(this.context)
      const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      const port = await startServer(binaryPath, workspaceDir)
      webviewView.webview.html = getWebviewHtml(port, workspaceDir)
    } catch (err: any) {
      webviewView.webview.html = getErrorHtml(err.message)
    }
  }
}

// --- Server lifecycle ---

async function startServer(binaryPath: string, workspaceDir?: string): Promise<number> {
  if (serverProcess && serverPort) {
    try {
      const res = await fetch(`http://localhost:${serverPort}/global/health`)
      if (res.ok) return serverPort
    } catch {}
    serverProcess = undefined
    serverPort = undefined
  }

  const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384
  const cwd = workspaceDir ?? process.cwd()

  serverProcess = spawn(binaryPath, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    env: { ...process.env, OPENCODE_CALLER: "vscode" },
  })

  serverProcess.on("error", (err) => {
    vscode.window.showErrorMessage(`MiMo Code server failed to start: ${err.message}`)
    serverProcess = undefined
    serverPort = undefined
  })

  serverProcess.on("exit", (code) => {
    if (code && code !== 0 && code !== null) {
      vscode.window.showWarningMessage(`MiMo Code server exited with code ${code}`)
    }
    serverProcess = undefined
    serverPort = undefined
  })

  let tries = 30
  while (tries > 0) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    try {
      const res = await fetch(`http://localhost:${port}/global/health`)
      if (res.ok) {
        serverPort = port
        return port
      }
    } catch {}
    tries--
  }

  throw new Error("MiMo Code server failed to start within timeout")
}

// --- HTML generators ---

function getWebviewHtml(port: number, workspaceDir?: string): string {
  const serverUrl = `http://localhost:${port}`
  const frameSrc = workspaceDir
    ? `${serverUrl}/${Buffer.from(workspaceDir).toString("base64")}/session`
    : serverUrl
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    frame-src ${serverUrl} http: https:;
    script-src 'unsafe-inline' 'unsafe-eval' ${serverUrl} http: https:;
    style-src 'unsafe-inline' ${serverUrl} http: https:;
    img-src ${serverUrl} http: https: data:;
    font-src ${serverUrl} http: https: data:;
    connect-src ${serverUrl} http: https: ws: wss:;
  ">
  <style>
    :root { color-scheme: dark; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, iframe { width: 100%; height: 100%; overflow: hidden; border: none; }
    html, body { background: #1e1e1e; }
  </style>
</head>
<body>
  <iframe id="mimocode-frame" src="${frameSrc}" allow="clipboard-read; clipboard-write"></iframe>
</body>
</html>`
}

function getErrorHtml(message: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><style>
  body { padding: 16px; color: #ccc; font-family: var(--vscode-font-family); }
  h3 { margin-bottom: 8px; }
  .hint { margin-top: 12px; padding: 8px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 4px; font-size: 12px; }
</style></head>
<body>
  <h3>MiMo Code</h3>
  <p>${message}</p>
  <div class="hint">
    You can also install manually: <code>npm i -g @mimo-ai/cli</code>
  </div>
</body>
</html>`
}

// --- Terminal mode (original) ---

async function openTerminal(context: vscode.ExtensionContext) {
  const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384
  const terminal = vscode.window.createTerminal({
    name: TERMINAL_NAME,
    iconPath: {
      light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
      dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
    },
    location: {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: false,
    },
    env: {
      _EXTENSION_OPENCODE_PORT: port.toString(),
      OPENCODE_CALLER: "vscode",
    },
  })

  terminal.show()
  terminal.sendText(`opencode --port ${port}`)

  const fileRef = getActiveFile()
  if (!fileRef) return

  let tries = 10
  let connected = false
  do {
    await new Promise((resolve) => setTimeout(resolve, 200))
    try {
      await fetch(`http://localhost:${port}/app`)
      connected = true
      break
    } catch {}
    tries--
  } while (tries > 0)

  if (connected) {
    await appendPrompt(port, `In ${fileRef}`)
    terminal.show()
  }
}

async function appendPrompt(port: number, text: string) {
  await fetch(`http://localhost:${port}/tui/append-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  })
}

function getActiveFile() {
  const activeEditor = vscode.window.activeTextEditor
  if (!activeEditor) return

  const document = activeEditor.document
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
  if (!workspaceFolder) return

  const relativePath = vscode.workspace.asRelativePath(document.uri)
  let filepathWithAt = `@${relativePath}`

  const selection = activeEditor.selection
  if (!selection.isEmpty) {
    const startLine = selection.start.line + 1
    const endLine = selection.end.line + 1
    if (startLine === endLine) {
      filepathWithAt += `#L${startLine}`
    } else {
      filepathWithAt += `#L${startLine}-${endLine}`
    }
  }

  return filepathWithAt
}

export function deactivate() {
  if (serverProcess) {
    serverProcess.kill("SIGTERM")
    serverProcess = undefined
  }
}
