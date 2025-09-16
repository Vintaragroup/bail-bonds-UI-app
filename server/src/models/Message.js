import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const E164 = /^\+?[1-9]\d{1,14}$/; // loose E.164 validator

const MessageSchema = new Schema(
  {
    // Linkage
    caseId:    { type: Schema.Types.ObjectId, ref: 'Case', index: true },
    personId:  { type: Schema.Types.ObjectId, ref: 'Person', index: true },

    // Direction & channel
    direction: { type: String, enum: ['out', 'in'], index: true },
    channel:   { type: String, enum: ['sms', 'voice'], index: true },

    // Endpoints (E.164 for sms/voice)
    to:   { type: String, match: E164, index: true, sparse: true },
    from: { type: String, match: E164, index: true, sparse: true },

    // Content
    body: { type: String },

    // State
    status: {
      type: String,
      enum: ['queued', 'sending', 'sent', 'delivered', 'failed'],
      index: true,
      default: 'queued',
    },
    attempts:   { type: Number, default: 0, min: 0 },
    scheduledAt:{ type: Date },
    sentAt:     { type: Date, index: true },
    deliveredAt:{ type: Date, index: true },
    readAt:     { type: Date },

    // Provider details / diagnostics
    provider:          { type: String },          // e.g., 'twilio'
    providerMessageId: { type: String, index: true, sparse: true },
    errorCode:         { type: String },
    errorMessage:      { type: String },

    // Extra payload for future-proofing
    meta: Schema.Types.Mixed,
  },
  { timestamps: true }
);

// Useful virtual: time to delivery (ms)
MessageSchema.virtual('deliveryMs').get(function () {
  if (!this.sentAt || !this.deliveredAt) return null;
  return new Date(this.deliveredAt) - new Date(this.sentAt);
});

// Indexes for common dashboards/queries
MessageSchema.index({ caseId: 1, createdAt: -1 });
MessageSchema.index({ personId: 1, createdAt: -1 });
MessageSchema.index({ status: 1, channel: 1, createdAt: -1 });
MessageSchema.index({ direction: 1, channel: 1, createdAt: -1 });
MessageSchema.index({ sentAt: -1 });
MessageSchema.index({ deliveredAt: -1 });
// Full-text search on body (optional but handy)
MessageSchema.index({ body: 'text' });

export default model('Message', MessageSchema);