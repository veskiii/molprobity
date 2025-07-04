import { execSync } from "child_process";

const USER_DATA = `/user_data`;
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
async function handler(command: string): Promise<string[]> {
  const output = execSync(command, { encoding: "utf-8" }).toString();
  const splt: string[] = output.split(/\r?\n/).filter((line) => line !== "");
  return splt;
}

export async function runOnelineAnalysys(filename: string) {
  const command = `oneline-analysis -noprotein -dorna -q ${USER_DATA}/${filename}`;
  console.log(`Running ${command}`);
  const output: string[] = await handler(command);

  const outputParsed: string[] = output[0]?.split(":") ?? [];
  const outputParsedObj: Record<string, string | undefined> =
    Object.fromEntries(ONELINE_HEADERS.map((key, i) => [key, outputParsed[i]]));

  return JSON.stringify(outputParsedObj);
}

export async function runResidueAnalysis(filename: string) {
  const command = `residue-analysis -noprotein ${USER_DATA}/${filename}`;
  const output: string[] = await handler(command);

  if (output.length === 0) {
    throw new Error("Invalid output format: no data returned");
  }

  const dataLines = output.slice(1);

  const outputParsedArray: Record<string, string | undefined>[] = dataLines.map(
    (line) => {
      const values = line.split(",");
      return Object.fromEntries(
        RESIDUE_HEADERS.map((key, i) => [key, values[i] || ""])
      );
    }
  );

  return JSON.stringify(outputParsedArray, null, 2);
}
