/**
 * SkillShop SSE event names the Phase 0 client consumes
 * (see skill-shop/docs/technical/AGENT_SSE_EVENTS.md).
 *
 * Flow: POST /api/agent/execute-stream -> { data: { executionId, sseUrl } }
 * then GET sseUrl (EventSource) and listen for these named events.
 */
export const SSE_EVENTS = {
  EXECUTION_STARTED: 'execution_started',
  THINKING: 'thinking',
  PARTIAL_RESPONSE: 'partial_response',
  TOOL_CALL_STARTED: 'tool_call_started',
  TOOL_CALL_COMPLETED: 'tool_call_completed',
  EXECUTION_COMPLETED: 'execution_completed',
  EXECUTION_ERROR: 'execution_error',
  HEARTBEAT: 'heartbeat',
} as const;

export interface ExecuteStreamResponse {
  success: boolean;
  data: {
    executionId: string;
    streamId: string;
    sseUrl: string;
    statusUrl: string;
    status: string;
  };
}
