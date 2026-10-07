import mongoose, { Document, Schema } from "mongoose";

export interface IJob extends Document {
  tenantId: string;
  sourceId: string;
  externalJobId: string;

  version: number;

  status: "active" | "archived";

  payload?: {
    title: string;
    company: string;
    location: string;
    experienceMin: number;
    experienceMax: number;
    applyUrl: string;
    skills: string[];
  };

  createdAt: Date;
  updatedAt: Date;
}

const jobSchema = new Schema<IJob>(
  {
    tenantId: {
      type: String,
      required: true,
    },

    sourceId: {
      type: String,
      required: true,
    },

    externalJobId: {
      type: String,
      required: true,
    },

    version: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["active", "archived"],
      required: true,
    },

    payload: {
      title: String,
      company: String,
      location: String,
      experienceMin: Number,
      experienceMax: Number,
      applyUrl: String,
      skills: [String],
    },
  },
  {
    timestamps: true,
  },
);

// Job identity
jobSchema.index(
  {
    tenantId: 1,
    sourceId: 1,
    externalJobId: 1,
  },
  {
    unique: true,
  },
);

// Useful for GET /jobs
jobSchema.index({
  tenantId: 1,
  sourceId: 1,
  status: 1,
  _id: 1,
});

export const Job = mongoose.model<IJob>("Job", jobSchema);
