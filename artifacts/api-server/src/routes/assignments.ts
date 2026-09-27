import { Router, type IRouter } from "express";
import {
  AnalyzeAssignmentBody,
  GenerateAssignmentPdfBody,
} from "@workspace/api-zod";
import { analyzeAssignment, validateFiles } from "../lib/assignment";
import { buildAssignmentPdf } from "../lib/pdf";

const router: IRouter = Router();

router.post("/assignments/analyze", (req, res) => {
  const parsed = AnalyzeAssignmentBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ issues: parsed.error.issues }, "Invalid assignment analysis payload");
    res.status(400).json({ error: "Please provide assignment details and at least one valid file." });
    return;
  }

  try {
    res.json(analyzeAssignment(parsed.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to analyze files.";
    req.log.warn({ err: error }, "Assignment analysis rejected");
    res.status(400).json({ error: message });
  }
});

router.post("/assignments/generate-pdf", async (req, res) => {
  const parsed = GenerateAssignmentPdfBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ issues: parsed.error.issues }, "Invalid PDF generation payload");
    res.status(400).json({ error: "Please review the assignment details and file groups before generating." });
    return;
  }

  const files = parsed.data.groups.flatMap((group) => group.files);
  if (!files.length) {
    res.status(400).json({ error: "Add at least one file to a question before generating the PDF." });
    return;
  }
  try {
    validateFiles(files);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Some files could not be used." });
    return;
  }

  try {
    const pdf = await buildAssignmentPdf(parsed.data);
    const filename = `${(parsed.data.assignment.title ?? "").trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "assignment"}.pdf`;
    res
      .status(200)
      .type("application/pdf")
      .set("Content-Disposition", `attachment; filename="${filename}"`)
      .send(Buffer.from(pdf));
  } catch (error) {
    req.log.error({ err: error }, "PDF generation failed");
    res.status(500).json({ error: "The PDF could not be generated. Please try again." });
  }
});

export default router;
