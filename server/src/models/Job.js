import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const JobSchema = new Schema(
  {
    name: { type: String, index: true }, // e.g., "scrape:Jefferson"
    startedAt: Date,
    finishedAt: Date,
    status: { type: String, enum: ['success','failed'], index: true },
    counts: Schema.Types.Mixed,
    error: String
  },
  { timestamps: true }
);

export default model('Job', JobSchema);