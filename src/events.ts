/**
 * Wire event types emitted on WebAgent run SSE streams (Do Anything, Deep
 * Research, Web Search, Track). These mirror the backend `EventType` enum
 * (`domain/event/types.py`): the type is carried in the run envelope's `type`
 * field, and the product `events()` iterators surface it as `event.event`, so
 * you can match `event.event` against these constants. `RUN_COMPLETED` is the
 * single terminal event for a run — its outcome (`terminal_reason`,
 * `is_task_successful`, `output`) is in the event payload.
 */
export const EAKEventTypes = {
  RUN_STATUS_CHANGED: "run.status_changed",
  RUN_INPUT_REQUEST: "run.input_request",
  RUN_INPUT_REQUEST_RESOLVED: "run.input_request_resolved",
  RUN_MESSAGE: "run.message",
  RUN_ACTION_STARTED: "run.action.started",
  RUN_ACTION_COMPLETED: "run.action.completed",
  RUN_ACTION_FAILED: "run.action.failed",
  RUN_ACTION_PROGRESS: "run.action.progress",
  RUN_ACTION_RESULT: "run.action_result",
  RUN_SCREENSHOT: "run.screenshot",
  RUN_COST_UPDATE: "run.cost_update",
  RUN_PLAN_READY: "run.plan_ready",
  RUN_PLAN_FINALIZED: "run.plan_finalized",
  RUN_SUBTASK_STARTED: "run.subtask_started",
  RUN_SUBTASK_GRADED: "run.subtask_graded",
  RUN_SUBTASK_STATUS: "run.subtask_status",
  RUN_TODOS_UPDATED: "run.todos_updated",
  RUN_BROWSER_LIVE_URL_CHANGED: "run.browser_live_url_changed",
  RUN_BROWSER_AGENT_VISION_DECISION: "run.browser_agent.vision_decision",
  RUN_TAKE_CONTROL_PENDING: "run.take_control_pending",
  RUN_COMPLETED: "run.completed",
  // Deep Research / Web Search / Track streams also emit product-specific
  // `run.*` events (e.g. run.phase_changed, run.section_started,
  // run.monitor_created). See the backend EventType enum for the full set.
} as const;

export type EAKEventType = (typeof EAKEventTypes)[keyof typeof EAKEventTypes];
