/**
 * MCP (Model Context Protocol) Client Manager.
 *
 * Manages connections to MCP stdio servers, discovers available tools,
 * and executes tool calls on behalf of the AI.
 *
 * Usage:
 *   const mcpManager = createMcpManager();
 *   await mcpManager.connectServers(mcpConfigs);
 *   const mcpTools = await mcpManager.listTools();  // [{ id, label, description, ... }]
 *   const result = await mcpManager.callTool(serverName, toolName, args);
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Create an MCP connection manager.
 * @returns {{ connectServers: Function, disconnectAll: Function, listTools: Function, getServerNames: Function, callTool: Function, isConnected: Function }}
 */
export function createMcpManager() {
  /** @type {Map<string, { client: Client, transport: StdioClientTransport, config: object, tools: Array }>} */
  const connections = new Map();

  /**
   * Connect to a list of MCP server configurations.
   * Each config: { name, command, args?, env?, disabled? }
   *
   * @param {Array<{ name: string, command: string, args?: string[], env?: Record<string,string>, disabled?: boolean }>} serverConfigs
   */
  async function connectServers(serverConfigs = []) {
    for (const config of serverConfigs) {
      if (config.disabled) continue;
      if (connections.has(config.name)) continue;

      try {
        const client = new Client(
          { name: 'claude-web-mcp', version: '1.0.0' },
          { capabilities: {} }
        );

        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: config.env || undefined,
          stderr: 'pipe'
        });

        // Handle stderr for debugging
        transport.stderr?.on('data', (chunk) => {
          const msg = chunk.toString().trim();
          if (msg) console.log(`[MCP:${config.name}] ${msg}`);
        });

        await client.connect(transport);
        console.log(`[MCP] connected: ${config.name} (${config.command})`);

        // List available tools
        let tools = [];
        try {
          const result = await client.listTools();
          tools = (result.tools || []).map(t => ({
            name: t.name,
            description: t.description || '',
            inputSchema: t.inputSchema || null
          }));
          console.log(`[MCP] ${config.name}: ${tools.length} tools available`);
        } catch (e) {
          console.warn(`[MCP] ${config.name}: listTools failed: ${e.message}`);
        }

        connections.set(config.name, {
          client,
          transport,
          config,
          tools
        });
      } catch (e) {
        console.warn(`[MCP] failed to connect ${config.name}: ${e.message}`);
      }
    }
  }

  /**
   * Disconnect all MCP servers.
   */
  async function disconnectAll() {
    for (const [name, conn] of connections) {
      try {
        await conn.client.close();
        console.log(`[MCP] disconnected: ${name}`);
      } catch (e) {
        console.warn(`[MCP] error disconnecting ${name}: ${e.message}`);
      }
    }
    connections.clear();
  }

  /**
   * Get all available tools from all connected MCP servers.
   * @returns {Array<{ id: string, label: string, description: string, serverName: string, inputSchema: object|null, instruction: string }>}
   */
  async function listTools() {
    const allTools = [];
    for (const [serverName, conn] of connections) {
      try {
        const result = await conn.client.listTools();
        const tools = (result.tools || []).map(t => ({
          id: `mcp_${serverName}_${t.name}`,
          label: `${serverName}: ${t.name}`,
          description: t.description || `MCP tool from ${serverName}`,
          icon: 'inbox',
          serverName,
          toolName: t.name,
          inputSchema: t.inputSchema || null,
          configured: true,
          instruction: `You have access to the MCP tool "${t.name}" from server "${serverName}". ${t.description ? t.description : ''}`
        }));
        allTools.push(...tools);
      } catch (e) {
        console.warn(`[MCP] ${serverName}: listTools failed: ${e.message}`);
      }
    }
    return allTools;
  }

  /**
   * Get list of connected server names.
   * @returns {string[]}
   */
  function getServerNames() {
    return [...connections.keys()];
  }

  /**
   * Call a tool on an MCP server.
   * @param {string} serverName
   * @param {string} toolName
   * @param {object} args
   * @returns {Promise<object>}
   */
  async function callTool(serverName, toolName, args = {}) {
    const conn = connections.get(serverName);
    if (!conn) {
      throw new Error(`MCP server "${serverName}" not connected`);
    }

    try {
      const result = await conn.client.callTool({
        name: toolName,
        arguments: args
      });

      // MCP tool results are an array of content items
      const content = result.content || [];
      const textParts = content.map(c => {
        if (c.type === 'text') return c.text;
        if (c.type === 'resource') return JSON.stringify(c.resource);
        return JSON.stringify(c);
      });

      return {
        content: textParts.join('\n'),
        isError: result.isError || false
      };
    } catch (e) {
      console.error(`[MCP] ${serverName}/${toolName} failed: ${e.message}`);
      return {
        content: `Error calling MCP tool "${toolName}": ${e.message}`,
        isError: true
      };
    }
  }

  /**
   * Check if any MCP servers are connected.
   * @returns {boolean}
   */
  function isConnected() {
    return connections.size > 0;
  }

  return { connectServers, disconnectAll, listTools, getServerNames, callTool, isConnected };
}
