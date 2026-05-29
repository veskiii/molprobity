import { exec, execSync } from "child_process";
import { appendFile, copyFile, mkdtemp, rm } from "fs/promises";
import { hostname, tmpdir } from "os";
import path from "path";
import { Queue, Worker, type ConnectionOptions } from "bullmq";

const USER_DATA = `/user_data`;
const TIMING_LOG_FILE = "molprobity_timing.log";
const CONTAINER_ID = hostname();
const ONELINE_HEADERS = [
  "pdbFileName",
  "x-H_type",
  "chains",
  "residues",
  "nucacids",
  "resolution",
  "rvalue",
  "rfree",
  "clashscore",
  "clashscoreB<40",
  "minresol",
  "maxresol",
  "n_samples",
  "pct_rank",
  "pct_rank40",
  "numbadbonds",
  "numbonds",
  "pct_badbonds",
  "pct_resbadbonds",
  "numbadangles",
  "numangles",
  "pct_badangles",
  "pct_resbadangles",
  "chiralSwaps",
  "tetraOutliers",
  "pseudochiralErrors",
  "waterClashes",
  "totalWaters",
  "numPperpOutliers",
  "numPperp",
  "numSuiteOutliers",
  "numSuites",
];
const RESIDUE_HEADERS = [
  "file_name",
  "x-H_type",
  "residue",
  "res_high_B",
  "mc_high_B",
  "worst_clash",
  "src_atom",
  "dst_atom",
  "dst_residue",
  "pucker_outlier_type",
  "implied_pucker",
  "suitename",
  "d-1dg_bin",
  "triage",
  "suiteness",
  "num_length_out",
  "worst_length",
  "worst_length_value",
  "worst_length_sigma",
  "num_angle_out",
  "worst_angle",
  "worst_angle_value",
  "worst_angle_sigma",
  "outlier_count",
  "outlier_count_sep_geom",
];

export const redisConnection: ConnectionOptions = {
  host: process.env.REDIS_HOST ?? "redis",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

export const molprobityOnelineQueueName = "molprobity-oneline";

export const molprobityOnelineQueue = new Queue<{ filename: string }>(molprobityOnelineQueueName, {
  connection: redisConnection,
});

export function createMolprobityWorker(connection: ConnectionOptions = redisConnection) {
  return new Worker<{ filename: string }, string>(
    molprobityOnelineQueueName,
    async (job: { data: { filename: string } }) => runOnelineAnalysys(job.data.filename),
    {
      connection,
      concurrency: Number(process.env.MOLPROBITY_WORKER_CONCURRENCY ?? 1),
    },
  );
}

async function handler(command: string): Promise<string[]> {
  const out = await new Promise<string>((resolve, reject) => {
    exec(command, { encoding: "utf-8" }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout ?? "");
    });
  });
  const splt: string[] = out.split(/\r?\n/).filter((line: string) => line !== "");
  return splt;
}

function getDurationMs(startMs: number): number {
  return Date.now() - startMs;
}

function normalizeRelativePath(filename: string): string {
  return filename.replace(/\\/g, "/").replace(/^\/+/, "");
}

function getInputAbsolutePath(filename: string): string {
  const normalizedFilename = normalizeRelativePath(filename);
  return path.posix.join(USER_DATA, normalizedFilename);
}

function getLogPath(filename: string): string {
  return path.posix.join(path.posix.dirname(getInputAbsolutePath(filename)), TIMING_LOG_FILE);
}

export async function appendTimingLog(
  filename: string,
  scope: string,
  message: string,
): Promise<void> {
  const logPath = getLogPath(filename);
  const line = `${new Date().toISOString()} [container=${CONTAINER_ID}] [${scope}] ${message}\n`;
  await appendFile(logPath, line, { encoding: "utf-8" });
}

export async function runOnelineAnalysys(filename: string) {
  // Enqueue to batch worker
  return OnelineBatchWorker.getInstance().enqueue(filename);
}

type Pending = { resolve: (v: string) => void; reject: (err: any) => void; enqueuedAt: number };

class OnelineBatchWorker {
  private queue: string[] = [];
  private pending: Map<string, Pending[]> = new Map();
  private intervalMs: number;
  private batchSize: number;
  private maxConcurrentBatches: number;
  private maxBatchWaitMs: number;
  private activeBatches = 0;
  private timer?: NodeJS.Timeout;
  private static instance: OnelineBatchWorker | null = null;

  private constructor(
    batchSize = Number(process.env.ONELINE_BATCH_SIZE) || 5,
    intervalMs = Number(process.env.ONELINE_BATCH_INTERVAL_MS) || 100,
    maxConcurrentBatches = Number(process.env.ONELINE_MAX_CONCURRENT_BATCHES) || 2,
    maxBatchWaitMs = Number(process.env.ONELINE_MAX_BATCH_WAIT_MS) || 150,
  ) {
    this.batchSize = batchSize;
    this.intervalMs = intervalMs;
    this.maxConcurrentBatches = maxConcurrentBatches;
    this.maxBatchWaitMs = maxBatchWaitMs;
    this.start();
  }

  static getInstance() {
    if (!OnelineBatchWorker.instance) OnelineBatchWorker.instance = new OnelineBatchWorker();
    return OnelineBatchWorker.instance;
  }

  enqueue(filename: string): Promise<string> {
    const key = normalizeRelativePath(filename);
    const p = new Promise<string>((resolve, reject) => {
      const arr = this.pending.get(key) ?? [];
      arr.push({ resolve, reject, enqueuedAt: Date.now() });
      this.pending.set(key, arr);
    });

    if (!this.queue.includes(key)) this.queue.push(key);
    return p;
  }

  private start() {
    this.timer = setInterval(() => this.flush(), this.intervalMs);
    this.timer.unref?.();
  }

  private async flush() {
    while (this.queue.length > 0 && this.activeBatches < this.maxConcurrentBatches) {
      const firstKey = this.queue[0];
      if (!firstKey) return;

      const firstPending = this.pending.get(firstKey)?.[0];
      const oldestWaitMs = firstPending ? Date.now() - firstPending.enqueuedAt : 0;
      if (this.queue.length < this.batchSize && oldestWaitMs < this.maxBatchWaitMs) {
        return;
      }

      const batch = this.queue.splice(0, this.batchSize);
      this.activeBatches += 1;
      void this.runBatch(batch).finally(() => {
        this.activeBatches = Math.max(0, this.activeBatches - 1);
        void this.flush();
      });
    }
  }

  private async runBatch(batch: string[]) {
    const batchStartedAt = Date.now();
    const tempBatchDir = await mkdtemp(path.join(tmpdir(), "molprobity-oneline-"));
    const inputPaths = batch.map((f) => getInputAbsolutePath(f));
    const queueWaitByFile = new Map<string, number>();

    for (const f of batch) {
      const pendingEntries = this.pending.get(f) ?? [];
      const earliestEnqueuedAt = pendingEntries.reduce((min, entry) => Math.min(min, entry.enqueuedAt), Date.now());
      queueWaitByFile.set(f, Math.max(0, batchStartedAt - earliestEnqueuedAt));
      appendTimingLog(f, "wrapper.oneline", `start input=${getInputAbsolutePath(f)}`).catch(() => {});
      appendTimingLog(f, "wrapper.oneline", `queue_wait_ms=${queueWaitByFile.get(f)!.toFixed(2)} active_batches=${this.activeBatches}`).catch(() => {});
    }

    try {
      const copyStartedAt = Date.now();
      await Promise.all(
        inputPaths.map((sourcePath) => {
          const targetPath = path.join(tempBatchDir, path.basename(sourcePath));
          return copyFile(sourcePath, targetPath);
        })
      );
      const copyMs = getDurationMs(copyStartedAt);

      const command = `oneline-analysis -noprotein -dorna -q "${tempBatchDir}"`;
      console.log(`Batch running: ${command}`);
      const commandStart = Date.now();

      const output = await handler(command);
      const commandMs = getDurationMs(commandStart);
      const totalBatchMs = getDurationMs(batchStartedAt);

      // Parse lines and map by basename before ':'
      const parsedByBasename: Map<string, Record<string, string | undefined>> = new Map();
      for (const line of output) {
        if (!line || line.startsWith("#")) continue;
        const parts = line.split(":");
        const base = parts[0] ?? "";
        if (!base) continue;
        const values = parts;
        const obj: Record<string, string | undefined> = Object.fromEntries(
          ONELINE_HEADERS.map((key, i) => [key, values[i]])
        );
        parsedByBasename.set(base, obj);
      }

      const parseStart = Date.now();

      for (const f of batch) {
        const base = path.posix.basename(f.replace(/^\/+/, ""));
        const parsed = parsedByBasename.get(base) ?? {};
        const json = JSON.stringify(parsed);
        const parseMs = getDurationMs(parseStart);
        const totalMs = getDurationMs(batchStartedAt);

        // resolve pending promises for this file
        const pend = this.pending.get(f) ?? [];
        for (const p of pend) p.resolve(json);
        this.pending.delete(f);

        // append logs
        appendTimingLog(f, "wrapper.oneline", `batch_copy_ms=${copyMs.toFixed(2)} lines=${output.length}`).catch(() => {});
        appendTimingLog(f, "wrapper.oneline", `analysis_ms=${commandMs.toFixed(2)} keys=${Object.keys(parsed).length}`).catch(() => {});
        appendTimingLog(f, "wrapper.oneline", `parse_ms=${parseMs.toFixed(2)} keys=${Object.keys(parsed).length}`).catch(() => {});
        appendTimingLog(f, "wrapper.oneline", `total_ms=${totalMs.toFixed(2)}`).catch(() => {});
        appendTimingLog(f, "wrapper.oneline", `batch_total_ms=${totalBatchMs.toFixed(2)}`).catch(() => {});
      }
    } catch (err) {
      for (const f of batch) {
        const pend = this.pending.get(f) ?? [];
        for (const p of pend) p.reject(err);
        this.pending.delete(f);
        appendTimingLog(f, "wrapper.oneline", `error ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
      }
    } finally {
      await rm(tempBatchDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function runResidueAnalysis(filename: string) {
  const totalStart = Date.now();
  const inputPath = getInputAbsolutePath(filename);
  const command = `residue-analysis -noprotein ${inputPath}`;

  await appendTimingLog(filename, "wrapper.residue", `start input=${inputPath}`);

  const commandStart = Date.now();
  const output: string[] = await handler(command);
  await appendTimingLog(
    filename,
    "wrapper.residue",
    `command_exec_ms=${getDurationMs(commandStart).toFixed(2)} lines=${output.length}`,
  );

  if (output.length === 0) {
    await appendTimingLog(filename, "wrapper.residue", "error invalid_output_no_data");
    throw new Error("Invalid output format: no data returned");
  }

  const parseStart = Date.now();
  const dataLines = output.slice(1);

  const outputParsedArray: Record<string, string | undefined>[] = dataLines.map(
    (line) => {
      const values = line.split(",");
      return Object.fromEntries(
        RESIDUE_HEADERS.map((key, i) => [key, values[i] || ""])
      );
    }
  );

  await appendTimingLog(
    filename,
    "wrapper.residue",
    `parse_ms=${getDurationMs(parseStart).toFixed(2)} records=${outputParsedArray.length}`,
  );
  await appendTimingLog(
    filename,
    "wrapper.residue",
    `total_ms=${getDurationMs(totalStart).toFixed(2)}`,
  );

  return JSON.stringify(outputParsedArray, null, 2);
}
