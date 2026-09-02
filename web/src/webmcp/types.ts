export type WebMcpToolAnnotations = {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
};

export type WebMcpTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  annotations?: WebMcpToolAnnotations;
  execute: (input: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
};

export type WebMcpModelContext = {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ) => Promise<void>;
};

declare global {
  interface Document {
    readonly modelContext?: WebMcpModelContext;
  }
}
