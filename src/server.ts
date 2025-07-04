import express from "express";
import { runOnelineAnalysys, runResidueAnalysis } from "./wrappers.js";

const app = express();
const port = 3001;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/oneline-analysis", (req, res) => {
  const filename = req.query.filename as string;
  if (!filename) {
    res.status(400).send("filename is required");
    return;
  }
  runOnelineAnalysys(filename)
    .then((output) => {
      res.send(output);
    })
    .catch((error) => {
      res.status(500).send(error);
    });
});

app.get("/residue-analysis", (req, res) => {
  const filename = req.query.filename as string;
  if (!filename) {
    res.status(400).send("filename is required");
    return;
  }
  runResidueAnalysis(filename)
    .then((output) => {
      res.send(output);
    })
    .catch((error) => {
      res.status(500).send(error);
    });
});

app.listen(port, () => {
  console.log(`Server started at http://localhost:${port}`);
});
