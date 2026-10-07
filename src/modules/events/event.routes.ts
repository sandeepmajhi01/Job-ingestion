import { Router } from "express";
import { createEvent, getEvent} from "./event.controller.js";
import { processNextEvent } from "../workers/event.worker.js";
import { verifyJob } from "../provider/provider.service.js";


const router = Router();

router.post("/", createEvent);
router.get("/:eventId", getEvent);

// router.post("/process-test", async (_req, res) => {
//   await processNextEvent();

//   res.status(200).json({
//     message: "Worker processed one event",
//   });
// });

// router.get("/provider-test/:eventId/:attempt", async (req, res) => {
//   const result = await verifyJob(
//     req.params.eventId,
//     Number(req.params.attempt),
//   );

//   res.status(200).json(result);
// });

// router.post("/claim-test", async (_req, res) => {
//   const { claimNextEvent } = await import("../workers/event.worker.js");

//   const event = await claimNextEvent();

//   res.status(200).json({
//     event,
//   });
// });



export default router;
