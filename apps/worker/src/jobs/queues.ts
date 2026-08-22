export const QUEUES = {
  discovery: "discovery",
  enrichment: "enrichment",
  enrichmentSweep: "enrichment-sweep",
  dmGeneration: "dm-generation",
  dmSweep: "dm-sweep",
  emailSequencer: "email-sequencer",
  emailSend: "email-send",
  inboxWatcher: "inbox-watcher",
  classifier: "classifier",
  housekeeping: "housekeeping",
  housekeepingMonthly: "housekeeping-monthly",
} as const;
