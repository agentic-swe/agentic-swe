# Installing agentic-swe for OpenCode

## Prerequisites

- OpenCode with plugin support enabled
- Node.js >= 18

## Setup

### 1. Install agentic-swe into your target repo

```bash
cd /path/to/your-repo
npx agentic-swe
```

### 2. Add the plugin to opencode.json

Create or edit `opencode.json` in your repo root:

```json
{
  "plugins": [
    {
      "name": "agentic-swe",
      "entry": ".opencode/plugins/agentic-swe.js"
    }
  ]
}
```

### 3. Copy the plugin file

```bash
cp /path/to/agentic-swe/.opencode/plugins/agentic-swe.js \
   /path/to/your-repo/.opencode/plugins/agentic-swe.js
```

Or symlink for local development:

```bash
mkdir -p .opencode/plugins
ln -s /path/to/agentic-swe/.opencode/plugins/agentic-swe.js \
      .opencode/plugins/agentic-swe.js
```

### 4. Verify

Open the repo in OpenCode. The plugin injects the orchestration policy
into chat context. Run `/work <task>` to start a work item.
