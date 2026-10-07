import { Request, Response } from "express";
import { eventSchema } from "./event.validation.js";
import { createEventService } from "./event.service.js";
import { Event as EventModel } from "../../model/event.model.js";

export async function createEvent(
  req: Request,
  res: Response,
): Promise<void> {
  const validationResult = eventSchema.safeParse(req.body);

  if (!validationResult.success) {
    res.status(400).json({
      message: "Invalid event",
      errors: validationResult.error.issues,
    });

    return;
  }

  try {
    const serviceResult = await createEventService(
      validationResult.data,
    );

    if (serviceResult.status === "replay") {
      res.status(200).json({
        message: "Event already accepted",
        event: serviceResult.event,
      });

      return;
    }

    res.status(202).json({
      message: "Event accepted",
      event: serviceResult.event,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "EVENT_CONFLICT"
    ) {
      res.status(409).json({
        message: "Event identity already exists with different content",
      });

      return;
    }

    console.error(error);

    res.status(500).json({
      message: "Internal server error",
    });
  }
}

export async function getEvent(
  req: Request,
  res: Response,
): Promise<void> {
  const { eventId } = req.params;
  const { tenantId, sourceId } = req.query;

  if (!tenantId || !sourceId) {
    res.status(400).json({
      message: "tenantId and sourceId are required",
    });
    return;
  }

  const event = await EventModel.findOne({
    tenantId: String(tenantId),
    sourceId: String(sourceId),
    eventId: String(eventId),
  });

  if (!event) {
    res.status(404).json({
      message: "Event not found",
    });
    return;
  }

  res.status(200).json({
    event,
  });
}
