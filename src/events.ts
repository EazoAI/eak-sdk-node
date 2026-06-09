export const EAKEventTypes = {
  DO_ANYTHING_REASONING_DELTA: "reasoning_delta",
  DO_ANYTHING_ACTION: "action",
  DO_ANYTHING_OBSERVATION: "observation",
  /** Per-step still screenshot — distinct from the continuous video stream.
   * Carries an artifact reference; fetch the image via `doAnything.readArtifacts`. */
  DO_ANYTHING_SCREENSHOT: "screenshot",
  /** Continuous browser video stream (live frames), distinct from screenshots. */
  DO_ANYTHING_BROWSER_VIDEO_FRAME: "browser_video_frame",
  DO_ANYTHING_USER_ACTION_REQUIRED: "user_action_required",
  DO_ANYTHING_ARTIFACT: "artifact",
  DO_ANYTHING_GUMEM_WRITE_PROPOSED: "gumem_write_proposed",
  DO_ANYTHING_FINAL: "final",
  WEB_SEARCH_RESULT: "web_search_result",
  TRACK_EVENT: "track_event",
} as const;

export type EAKEventType = (typeof EAKEventTypes)[keyof typeof EAKEventTypes];
