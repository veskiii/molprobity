import express from "express";
import { hostname } from "os";
import {
  appendTimingLog,
  createMolprobityWorker,
  runOnelineAnalysys,
  runResidueAnalysis,
} from "./wrappers.js";

const app = express();
const port = 3001;
const CONTAINER_ID = hostname();

createMolprobityWorker();

app.get("/", (req, res) => {
  res.send("Hello World!");
});

function getDurationMs(startMs: number): number {
  return Date.now() - startMs;
}

app.get("/oneline-analysis", async (req, res) => {
  const requestStart = Date.now();
  const filename = req.query.filename as string;
  if (!filename) {
    res.status(400).send("filename is required");
    return;
  }

  try {
    await appendTimingLog(filename, "server.oneline", "request_received");
    const analysisStart = Date.now();
    const output = await runOnelineAnalysys(filename);
    await appendTimingLog(
      filename,
      "server.oneline",
      `analysis_ms=${getDurationMs(analysisStart).toFixed(2)}`,
    );

    res.send(output);
    await appendTimingLog(
      filename,
      "server.oneline",
      `request_total_ms=${getDurationMs(requestStart).toFixed(2)} status=200`,
    );
  } catch (error) {
    await appendTimingLog(
      filename,
      "server.oneline",
      `request_total_ms=${getDurationMs(requestStart).toFixed(2)} status=500 error=${String(error)}`,
    );
    res.status(500).send(error);
  }
});

app.get("/residue-analysis", async (req, res) => {
  const requestStart = Date.now();
  const filename = req.query.filename as string;
  if (!filename) {
    res.status(400).send("filename is required");
    return;
  }

  try {
    await appendTimingLog(filename, "server.residue", "request_received");
    const analysisStart = Date.now();
    const output = await runResidueAnalysis(filename);
    await appendTimingLog(
      filename,
      "server.residue",
      `analysis_ms=${getDurationMs(analysisStart).toFixed(2)}`,
    );

    res.send(output);
    await appendTimingLog(
      filename,
      "server.residue",
      `request_total_ms=${getDurationMs(requestStart).toFixed(2)} status=200`,
    );
  } catch (error) {
    await appendTimingLog(
      filename,
      "server.residue",
      `request_total_ms=${getDurationMs(requestStart).toFixed(2)} status=500 error=${String(error)}`,
    );
    res.status(500).send(error);
  }
});

app.listen(port, () => {
  console.log(`[container=${CONTAINER_ID}] Server started at http://localhost:${port}`);
});
