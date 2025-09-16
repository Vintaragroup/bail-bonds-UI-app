import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const JobSchema = new Schema(
  {
    // Identifiers / scoping
    name: { type: String, index: true },            // e.g., "normalize:harris" or "scrape:jefferson"
    kind: { type: String, index: true },            // e.g., "normalize" | "scrape" | "audit"
    county: { type: String, index: true, lowercase: true, trim: true },
    source: { type: String, index: true },          // e.g., source collection name

    // Lifecycle
    status: {
      type: String,
      enum: ['queued', 'running', 'success', 'failed'],
      index: true,
      default: 'queued',
    },
    queuedAt:   { type: Date, default: Date.now, index: true },
    startedAt:  { type: Date, index: true },
    finishedAt: { type: Date, index: true },

    // Attempts + result metrics
    attempts: { type: Number, default: 0, min: 0 },
    counts:   Schema.Types.Mixed,                    // e.g., { seen, inserted, updated }

    // Error info
    error: String,
    errorCode: String,
  },
  { timestamps: true }
);

// Useful derived metric (ms) — null until started
JobSchema.virtual('durationMs').get(function () {
  const start = this.startedAt || this.createdAt;
  const end = this.finishedAt || Date.now();
  return start ? (new Date(end) - new Date(start)) : null;
});

// Indexes that help list/monitor jobs efficiently
JobSchema.index({ status: 1, queuedAt: 1 });
JobSchema.index({ kind: 1, status: 1, createdAt: -1 });
JobSchema.index({ county: 1, createdAt: -1 });
JobSchema.index({ finishedAt: -1 });

export default model('Job', JobSchema);