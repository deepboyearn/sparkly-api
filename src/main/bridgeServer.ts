import express, { type Request, type Response } from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { getResponsesDebugLogPath, loadConfig, markAccountUsed, selectActiveAccount } from "./configStore";
import type { BridgeConfig, BridgeStats, RequestLogEntry, UpstreamAccount } from "../shared/types";

const MAX_LOGS = 200;
const MAX_AGENT_TURNS = 5;
const MAX_TOOL_CALL_RETRIES = 2;
const execFileAsync = promisify(execFile);
const WORKSPACE_ROOT = process.cwd();

export class BridgeServer {
  private app = express();
  private server: Server | null = null;
  private logs: RequestLogEntry[] = [];
  private responsesSessions = new Map<string, Array<Record<string, unknown>>>();
    private pendingToolOutputItems: Array<Record<string, unknown>> = [];
    private pendingStreamToolItems: Array<{ call: Record<string, unknown>; output: Record<string, unknown> }> = [];
  private totalRequests = 0;
  private successCount = 0;
  private errorCount = 0;
  private startedAt = Date.now();
  private localBaseUrl = "http://localhost:48231";
  private config: BridgeConfig = loadConfig();

  constructor() {
    this.configureMiddleware();
    this.configureRoutes();
  }

  async start(config: BridgeConfig) {
    this.config = config;
    this.startedAt = Date.now();

    if (this.server) {
      await this.stop();
    }

    try {
      await this.listenOnPort(config.localPort);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String((error as { code?: string }).code) : "";
      if (code !== "EADDRINUSE") {
        throw error;
      }
      await this.listenOnPort(0);
    }
  }

  async stop() {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.server = null;
  }

  updateConfig(config: BridgeConfig) {
    this.config = config;
  }

  getLogs() {
    return [...this.logs];
  }

  getStats(): BridgeStats {
    return {
      totalRequests: this.totalRequests,
      successCount: this.successCount,
      errorCount: this.errorCount,
      lastRequestAt: this.logs[0]?.timestamp ?? null,
      uptimeMs: Date.now() - this.startedAt,
      activeModelCount: this.config.models.length,
      localBaseUrl: this.localBaseUrl,
      serverRunning: Boolean(this.server),
    };
  }

  private configureMiddleware() {
    this.app.use((req, res, next) => {
      if (this.config.enableCors) {
        cors()(req, res, next);
        return;
      }
      next();
    });
    this.app.use(express.json({ limit: "2mb" }));
  }

  private async listenOnPort(port: number) {
    await new Promise<void>((resolve, reject) => {
      this.server = this.app.listen(port, "127.0.0.1", () => {
        const address = this.server?.address() as AddressInfo;
        this.localBaseUrl = `http://localhost:${address.port}`;
        resolve();
      });
      this.server.on("error", reject);
    });
  }

  private configureRoutes() {
    this.app.get("/health", (_req, res) => {
      res.json({
        ok: true,
        upstreamBaseUrl: this.config.upstreamBaseUrl,
        localBaseUrl: this.localBaseUrl,
        modelCount: this.config.models.length,
      });
    });

    this.app.get("/stats", (_req, res) => {
      res.json(this.getStats());
    });

    this.app.get("/logs", (_req, res) => {
      res.json({ data: this.getLogs() });
    });

    this.app.get("/v1", (_req, res) => {
      res.status(404).json({ detail: "Not Found" });
    });

    this.app.get("/v1/models", async (_req, res) => {
      if (!this.hasConfiguredUpstream()) {
        res.status(400).json({ error: { message: "API key is not configured." } });
        return;
      }

      const proxied = await this.forwardRequest({
        upstreamPath: "/v1/models",
        method: "GET",
      });

      this.writeResponse(res, proxied);
    });

    this.app.post("/v1/chat/completions", async (req, res) => {
      if (!this.hasConfiguredUpstream()) {
        res.status(400).json({ error: { message: "API key is not configured." } });
        return;
      }

      const body = this.applyModelDefaults(req.body ?? {});

      const proxied = await this.forwardRequest({
        upstreamPath: "/v1/chat/completions",
        method: "POST",
        body,
      });

      this.writeResponse(res, proxied, this.extractModel(body));
    });

    this.app.post("/v1/responses", async (req, res) => {
      if (!this.hasConfiguredUpstream()) {
        res.status(400).json({ error: { message: "API key is not configured." } });
        return;
      }

      const requestBody = typeof req.body === "object" && req.body !== null ? req.body as Record<string, unknown> : {};
      this.recordResponsesDebug("request", requestBody);
      const chatBody = this.applyModelDefaults(this.mapResponsesRequestToChat(requestBody));
      this.recordResponsesDebug("mapped-chat", chatBody);
      const proxied = await this.runResponsesAgentLoop(chatBody, requestBody);

      if (proxied.contentType.includes("application/json") && proxied.status < 400) {
        const translated = this.mapChatResponseToResponses(proxied.body, requestBody, this.extractModel(chatBody));
        this.storeResponsesSession(translated.id, requestBody, translated);
        this.recordResponsesDebug("translated-response", translated);
        const wantsStream = Boolean(requestBody.stream);

        if (wantsStream) {
          this.writeResponsesStream(res, translated);
          return;
        }

        this.writeResponse(res, {
          status: proxied.status,
          contentType: "application/json",
          body: translated,
        }, this.extractModel(chatBody));
        return;
      }

      this.writeResponse(res, proxied, this.extractModel(chatBody));
    });
  }

  private hasConfiguredUpstream() {
    return Boolean(this.config.apiKey);
  }

  private applyModelDefaults(body: Record<string, unknown>) {
    const nextBody = { ...body };

    if (!nextBody.model) {
      nextBody.model = this.config.selectedModel;
    }

    if (this.config.systemPrompt) {
      const messages = Array.isArray(nextBody.messages) ? [...nextBody.messages] : [];
      const hasSystem = messages.some((message) => {
        return typeof message === "object" && message !== null && (message as { role?: string }).role === "system";
      });

      if (!hasSystem) {
        messages.unshift({ role: "system", content: this.config.systemPrompt });
      }

      nextBody.messages = messages;
    }

    return nextBody;
  }

  private mapResponsesRequestToChat(body: Record<string, unknown>) {
    const input = this.mergeConversationInput(body);
    const messages = this.normalizeResponsesInput(input);
    const tools = this.mapResponsesToolsToChat(body.tools);
    const toolChoice = this.mapResponsesToolChoiceToChat(body.tool_choice, tools.length > 0);

    return {
      model: typeof body.model === "string" ? body.model : this.config.selectedModel,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: toolChoice,
      parallel_tool_calls: typeof body.parallel_tool_calls === "boolean" ? body.parallel_tool_calls : undefined,
      max_tokens: typeof body.max_output_tokens === "number" ? body.max_output_tokens : undefined,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
    };
  }

  private mergeConversationInput(body: Record<string, unknown>) {
    const currentInput = body.input;
    const previousResponseId = typeof body.previous_response_id === "string" ? body.previous_response_id : "";

    if (!previousResponseId) {
      return currentInput;
    }

    const previousItems = this.responsesSessions.get(previousResponseId) ?? [];
    const currentItems = Array.isArray(currentInput)
      ? currentInput
      : typeof currentInput === "string"
        ? [{ role: "user", content: currentInput }]
        : [];

    return [...previousItems, ...currentItems];
  }

  private normalizeResponsesInput(input: unknown) {
    if (typeof input === "string") {
      return [{ role: "user", content: input }];
    }

    if (!Array.isArray(input)) {
      return [{ role: "user", content: "" }];
    }

    const messages = input.flatMap((item) => {
      if (typeof item === "string") {
        return [{ role: "user", content: item }];
      }

      if (!item || typeof item !== "object") {
        return [];
      }

      const typedItem = item as {
        type?: string;
        role?: string;
        call_id?: string;
        name?: string;
        arguments?: string;
        output?: string;
        content?: unknown;
      };
      const role = typeof typedItem.role === "string" ? typedItem.role : "user";

      if (typedItem.type === "function_call_output" && typedItem.call_id) {
        return [{
          role: "tool",
          tool_call_id: typedItem.call_id,
          content: typeof typedItem.output === "string" ? typedItem.output : JSON.stringify(typedItem.output ?? ""),
        }];
      }

      if (typedItem.type === "function_call" && typedItem.call_id) {
        return [{
          role: "assistant",
          content: "",
          tool_calls: [{
            id: typedItem.call_id,
            type: "function",
            function: {
              name: typedItem.name ?? "tool",
              arguments: typedItem.arguments ?? "{}",
            },
          }],
        }];
      }

      const content = typedItem.content;
      const normalizedContent = this.mapResponsesContentToChatContent(content);
      if (normalizedContent !== undefined) {
        return [{ role, content: normalizedContent }];
      }

      return [];
    });

    return messages.length > 0 ? messages : [{ role: "user", content: "" }];
  }

  private mapResponsesToolsToChat(tools: unknown) {
    if (!Array.isArray(tools)) {
      return [];
    }

    return tools.flatMap((tool) => {
      if (!tool || typeof tool !== "object") {
        return [];
      }

      const typedTool = tool as {
        type?: string;
        name?: string;
        description?: string;
        parameters?: unknown;
      };

      if (typedTool.type !== "function" || !typedTool.name) {
        return [];
      }

      return [{
        type: "function",
        function: {
          name: typedTool.name,
          description: typedTool.description,
          parameters: typedTool.parameters ?? { type: "object", properties: {} },
        },
      }];
    });
  }

  private mapResponsesContentToChatContent(content: unknown) {
    if (typeof content === "string") {
      return content;
    }

    if (!Array.isArray(content)) {
      return undefined;
    }

    const parts = content.flatMap<Record<string, unknown>>((part) => {
      if (!part || typeof part !== "object") {
        return [];
      }

      const typedPart = part as {
        type?: unknown;
        text?: unknown;
        content?: unknown;
        image_url?: unknown;
        detail?: unknown;
        filename?: unknown;
        file_id?: unknown;
      };
      const type = typeof typedPart.type === "string" ? typedPart.type : "";

      if ((type === "input_text" || type === "output_text" || type === "text") && typeof typedPart.text === "string") {
        return [{ type: "text", text: typedPart.text }];
      }

      if (type === "input_image" || type === "image_url") {
        const image = typedPart.image_url;
        const url = typeof image === "string"
          ? image
          : image && typeof image === "object" && typeof (image as { url?: unknown }).url === "string"
            ? String((image as { url?: string }).url)
            : "";
        const detail = typeof typedPart.detail === "string"
          ? typedPart.detail
          : image && typeof image === "object" && typeof (image as { detail?: unknown }).detail === "string"
            ? String((image as { detail?: string }).detail)
            : undefined;

        if (!url) {
          return [];
        }

        return [{
          type: "image_url",
          image_url: detail ? { url, detail } : { url },
        }];
      }

      if (type === "input_file") {
        const filename = typeof typedPart.filename === "string"
          ? typedPart.filename
          : typeof typedPart.file_id === "string"
            ? typedPart.file_id
            : "attached-file";
        return [{ type: "text", text: `[input_file:${filename}]` }];
      }

      if (typeof typedPart.text === "string") {
        return [{ type: "text", text: typedPart.text }];
      }

      if (typeof typedPart.content === "string") {
        return [{ type: "text", text: typedPart.content }];
      }

      return [];
    });

    if (parts.length === 0) {
      return "";
    }

    const hasStructuredPart = parts.some((part) => part.type !== "text");
    if (!hasStructuredPart) {
      return parts.map((part) => String(part.text ?? "")).filter(Boolean).join("\n");
    }

    return parts;
  }

  private async runResponsesAgentLoop(initialChatBody: Record<string, unknown>, requestBody: Record<string, unknown>) {
    let chatBody = initialChatBody;
    let accumulatedItems = Array.isArray(this.mergeConversationInput(requestBody))
      ? (this.mergeConversationInput(requestBody) as Array<Record<string, unknown>>)
      : [];

    for (let turn = 0; turn < MAX_AGENT_TURNS; turn += 1) {
      const proxied = await this.forwardRequest({
        upstreamPath: "/v1/chat/completions",
        method: "POST",
        body: chatBody,
      });

      if (!proxied.contentType.includes("application/json") || proxied.status >= 400) {
        return proxied;
      }

      const nextBody = await this.applyLocalToolCalls(chatBody, proxied.body, requestBody, accumulatedItems);
      if (!nextBody) {
        return proxied;
      }

      accumulatedItems = nextBody.accumulatedItems;
      chatBody = nextBody;
    }

    return {
      status: 400,
      contentType: "application/json",
      body: {
        error: {
          message: "Agent loop exceeded maximum shell tool turns.",
          type: "bridge_agent_loop_error",
        },
      },
    };
  }

  private async applyLocalToolCalls(
    chatBody: Record<string, unknown>,
    responseBody: unknown,
    requestBody: Record<string, unknown>,
    accumulatedItems: Array<Record<string, unknown>>,
  ) {
    const responseMessage = typeof responseBody === "object" && responseBody !== null
      ? (responseBody as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }> }).choices?.[0]?.message
      : undefined;
    const toolCalls = Array.isArray(responseMessage?.tool_calls) ? responseMessage.tool_calls : [];

    if (toolCalls.length === 0) {
      return null;
    }

    const availableTools = Array.isArray(requestBody.tools) ? requestBody.tools : [];
    const supportsShell = availableTools.some((tool) => {
      if (!tool || typeof tool !== "object") {
        return false;
      }

      const typedTool = tool as { type?: string; name?: string };
      return typedTool.type === "function" && this.isShellToolName(typedTool.name);
    });
    const supportsFile = availableTools.some((tool) => {
      if (!tool || typeof tool !== "object") {
        return false;
      }

      const typedTool = tool as { type?: string; name?: string };
      return typedTool.type === "function" && this.isFileToolName(typedTool.name);
    });

    if (!supportsShell && !supportsFile) {
      return null;
    }

    const assistantToolItems = toolCalls.map((toolCall) => ({
      type: "function_call",
      id: toolCall.id ?? `fc_${randomUUID().replace(/-/g, "")}`,
      call_id: toolCall.id ?? `call_${randomUUID().replace(/-/g, "")}`,
      name: toolCall.function?.name ?? "tool",
      arguments: toolCall.function?.arguments ?? "{}",
    }));
    const assistantMessage = {
      role: "assistant",
      content: responseMessage?.content ?? "",
      tool_calls: toolCalls,
    };
    const toolOutputs = [] as Array<{ role: string; tool_call_id: string; content: string }>;
    const toolOutputItems = [...this.pendingToolOutputItems];
    this.pendingToolOutputItems = [];
    let fatalToolError = false;

    for (const toolCall of toolCalls) {
      const toolName = toolCall?.function?.name ?? "";
      if (!toolCall?.id) {
        continue;
      }

      let result: unknown;
      if (this.isShellToolName(toolName) && supportsShell) {
        const command = this.extractShellCommand(toolCall.function?.arguments ?? "{}");
        result = await this.executeShellCommand(command);
      } else if (this.isFileToolName(toolName) && supportsFile) {
        result = await this.executeFileTool(toolName, toolCall.function?.arguments ?? "{}");
      } else {
        continue;
      }

      const normalizedResult = this.normalizeToolResult(result);
      if (normalizedResult.fatal) {
        fatalToolError = true;
      }

      toolOutputs.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(normalizedResult),
      });
      toolOutputItems.push({
        type: "function_call_output",
        call_id: toolCall.id,
        output: JSON.stringify(normalizedResult),
      });
      this.pendingStreamToolItems.push({
        call: {
          id: toolCall.id,
          type: "function_call",
          call_id: toolCall.id,
          name: toolName,
          arguments: toolCall.function?.arguments ?? "{}",
          status: "completed",
        },
        output: {
          id: `fco_${toolCall.id.replace(/[^a-zA-Z0-9_-]/g, "")}`,
          type: "function_call_output",
          call_id: toolCall.id,
          output: JSON.stringify(normalizedResult),
          status: "completed",
        },
      });
    }

    if (toolOutputs.length === 0 || fatalToolError) {
      return null;
    }

    const nextAccumulatedItems = [
      ...accumulatedItems,
      ...assistantToolItems,
      ...toolOutputItems,
    ];

    return {
      ...chatBody,
      accumulatedItems: nextAccumulatedItems,
      messages: [
        ...(Array.isArray(chatBody.messages) ? chatBody.messages : []),
        assistantMessage,
        ...toolOutputItems,
        ...toolOutputs,
      ],
    };
  }

  private isShellToolName(name?: string) {
    const normalized = String(name ?? "").toLowerCase();
    return normalized === "shell" || normalized === "run_command" || normalized === "terminal" || normalized === "execute_command";
  }

  private isFileToolName(name?: string) {
    const normalized = String(name ?? "").toLowerCase();
    return normalized === "read_file"
      || normalized === "write_file"
      || normalized === "create_file"
      || normalized === "edit_file"
      || normalized === "append_file";
  }

  private extractShellCommand(rawArguments: string) {
    try {
      const parsed = JSON.parse(rawArguments) as Record<string, unknown>;
      const candidates = [parsed.command, parsed.cmd, parsed.input, parsed.script];
      const command = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
      return typeof command === "string" ? command : "";
    } catch {
      return rawArguments;
    }
  }

  private async executeShellCommand(command: string) {
    if (!command.trim()) {
      return {
        ok: false,
        stdout: "",
        stderr: "No shell command provided.",
        exit_code: 1,
        code: "NO_COMMAND",
        retryable: false,
      };
    }

    for (let attempt = 0; attempt <= MAX_TOOL_CALL_RETRIES; attempt += 1) {
      try {
        const { stdout, stderr } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], {
          timeout: 30_000,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        });
        return {
          ok: true,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          exit_code: 0,
          attempts: attempt + 1,
        };
      } catch (error) {
        const execError = error as { stdout?: string; stderr?: string; code?: number | string };
        const code = this.normalizeToolErrorCode(execError.code, error);
        const retryable = this.isRetryableToolError(code);

        if (retryable && attempt < MAX_TOOL_CALL_RETRIES) {
          continue;
        }

        return {
          ok: false,
          stdout: String(execError.stdout ?? ""),
          stderr: String(execError.stderr ?? (error instanceof Error ? error.message : "Unknown shell error")),
          exit_code: typeof execError.code === "number" ? execError.code : 1,
          code,
          retryable,
          retry_after_ms: retryable ? 1000 : undefined,
          attempts: attempt + 1,
        };
      }
    }

    return {
      ok: false,
      stdout: "",
      stderr: "Shell command failed after retries.",
      exit_code: 1,
      code: "UNKNOWN_SHELL_ERROR",
      retryable: false,
      attempts: MAX_TOOL_CALL_RETRIES + 1,
    };
  }

  private async executeFileTool(toolName: string, rawArguments: string) {
    try {
      const parsed = JSON.parse(rawArguments) as Record<string, unknown>;
      const rawFilePath = typeof parsed.path === "string"
        ? parsed.path
        : typeof parsed.file_path === "string"
          ? parsed.file_path
          : "";
      const targetPath = this.resolveWorkspacePath(rawFilePath);

      switch (toolName.toLowerCase()) {
        case "read_file": {
          const content = fs.readFileSync(targetPath, "utf8");
          return { ok: true, path: targetPath, content };
        }
        case "write_file":
        case "create_file": {
          const content = typeof parsed.content === "string" ? parsed.content : "";
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.writeFileSync(targetPath, content, "utf8");
          return { ok: true, path: targetPath, written: true };
        }
        case "append_file": {
          const content = typeof parsed.content === "string" ? parsed.content : "";
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.appendFileSync(targetPath, content, "utf8");
          return { ok: true, path: targetPath, appended: true };
        }
        case "edit_file": {
          const search = typeof parsed.search === "string" ? parsed.search : "";
          const replace = typeof parsed.replace === "string" ? parsed.replace : "";
          const content = fs.readFileSync(targetPath, "utf8");
          if (!search) {
            return { ok: false, path: targetPath, error: "Missing search text for edit_file.", code: "MISSING_SEARCH", retryable: false };
          }
          if (!content.includes(search)) {
            return { ok: false, path: targetPath, error: "Search text not found in file.", code: "SEARCH_NOT_FOUND", retryable: false };
          }
          fs.writeFileSync(targetPath, content.replace(search, replace), "utf8");
          return { ok: true, path: targetPath, edited: true };
        }
        default:
          return { ok: false, error: `Unsupported file tool: ${toolName}`, code: "UNSUPPORTED_FILE_TOOL", retryable: false, fatal: true };
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown file tool error",
        code: this.normalizeToolErrorCode(undefined, error),
        retryable: false,
      };
    }
  }

  private normalizeToolResult(result: unknown) {
    if (!result || typeof result !== "object") {
      return {
        ok: false,
        error: "Tool returned a non-object result.",
        code: "INVALID_TOOL_RESULT",
        retryable: false,
        fatal: true,
      };
    }

    const typedResult = result as Record<string, unknown>;
    return {
      ...typedResult,
      ok: typedResult.ok !== false,
      retryable: typedResult.retryable === true,
      fatal: typedResult.fatal === true,
    };
  }

  private normalizeToolErrorCode(code: unknown, error: unknown) {
    if (typeof code === "string" && code.trim().length > 0) {
      return code.trim().toUpperCase();
    }

    if (typeof code === "number") {
      return `EXIT_${code}`;
    }

    if (error instanceof Error) {
      if (/timed out/i.test(error.message)) {
        return "ETIMEDOUT";
      }
      if (/maxbuffer/i.test(error.message)) {
        return "EMAXBUFFER";
      }
    }

    return "UNKNOWN_TOOL_ERROR";
  }

  private isRetryableToolError(code: string) {
    return code === "ETIMEDOUT" || code === "EMAXBUFFER";
  }

  private resolveWorkspacePath(rawPath: string) {
    const normalizedInput = rawPath.trim();
    const candidatePath = path.isAbsolute(normalizedInput)
      ? path.normalize(normalizedInput)
      : path.normalize(path.join(WORKSPACE_ROOT, normalizedInput));
    const relative = path.relative(WORKSPACE_ROOT, candidatePath);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("File path is outside the local-ai-bridge workspace root.");
    }

    return candidatePath;
  }

  private mapResponsesToolChoiceToChat(toolChoice: unknown, hasTools: boolean) {
    if (!hasTools) {
      return undefined;
    }

    if (toolChoice === "auto" || toolChoice === "none" || toolChoice === "required") {
      return toolChoice;
    }

    if (toolChoice && typeof toolChoice === "object") {
      const typedChoice = toolChoice as { type?: string; name?: string };
      if (typedChoice.type === "function" && typedChoice.name) {
        return {
          type: "function",
          function: { name: typedChoice.name },
        };
      }
    }

    return undefined;
  }

  private mapChatResponseToResponses(body: unknown, requestBody: Record<string, unknown>, fallbackModel?: string) {
    const chat = typeof body === "object" && body !== null ? body as {
      id?: string;
      created?: number;
      model?: string;
      choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    } : {};

    const assistantMessage = chat.choices?.[0]?.message;
    const outputText = String(assistantMessage?.content ?? "");
    const model = chat.model ?? fallbackModel ?? this.config.selectedModel;
    const responseId = typeof chat.id === "string" && chat.id.length > 0 ? `resp_${chat.id.replace(/^resp_/, "")}` : `resp_${randomUUID().replace(/-/g, "")}`;
    const createdAt = typeof chat.created === "number" ? chat.created : Math.floor(Date.now() / 1000);
    const inputTokens = chat.usage?.prompt_tokens ?? 0;
    const outputTokens = chat.usage?.completion_tokens ?? 0;
    const totalTokens = chat.usage?.total_tokens ?? inputTokens + outputTokens;
    const toolCallOutputs = (assistantMessage?.tool_calls ?? []).flatMap((toolCall) => {
      if (!toolCall?.id || !toolCall.function?.name) {
        return [];
      }

      return [{
        id: toolCall.id,
        type: "function_call",
        call_id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments ?? "{}",
      }];
    });

    return {
      id: responseId,
      object: "response",
      created_at: createdAt,
      status: "completed",
      model,
      output: [
        {
          id: `msg_${randomUUID().replace(/-/g, "")}`,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: outputText,
              annotations: [],
            },
          ],
        },
        ...toolCallOutputs,
      ],
      output_text: outputText,
      temperature: typeof requestBody.temperature === "number" ? requestBody.temperature : undefined,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
      },
    };
  }

  private storeResponsesSession(responseId: string, requestBody: Record<string, unknown>, responseBody: { output?: Array<Record<string, unknown>> }) {
    const currentInput = requestBody.input;
    const mergedInput = Array.isArray(currentInput)
      ? currentInput.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      : typeof currentInput === "string"
        ? [{ role: "user", content: currentInput }]
        : [];
    const previousResponseId = typeof requestBody.previous_response_id === "string" ? requestBody.previous_response_id : "";
    const previousItems = previousResponseId ? this.responsesSessions.get(previousResponseId) ?? [] : [];
    const outputItems = Array.isArray(responseBody.output)
      ? responseBody.output.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      : [];

    this.responsesSessions.set(responseId, [...previousItems, ...mergedInput, ...outputItems]);

    if (this.responsesSessions.size > 50) {
      const oldestKey = this.responsesSessions.keys().next().value;
      if (oldestKey) {
        this.responsesSessions.delete(oldestKey);
      }
    }
  }

  private writeResponsesStream(res: Response, responseBody: {
    id: string;
    object: string;
    created_at: number;
    status: string;
    model: string;
    output: Array<Record<string, unknown>>;
    output_text: string;
    usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  }) {
    const firstMessageItem = responseBody.output.find((item) => item.type === "message") as { id?: string } | undefined;
    const itemId = firstMessageItem?.id ?? `msg_${randomUUID().replace(/-/g, "")}`;
    const outputText = responseBody.output_text ?? "";
    const contentPart = {
      type: "output_text",
      text: outputText,
      annotations: [],
    };
    const streamToolItems = [...this.pendingStreamToolItems];
    this.pendingStreamToolItems = [];
    let sequenceNumber = 1;

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const createdEvent = {
      type: "response.created",
      sequence_number: sequenceNumber++,
      response: {
        id: responseBody.id,
        object: responseBody.object,
        created_at: responseBody.created_at,
        status: "in_progress",
        model: responseBody.model,
        output: [],
        usage: null,
      },
    };

    const deltaEvent = {
      type: "response.output_item.added",
      sequence_number: sequenceNumber++,
      output_index: 0,
      item: {
        id: itemId,
        type: "message",
        status: "in_progress",
        role: "assistant",
        content: [],
      },
    };

    const contentAddedEvent = {
      type: "response.content_part.added",
      sequence_number: sequenceNumber++,
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      part: {
        type: "output_text",
        text: "",
        annotations: [],
      },
    };

    const textDeltaEvent = {
      type: "response.output_text.delta",
      sequence_number: sequenceNumber++,
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      delta: outputText,
    };

    const doneEvent = {
      type: "response.output_text.done",
      sequence_number: sequenceNumber++,
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      text: outputText,
    };

    const contentDoneEvent = {
      type: "response.content_part.done",
      sequence_number: sequenceNumber++,
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      part: contentPart,
    };

    const itemDoneEvent = {
      type: "response.output_item.done",
      sequence_number: sequenceNumber++,
      output_index: 0,
      item: {
        id: itemId,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [contentPart],
      },
    };

    const completedEvent = {
      type: "response.completed",
      sequence_number: sequenceNumber++,
      response: {
        ...responseBody,
        completed_at: Math.floor(Date.now() / 1000),
      },
    };

    const toolEvents = streamToolItems.flatMap((toolItem, index) => {
      const outputIndex = index + 1;
      return [
        {
          type: "response.output_item.added",
          sequence_number: sequenceNumber++,
          output_index: outputIndex,
          item: {
            ...toolItem.call,
            status: "in_progress",
          },
        },
        {
          type: "response.output_item.done",
          sequence_number: sequenceNumber++,
          output_index: outputIndex,
          item: toolItem.call,
        },
        {
          type: "response.output_item.added",
          sequence_number: sequenceNumber++,
          output_index: outputIndex + 1,
          item: {
            ...toolItem.output,
            status: "in_progress",
            output: "",
          },
        },
        {
          type: "response.output_item.done",
          sequence_number: sequenceNumber++,
          output_index: outputIndex + 1,
          item: toolItem.output,
        },
      ];
    });

    for (const event of [createdEvent, ...toolEvents, deltaEvent, contentAddedEvent, textDeltaEvent, doneEvent, contentDoneEvent, itemDoneEvent, completedEvent]) {
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  }

  private stringifyToolMessageContent(content: unknown) {
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }

          if (typeof (part as { text?: unknown }).text === "string") {
            return String((part as { text?: string }).text);
          }

          if (typeof (part as { content?: unknown }).content === "string") {
            return String((part as { content?: string }).content);
          }

          return "";
        })
        .filter(Boolean)
        .join("\n");

      if (text) {
        return text;
      }
    }

    try {
      return JSON.stringify(content ?? "");
    } catch {
      return String(content ?? "");
    }
  }

  private extractChatToolCalls(toolCalls: unknown) {
    if (!Array.isArray(toolCalls)) {
      return [];
    }

    return toolCalls.flatMap((toolCall) => {
      if (!toolCall || typeof toolCall !== "object") {
        return [];
      }

      const typedToolCall = toolCall as {
        id?: unknown;
        type?: unknown;
        function?: {
          name?: unknown;
          arguments?: unknown;
        };
      };
      const name = typeof typedToolCall.function?.name === "string" ? typedToolCall.function.name : "";
      if (!name) {
        return [];
      }

      const id = typeof typedToolCall.id === "string" && typedToolCall.id.length > 0
        ? typedToolCall.id
        : `call_${randomUUID().replace(/-/g, "")}`;
      const argumentsValue = typedToolCall.function?.arguments;
      const serializedArguments = typeof argumentsValue === "string"
        ? argumentsValue
        : JSON.stringify(argumentsValue ?? {});

      return [{
        id,
        type: typeof typedToolCall.type === "string" ? typedToolCall.type : "function",
        function: {
          name,
          arguments: serializedArguments,
        },
      }];
    });
  }

  private async forwardRequest({
    upstreamPath,
    method,
    body,
  }: {
    upstreamPath: string;
    method: "GET" | "POST";
    body?: unknown;
  }) {
    const started = Date.now();
    const activeAccount = this.getActiveAccount();
    const accountsToTry = activeAccount
      ? [activeAccount, ...this.config.accounts.filter((account) => account.id !== activeAccount.id)]
      : [];

    for (const account of accountsToTry) {
      try {
        const response = await fetch(`${account.baseUrl}${upstreamPath}`, {
          method,
          headers: {
            Authorization: `Bearer ${account.apiKey}`,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        });

        const text = await response.text();
        const contentType = response.headers.get("content-type") ?? "application/json";
        const parsedBody = contentType.includes("application/json") && text ? JSON.parse(text) : text;
        const durationMs = Date.now() - started;

        this.recordLog({
          method,
          path: upstreamPath,
          status: response.status,
          model: this.extractModel(body),
          durationMs,
        });

        if (response.ok) {
          this.successCount += 1;
          this.totalRequests += 1;
          markAccountUsed(account.id);

          if (this.config.activeAccountId !== account.id) {
            this.config = selectActiveAccount(account.id);
          }

          return {
            status: response.status,
            contentType,
            body: parsedBody,
          };
        }

        const shouldFailover = this.shouldFailoverAccount(response.status, parsedBody);
        if (!shouldFailover || account.id === accountsToTry[accountsToTry.length - 1]?.id) {
          this.errorCount += 1;
          this.totalRequests += 1;
          return {
            status: response.status,
            contentType,
            body: parsedBody,
          };
        }
      } catch (error) {
        const isLastAccount = account.id === accountsToTry[accountsToTry.length - 1]?.id;
        if (!isLastAccount) {
          continue;
        }

        const durationMs = Date.now() - started;
        const message = error instanceof Error ? error.message : "Unknown upstream error";
        this.recordLog({
          method,
          path: upstreamPath,
          status: 502,
          model: this.extractModel(body),
          durationMs,
          error: message,
        });
        this.totalRequests += 1;
        this.errorCount += 1;

        return {
          status: 502,
          contentType: "application/json",
          body: {
            error: {
              message,
              type: "bridge_upstream_error",
            },
          },
        };
      }
    }

    return {
      status: 400,
      contentType: "application/json",
      body: {
        error: {
          message: "No configured upstream accounts are available.",
          type: "bridge_account_error",
        },
      },
    };
  }

  private getActiveAccount(): UpstreamAccount | undefined {
    return this.config.accounts.find((account) => account.id === this.config.activeAccountId) ?? this.config.accounts[0];
  }

  private shouldFailoverAccount(status: number, body: unknown) {
    if (status === 401 || status === 402 || status === 403 || status === 429) {
      return true;
    }

    if (status === 500 || status === 502 || status === 503 || status === 504) {
      return true;
    }

    if (status !== 400 || !body || typeof body !== "object") {
      return false;
    }

    const error = (body as { error?: { code?: unknown; type?: unknown; message?: unknown } }).error;
    const code = String(error?.code ?? "").toLowerCase();
    const type = String(error?.type ?? "").toLowerCase();
    const message = String(error?.message ?? "").toLowerCase();

    return code.includes("quota")
      || code.includes("insufficient")
      || type.includes("quota")
      || type.includes("insufficient")
      || message.includes("quota")
      || message.includes("insufficient")
      || message.includes("credit")
      || message.includes("balance")
      || message.includes("billing")
      || message.includes("rate limit");
  }

  private writeResponse(res: Response, proxied: { status: number; contentType: string; body: unknown }, model?: string) {
    if (model && proxied.status >= 400 && this.logs[0]) {
      this.logs[0].model = model;
    }

    res.status(proxied.status);
    if (proxied.contentType.includes("application/json")) {
      res.json(proxied.body);
      return;
    }
    res.type(proxied.contentType).send(String(proxied.body));
  }

  private extractModel(body?: unknown) {
    if (!body || typeof body !== "object") {
      return undefined;
    }

    const candidate = (body as { model?: unknown }).model;
    return typeof candidate === "string" ? candidate : undefined;
  }

  private recordLog(input: Omit<RequestLogEntry, "id" | "timestamp">) {
    this.logs.unshift({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...input,
    });
    this.logs = this.logs.slice(0, MAX_LOGS);
  }

  private recordResponsesDebug(stage: string, payload: unknown) {
    try {
      const logPath = getResponsesDebugLogPath();
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      const safePayload = this.redactDebugPayload(payload);
      fs.appendFileSync(logPath, `${JSON.stringify({
        timestamp: new Date().toISOString(),
        stage,
        payload: safePayload,
      })}\n`, "utf8");
    } catch {
      // Best-effort logging only.
    }
  }

  private redactDebugPayload(payload: unknown): unknown {
    if (Array.isArray(payload)) {
      return payload.map((item) => this.redactDebugPayload(item));
    }

    if (!payload || typeof payload !== "object") {
      return payload;
    }

    const entries = Object.entries(payload as Record<string, unknown>).map(([key, value]) => {
      if (/api[_-]?key|authorization/i.test(key)) {
        return [key, "[REDACTED]"];
      }

      return [key, this.redactDebugPayload(value)];
    });

    return Object.fromEntries(entries);
  }
}
