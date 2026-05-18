export const EAKEventTypes = {
  DO_ANYTHING_REASONING_DELTA: "reasoning_delta",
  DO_ANYTHING_ACTION: "action",
  DO_ANYTHING_OBSERVATION: "observation",
  DO_ANYTHING_BROWSER_VIDEO_FRAME: "browser_video_frame",
  DO_ANYTHING_USER_ACTION_REQUIRED: "user_action_required",
  DO_ANYTHING_ARTIFACT: "artifact",
  DO_ANYTHING_GUMEM_WRITE_PROPOSED: "gumem_write_proposed",
  DO_ANYTHING_FINAL: "final",
  WEB_SEARCH_RESULT: "web_search_result",
  TRACK_EVENT: "track_event",
} as const;

export type EAKEventType = (typeof EAKEventTypes)[keyof typeof EAKEventTypes];
