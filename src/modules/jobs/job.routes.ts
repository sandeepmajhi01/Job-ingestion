import { Router } from "express";
import { getJobs } from "./job.controller.js";

const router = Router();

router.get("/", getJobs);

export default router;
