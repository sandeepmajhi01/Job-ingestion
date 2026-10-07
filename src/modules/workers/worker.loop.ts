import { processNextEvent } from "./event.worker.js";

const WORKER_COUNT = 2;
const POLL_INTERVAL_MS = 500;

async function workerLoop(workerNumber: number): Promise<void> {
  console.log(`Worker ${workerNumber} started`);

  while (true) {
    try {
      await processNextEvent();
    } catch (error) {
      console.error(`Worker ${workerNumber} error:`, error);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, POLL_INTERVAL_MS),
    );
  }
}

export function startWorkers(): void {
  for (let i = 1; i <= WORKER_COUNT; i++) {
    void workerLoop(i);
  }
}
