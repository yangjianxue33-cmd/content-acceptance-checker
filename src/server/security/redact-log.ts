const durationBands = new Set([
  "under_1s",
  "1s_to_5s",
  "5s_to_30s",
  "over_30s",
]);
const outcomes = new Set(["success", "partial", "failed"]);
const reasonCodes = new Set([
  "scheduled",
  "storage_retry",
  "database_retry",
  "unexpected_failure",
]);

export type LogEventName =
  | "retention_cleanup_completed"
  | "retention_cleanup_failed";

export type ApprovedLogMetadata = {
  count?: number;
  durationBand?: "under_1s" | "1s_to_5s" | "5s_to_30s" | "over_30s";
  outcome?: "success" | "partial" | "failed";
  reasonCode?:
    | "scheduled"
    | "storage_retry"
    | "database_retry"
    | "unexpected_failure";
};

const supportedEvents = new Set<LogEventName>([
  "retention_cleanup_completed",
  "retention_cleanup_failed",
]);

export function serializeLogEvent(
  event: LogEventName,
  metadata: ApprovedLogMetadata,
) {
  if (!supportedEvents.has(event)) {
    throw new Error("Unsupported log event");
  }

  const safe: Record<string, string | number> = { event };
  if (
    typeof metadata.count === "number" &&
    Number.isSafeInteger(metadata.count) &&
    metadata.count >= 0
  ) {
    safe.count = metadata.count;
  }
  if (
    typeof metadata.durationBand === "string" &&
    durationBands.has(metadata.durationBand)
  ) {
    safe.durationBand = metadata.durationBand;
  }
  if (typeof metadata.outcome === "string" && outcomes.has(metadata.outcome)) {
    safe.outcome = metadata.outcome;
  }
  if (
    typeof metadata.reasonCode === "string" &&
    reasonCodes.has(metadata.reasonCode)
  ) {
    safe.reasonCode = metadata.reasonCode;
  }

  return JSON.stringify(safe);
}

export function writeLogEvent(
  event: LogEventName,
  metadata: ApprovedLogMetadata,
  write: (serialized: string) => void = console.info,
) {
  write(serializeLogEvent(event, metadata));
}
