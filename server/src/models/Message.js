import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const MessageSchema = new Schema(
  {
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', index: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person' },
    direction: { type: String, enum: ['out', 'in'], index: true },
    channel: { type: String, enum: ['sms', 'voice'], index: true },
    body: String,
    status: { type: String, index: true }, // queued|sent|delivered|failed
    sentAt: { type: Date, index: true },
    deliveredAt: Date,
    providerMessageId: String
  },
  { timestamps: true }
);

export default model('Message', MessageSchema);