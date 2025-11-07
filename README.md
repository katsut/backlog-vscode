# Backlog VSCode Viewer Extension

A VS Code extension to view and manage
Backlog projects and issues within the editor.

## Features

- Sidebar display: Hierarchical project and issue view
- Detail screen: Issue details, comments, attachments
- Backlog-style UI: Rich UI with VS Code theme support
- backlog-js integration: Reliable API with official library

## Installation

### Development Environment Setup

1. Clone the repository

   ```bash
   git clone https://github.com/katsut/backlog-vscode.git
   cd backlog-vscode
   ```

2. Install dependencies

   ```bash
   npm install
   ```

3. Compile TypeScript

   ```bash
   npm run compile
   ```

4. Open in VS Code and press F5 to debug

## Configuration

### 1. Get Backlog API Key

1. Login to Backlog
2. Go to "Personal Settings" → "API"
3. Generate API key
4. Copy the generated API key

### 2. VS Code Settings

#### Set API Key (Secure)

1. Open Command Palette (`Ctrl+Shift+P`)
2. Run `Backlog: Set API Key` command
3. Enter API key (stored securely in Secret Storage)

#### Set API URL

Configure in VS Code settings:

```json
{
  "backlog.apiUrl": "https://yourspace.backlog.jp/api/v2"
}
```

#### Main Configuration Options

| Setting | Description | Example |
|---------|-------------|---------|
| `backlog.apiUrl` | Backlog API URL | `https://yourspace.backlog.jp/api/v2` |
| `backlog.autoRefresh` | Enable/disable auto refresh | `true` |
| `backlog.refreshInterval` | Refresh interval (seconds) | `300` |

### 3. Security Features

- Secret Storage: Encrypted API key storage
- Auto Migration: Safe migration from existing settings
- HTTPS Communication: Encrypted data transfer

## Usage

### Basic Operations

1. Check Backlog view in sidebar
   - Project list displayed hierarchically
   - Setup guide shown when not configured

2. View issue details
   - Click issue to show detail screen
   - View issue info, description, comments
   - Color-coded status and priority display

3. Update data
   - Use refresh button in sidebar for latest data
   - Auto refresh available via settings

## Architecture

```text
┌─────────────────────────────────────────┐
│           VS Code Extension             │
├─────────────────────────────────────────┤
│  ├─ Tree View (Sidebar)                 │
│  └─ Webview (Detail Screen)             │
├─────────────────────────────────────────┤
│  Services Layer                         │
│  ├─ ConfigService                       │
│  └─ BacklogApiService (backlog-js)      │
├─────────────────────────────────────────┤
│  Backlog REST API v2                   │
└─────────────────────────────────────────┘
```

## Development

### Development Commands

```bash
npm run compile    # Compile
npm run watch      # Watch mode
npm run lint       # Lint
npm run format     # Format
```

### Technologies Used

- TypeScript: Type-safe development
- VS Code Extension API: Tree View, Webview
- backlog-js: Official Backlog API library
- ESLint + Prettier: Code quality management

## Troubleshooting

### Common Issues

1. Extension not working
   - Check API URL and API Key configuration
   - Verify API key permissions
   - Check network connection

2. Data not displayed
   - Verify project access permissions
   - Use refresh button to reload data
   - Check developer console for errors
