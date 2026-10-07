import mongoose, { Document, Schema } from "mongoose";

export interface IEvent extends Document {
  tenantId: string;
  sourceId: string;
  eventId: string;
  externalJobId: string;
  version: number;
  operation: "upsert" | "archive";

  payload?: {
    title: string;
    company: string;
    location: string;
    experienceMin: number;
    experienceMax: number;
    applyUrl: string;
    skills: string[];
  };

  status: "accepted" | "processing" | "completed" | "failed";
  attempts: number;

  // Worker state
  claimedBy?: string;
  leaseUntil?: Date;
  nextAttemptAt?: Date;
  processedAt?: Date;

  // Retry history
  attemptHistory?: {
    attempt: number;
    startedAt: Date;
    finishedAt?: Date;
    outcome: "success" | "retryable" | "permanent";
    error?: string;
  }[];

  lastError?: string;

  createdAt: Date;
  updatedAt: Date;
}

const eventSchema = new Schema<IEvent>(
  {
    tenantId: {
      type: String,
      required: true,
    },

    sourceId: {
      type: String,
      required: true,
    },

    eventId: {
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

    operation: {
      type: String,
      enum: ["upsert", "archive"],
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

    status: {
      type: String,
      enum: ["accepted", "processing", "completed", "failed"],
      default: "accepted",
    },

    attempts: {
      type: Number,
      default: 0,
    },

    // Worker state
    claimedBy: {
      type: String,
    },

    leaseUntil: {
      type: Date,
    },

    nextAttemptAt: {
      type: Date,
    },

    processedAt: {
      type: Date,
    },

    // Retry history
    attemptHistory: [
      {
        attempt: {
          type: Number,
          required: true,
        },

        startedAt: {
          type: Date,
          required: true,
        },

        finishedAt: {
          type: Date,
        },

        outcome: {
          type: String,
          enum: ["success", "retryable", "permanent"],
          required: true,
        },

        error: {
          type: String,
        },
      },
    ],

    lastError: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

eventSchema.index(
  {
    tenantId: 1,
    sourceId: 1,
    eventId: 1,
  },
  {
    unique: true,
  },
);

export const Event = mongoose.model<IEvent>("Event", eventSchema);
