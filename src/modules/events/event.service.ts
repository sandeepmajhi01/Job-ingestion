import { Event } from "../../model/event.model.js";
import type { CreateEventInput } from "./event.validation.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;

    return Object.keys(object)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalize(object[key]);
        return result;
      }, {});
  }

  return value;
}

function eventsAreEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

export async function createEventService(
  data: CreateEventInput,
): Promise<{
  status: "created" | "replay";
  event: unknown;
}> {
  const existing = await Event.findOne({
    tenantId: data.tenantId,
    sourceId: data.sourceId,
    eventId: data.eventId,
  });

  if (existing) {
    const existingData = {
      tenantId: existing.tenantId,
      sourceId: existing.sourceId,
      eventId: existing.eventId,
      externalJobId: existing.externalJobId,
      version: existing.version,
      operation: existing.operation,
      payload: existing.payload,
    };

    if (JSON.stringify(existingData) === JSON.stringify(data)) {
      return {
        status: "replay",
        event: existing,
      };
    }

    throw new Error("EVENT_CONFLICT");
  }

  try {
    const event = await Event.create(data);

    return {
      status: "created",
      event,
    };
  } catch (error: unknown) {
    // Another concurrent request may have inserted the same event
    // after our findOne() check.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
    ) {
      const concurrent = await Event.findOne({
        tenantId: data.tenantId,
        sourceId: data.sourceId,
        eventId: data.eventId,
      });

      if (!concurrent) {
        throw error;
      }

      const concurrentData = {
        tenantId: concurrent.tenantId,
        sourceId: concurrent.sourceId,
        eventId: concurrent.eventId,
        externalJobId: concurrent.externalJobId,
        version: concurrent.version,
        operation: concurrent.operation,
        payload: concurrent.payload,
      };

      if (JSON.stringify(concurrentData) === JSON.stringify(data)) {
        return {
          status: "replay",
          event: concurrent,
        };
      }

      throw new Error("EVENT_CONFLICT");
    }

    throw error;
  }
}
