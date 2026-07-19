import {
  ExecuteStreamResponse,
  NPC_PLACEHOLDER_AGENT,
  SSE_EVENTS,
} from '@llmrpg/shared';

export interface ToolCallEvent {
  phase: 'started' | 'completed';
  id: string;
  toolName: string;
}

export interface AgentStreamHandlers {
  onThinking?: (message: string) => void;
  onPartial?: (content: string, isIncremental: boolean) => void;
  onToolCall?: (event: ToolCallEvent) => void;
  onCompleted?: (response: string) => void;
  onError?: (error: string) => void;
}

function parseSseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Open EventSource on a prebuilt same-origin sseUrl and dispatch SkillShop SSE events.
 * Returns a dispose function that closes the EventSource.
 */
export function listenAgentStream(
  sseUrl: string,
  handlers: AgentStreamHandlers,
): () => void {
  let eventSource: EventSource | null = null;
  let disposed = false;

  const dispose = (): void => {
    disposed = true;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };

  const fail = (error: string): void => {
    handlers.onError?.(error);
    dispose();
  };

  try {
    eventSource = new EventSource(sseUrl);

    const listen = (eventName: string, handler: (payload: unknown) => void): void => {
      eventSource?.addEventListener(eventName, (event: Event) => {
        const messageEvent = event as MessageEvent<string>;
        const payload = parseSseJson(messageEvent.data);
        if (payload === null) {
          fail(`Failed to parse SSE event: ${eventName}`);
          return;
        }
        handler(payload);
      });
    };

    listen(SSE_EVENTS.EXECUTION_STARTED, () => {
      // Connection established; no UI action required.
    });

    listen(SSE_EVENTS.HEARTBEAT, () => {
      // Keep-alive; ignore.
    });

    listen(SSE_EVENTS.THINKING, (payload) => {
      const record = asRecord(payload);
      const thinkingMessage = record ? readString(record, 'message') : undefined;
      if (thinkingMessage !== undefined) {
        handlers.onThinking?.(thinkingMessage);
      }
    });

    listen(SSE_EVENTS.PARTIAL_RESPONSE, (payload) => {
      const record = asRecord(payload);
      if (!record) return;
      const content = readString(record, 'content');
      if (content === undefined) return;
      const isIncremental = record['isIncremental'] === true;
      handlers.onPartial?.(content, isIncremental);
    });

    listen(SSE_EVENTS.TOOL_CALL_STARTED, (payload) => {
      const record = asRecord(payload);
      if (!record) return;
      const id = readString(record, 'id');
      const toolName = readString(record, 'toolName');
      if (id && toolName) {
        handlers.onToolCall?.({ phase: 'started', id, toolName });
      }
    });

    listen(SSE_EVENTS.TOOL_CALL_COMPLETED, (payload) => {
      const record = asRecord(payload);
      if (!record) return;
      const id = readString(record, 'id');
      const toolName = readString(record, 'toolName');
      if (id && toolName) {
        handlers.onToolCall?.({ phase: 'completed', id, toolName });
      }
    });

    listen(SSE_EVENTS.EXECUTION_COMPLETED, (payload) => {
      const record = asRecord(payload);
      const result = record ? asRecord(record['result']) : null;
      const responseText = result ? readString(result, 'response') : undefined;
      handlers.onCompleted?.(responseText ?? '');
      dispose();
    });

    listen(SSE_EVENTS.EXECUTION_ERROR, (payload) => {
      const record = asRecord(payload);
      const error = record ? readString(record, 'error') : undefined;
      fail(error ?? 'Unknown execution error');
    });

    eventSource.onerror = () => {
      if (disposed) return;
      fail('SSE connection error');
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(msg);
  }

  return dispose;
}

/**
 * POST /api/agent/execute-stream, then open EventSource on the returned sseUrl.
 * Returns a dispose function that closes the EventSource.
 *
 * @param agentName SkillShop agent to invoke (defaults to Phase 0 Bram placeholder).
 */
export function executeAgentStream(
  message: string,
  handlers: AgentStreamHandlers,
  agentName: string = NPC_PLACEHOLDER_AGENT,
): () => void {
  let disposeStream: (() => void) | null = null;
  let disposed = false;

  const dispose = (): void => {
    disposed = true;
    disposeStream?.();
    disposeStream = null;
  };

  const fail = (error: string): void => {
    handlers.onError?.(error);
    dispose();
  };

  void (async () => {
    try {
      const response = await fetch('/api/agent/execute-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName,
          message,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        fail(text || `Request failed (${response.status})`);
        return;
      }

      const body = (await response.json()) as ExecuteStreamResponse;
      if (!body.success || !body.data?.sseUrl) {
        fail('execute-stream returned unsuccessful response');
        return;
      }

      if (disposed) return;

      disposeStream = listenAgentStream(body.data.sseUrl, handlers);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(msg);
    }
  })();

  return dispose;
}
