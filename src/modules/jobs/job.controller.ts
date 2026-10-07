import { Request, Response } from "express";
import mongoose from "mongoose";
import { Job } from "../../model/job.model.js";

export async function getJobs(req: Request, res: Response): Promise<void> {
  const { tenantId, sourceId, status } = req.query;

  if (!tenantId || !sourceId) {
    res.status(400).json({
      message: "tenantId and sourceId are required",
    });
    return;
  }

  const requestedLimit = Number(req.query.limit) || 20;
  const limit = Math.min(Math.max(requestedLimit, 1), 100);

  const filter: Record<string, unknown> = {
    tenantId: String(tenantId),
    sourceId: String(sourceId),

    // Assignment requirement: default status is active
    status: status === "archived" ? "archived" : "active",
  };

  const cursor = req.query.cursor;

  if (cursor) {
    if (!mongoose.Types.ObjectId.isValid(String(cursor))) {
      res.status(400).json({
        message: "Invalid cursor",
      });
      return;
    }

    filter._id = {
      $gt: new mongoose.Types.ObjectId(String(cursor)),
    };
  }

  const jobs = await Job.find(filter)
    .sort({ _id: 1 })
    .limit(limit + 1);

  const hasNextPage = jobs.length > limit;

  if (hasNextPage) {
    jobs.pop();
  }

  const nextCursor =
    hasNextPage && jobs.length > 0
      ? jobs[jobs.length - 1]._id.toString()
      : null;

  res.status(200).json({
    jobs,
    count: jobs.length,
    nextCursor,
  });
}
