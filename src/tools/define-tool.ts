import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { LoopTool, ToolExecutionMode } from '../types/tool.js';

export interface DefineLoopToolOptions<TSchema extends z.ZodTypeAny> {
  name: string;
  description: string;
  schema?: TSchema;
  executionMode?: ToolExecutionMode;
  requiresApproval?: boolean;
  execute?: (args: z.infer<TSchema>, ctx: { toolCallId: string; signal?: AbortSignal; iteration: number }) => Promise<unknown> | unknown;
}

export function defineLoopTool<TSchema extends z.ZodTypeAny>(
  options: DefineLoopToolOptions<TSchema>
): LoopTool<TSchema> {
  let parameters: Record<string, unknown> = {
    type: 'object',
    properties: {},
  };

  if (options.schema) {
    const rawSchema = zodToJsonSchema(options.schema, {
      name: options.name,
      target: 'openAi',
      $refStrategy: 'none',
    }) as Record<string, unknown>;

    // 剔除顶层 $schema 描述，保留标准 JSON Schema 结构
    const { $schema, ...cleanParameters } = rawSchema;
    parameters = cleanParameters;
  }

  return {
    name: options.name,
    description: options.description,
    schema: options.schema,
    executionMode: options.executionMode ?? 'local',
    requiresApproval: options.requiresApproval ?? false,
    execute: options.execute,
    definition: {
      name: options.name,
      description: options.description,
      parameters,
    },
  };
}
