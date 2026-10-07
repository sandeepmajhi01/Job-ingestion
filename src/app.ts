import express from "express";
import eventRoutes from "./modules/events/event.routes.js";
import jobRoutes from "./modules/jobs/job.routes.js";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
  });
});

app.use("/events", eventRoutes);
app.use("/jobs", jobRoutes);


export default app;
