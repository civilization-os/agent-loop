import type { LoopToolDefinition } from '../types/model.js';
import type { LoopTool } from '../types/tool.js';

export class ToolRegistry {
  private readonly tools = new Map<string, LoopTool>();

  constructor(tools?: LoopTool[]) {
    if (tools) {
      this.registerAll(tools);
    }
  }

  public register(tool: LoopTool): void {
    this.tools.set(tool.name, tool);
  }

  public registerAll(tools: LoopTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  public get(name: string): LoopTool | undefined {
    return this.tools.get(name);
  }

  public has(name: string): boolean {
    return this.tools.has(name);
  }

  public getAllDefinitions(): LoopToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  public listTools(): LoopTool[] {
    return Array.from(this.tools.values());
  }
}
