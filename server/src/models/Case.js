import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const CaseSchema = new Schema(
  {
    personId: { type: Schema.Types.ObjectId, ref: 'Person' },
    personName: { type: String, index: true }, // quick display; can denormalize
    county: { type: String, index: true },
    warrantNumber: String,
    bond: {
      amount: { type: Number, index: true },
      type: String,
      posted: Boolean,
      postedAt: Date,
    },
    status: { type: String, enum: ['open', 'active', 'closed', 'revoked'], index: true },
    bookedAt: { type: Date, index: true },
    nextCourt: { date: Date, room: String, judge: String },
    risk: { missedCheckins: Number, overduePayments: Number, benchWarrant: Boolean },
    bondAssessment: { value: Number }, // optional ML score
  },
  { timestamps: true }
);

export default model('Case', CaseSchema);