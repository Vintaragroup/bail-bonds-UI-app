import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const LocationSchema = new Schema(
  {
    lat: { type: Number },
    lng: { type: Number },
    accuracy: { type: Number },
  },
  { _id: false }
);

const CheckInSchema = new Schema(
  {
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', index: true },
    person: { type: String, required: true },
    county: { type: String, index: true },
    dueAt: { type: Date, required: true, index: true },
    method: { type: String, enum: ['sms', 'call', 'app'], default: 'sms' },
    status: { type: String, enum: ['pending', 'overdue', 'done'], default: 'pending', index: true },
    note: { type: String },
    contactCount: { type: Number, default: 0 },
    lastContactAt: { type: Date },
    location: { type: LocationSchema, default: null },
    meta: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
  }
);

CheckInSchema.index({ status: 1, dueAt: 1 });

const CheckIn = model('CheckIn', CheckInSchema);
export default CheckIn;
