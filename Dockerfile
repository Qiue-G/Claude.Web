FROM node:22-slim

# Install Bun + build deps for node-pty
RUN apt-get update && apt-get install -y curl unzip git build-essential python3 socat \
    && curl -fsSL https://bun.sh/install | bash \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun \
    && groupadd -r appuser && useradd -r -g appuser -m -d /home/appuser appuser \
    && mkdir -p /workspace /free-code /app \
    && chown appuser:appuser /workspace /free-code /app \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies (includes node-pty)
RUN npm ci

# Copy app files
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY vite.config.js svelte.config.js ./

# Build frontend (creates public/ directory with production assets)
RUN npm run build

# Clone and build free-code (non-fatal: if clone fails, app runs without free-code CLI features)
RUN set -e; \
    if git clone --depth 1 https://github.com/paoloanzn/free-code.git /free-code 2>/dev/null; then \
      cd /free-code \
      && bun install 2>/dev/null \
      && bun run build:dev:full 2>/dev/null \
      && chown -R appuser:appuser /free-code \
      && echo "[INFO] free-code built successfully"; \
    else \
      echo "[WARN] free-code clone failed, continuing without CLI features"; \
    fi

# Compile free-code tools for runtime use (glob, grep, file operations)
RUN set -e; \
    if [ -d "/free-code/src/tools" ] && [ -f "/free-code/src/utils/glob.js" ]; then \
      apt-get install -y --no-install-recommends ripgrep \
      && printf '%s\n' \
        'import { glob } from "../utils/glob.js";' \
        'import { getCwd } from "../utils/cwd.js";' \
        'import { writeFile as fsWriteFile, readFile as fsReadFile, mkdir, stat, readdir, unlink, rename } from "fs/promises";' \
        'import { resolve, dirname } from "path";' \
        'import { execSync } from "child_process";' \
        '' \
        'export async function globSearch(pattern, dir) {' \
        '  const start = Date.now();' \
        '  const cwd = dir || getCwd();' \
        '  const result = await glob(pattern, cwd, { limit: 100, offset: 0 }, new AbortController().signal, { allow: true, cwd });' \
        '  return { filenames: result.files, numFiles: result.files.length, truncated: result.truncated, durationMs: Date.now() - start };' \
        '}' \
        '' \
        'export async function writeFileTool(filePath, content, cwd) {' \
        '  const fullPath = resolve(cwd || getCwd(), filePath);' \
        '  await mkdir(dirname(fullPath), { recursive: true });' \
        '  await fsWriteFile(fullPath, content, "utf-8");' \
        '  return `文件已写入: ${filePath} (${content.length} 字符)`;' \
        '}' \
        '' \
        'export async function readFileTool(filePath, cwd) {' \
        '  const fullPath = resolve(cwd || getCwd(), filePath);' \
        '  const content = await fsReadFile(fullPath, "utf-8");' \
        '  const fileStat = await stat(fullPath);' \
        '  const size = fileStat.size > 1024 ? `${(fileStat.size / 1024).toFixed(1)} KB` : `${fileStat.size} B`;' \
        '  return `文件内容 (${filePath}, ${size}):\n\`\`\`\n${content}\n\`\`\``;' \
        '}' \
        '' \
        'export async function editFileTool(filePath, oldString, newString, cwd) {' \
        '  const fullPath = resolve(cwd || getCwd(), filePath);' \
        '  let content = await fsReadFile(fullPath, "utf-8");' \
        '  if (!content.includes(oldString)) {' \
        '    throw new Error(`未找到匹配的原文`);' \
        '  }' \
        '  const newContent = content.replace(oldString, newString);' \
        '  if (newContent === content) {' \
        '    throw new Error(`替换后内容无变化`);' \
        '  }' \
        '  await fsWriteFile(fullPath, newContent, "utf-8");' \
        '  return `文件已编辑: ${filePath}`;' \
        '}' \
        '' \
        'export async function grepSearch(pattern, dir, globFilter, outputMode) {' \
        '  const cwd = dir || getCwd();' \
        '  let cmd = `rg -l --no-heading "${pattern}" "${cwd}"`;' \
        '  if (globFilter) cmd += ` -g "${globFilter}"`;' \
        '  try {' \
        '    const stdout = execSync(cmd, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });' \
        '    return stdout.trim().split("\\n").filter(Boolean);' \
        '  } catch { return []; }' \
        '}' \
        '' \
        'export async function deleteFileTool(filePath, cwd) {' \
        '  const fullPath = resolve(cwd || getCwd(), filePath);' \
        '  await unlink(fullPath);' \
        '  return `文件已删除: ${filePath}`;' \
        '}' \
        '' \
        'export async function renameFileTool(oldPath, newPath, cwd) {' \
        '  const oldFullPath = resolve(cwd || getCwd(), oldPath);' \
        '  const newFullPath = resolve(cwd || getCwd(), newPath);' \
        '  await mkdir(dirname(newFullPath), { recursive: true });' \
        '  await rename(oldFullPath, newFullPath);' \
        '  return `文件已重命名: ${oldPath} → ${newPath}`;' \
        '}' \
        '' \
        'export async function listFilesTool(dir, cwd) {' \
        '  const fullPath = resolve(cwd || getCwd(), dir || ".");' \
        '  const entries = await readdir(fullPath, { withFileTypes: true });' \
        '  return entries.map(e => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`).join("\\n");' \
        '}' \
        > /free-code/src/tools/web-bridge.ts \
      && cd /free-code \
      && mkdir -p /app/fc-tools \
      && bun build ./src/tools/web-bridge.ts --outfile /app/fc-tools/tools.js --target bun 2>&1 \
      && echo "[INFO] free-code tools compiled to /app/fc-tools/tools.js"; \
    else \
      echo "[WARN] free-code not fully available, skipping tool compilation"; \
    fi

# Extract static prompts from free-code for backend prompt loader
RUN set -e; \
    if [ -d "/free-code/src" ]; then \
      printf '\n// BUILD-TIME EXPORTS for prompt extraction\nexport { getSimpleIntroSection,getSimpleSystemSection,getSimpleDoingTasksSection,getSimpleToneAndStyleSection,getOutputEfficiencySection };\n' >> /free-code/src/constants/prompts.ts \
      && cp /app/scripts/dump-static-prompts.ts /free-code/scripts/dump-static-prompts.ts \
      && cd /free-code \
      && printf '\n// BUILD-TIME MACRO definition for prompt extraction\nglobalThis.MACRO = { VERSION: "0.0.0", BUILD_TIME: "2000-01-01T00:00:00.000Z", PACKAGE_URL: "free-code", ISSUES_EXPLAINER: "Report issues at github.com/paoloanzn/free-code", FEEDBACK_CHANNEL: "github", VERSION_CHANGELOG: "local build", NATIVE_PACKAGE_URL: undefined };\n' | cat - /free-code/src/constants/prompts.ts > /tmp/prompts-patched.ts && mv /tmp/prompts-patched.ts /free-code/src/constants/prompts.ts \
      && bun run /free-code/scripts/dump-static-prompts.ts \
      && echo "[INFO] Static prompts extracted successfully"; \
    else \
      echo "[WARN] free-code not available, skipping prompt extraction"; \
    fi

# Extract tool schemas from free-code for backend tool loader
RUN set -e; \
    if [ -d "/free-code/src/tools" ]; then \
      cp /app/scripts/dump-tool-schemas.ts /free-code/scripts/dump-tool-schemas.ts \
      && cd /free-code \
      && printf '\nglobalThis.MACRO = { VERSION: "0.0.0", BUILD_TIME: "2000-01-01T00:00:00.000Z", PACKAGE_URL: "free-code", ISSUES_EXPLAINER: "Report issues at github.com/paoloanzn/free-code", FEEDBACK_CHANNEL: "github", VERSION_CHANGELOG: "local build", NATIVE_PACKAGE_URL: undefined };\n' | cat - /free-code/src/constants/prompts.ts > /tmp/tool-prompt-patched.ts && mv /tmp/tool-prompt-patched.ts /free-code/src/constants/prompts.ts \
      && bun run /free-code/scripts/dump-tool-schemas.ts \
      && echo "[INFO] Tool schemas extracted successfully"; \
    else \
      echo "[WARN] free-code not available, skipping tool schema extraction"; \
    fi

# Copy optional files into /free-code (only if directory has content)
COPY or_proxy.mjs /free-code/or_proxy.mjs
COPY agent-config.json /free-code/agent-config.json

# Create workspace directory
RUN mkdir -p /workspace

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3000

# Environment
ENV PORT=3000
ENV HOST=0.0.0.0
ENV WORKSPACE_DIR=/workspace
ENV FREE_CODE_DIR=/free-code

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Start command
CMD ["node", "src/server/index.js"]
