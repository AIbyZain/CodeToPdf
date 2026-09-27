import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Uploaded source is sent as JSON text. 12 MB leaves headroom over the 5 MB
// upload limit for JSON escaping (quotes, backslashes, newlines).
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Friendly JSON errors instead of Express's default HTML page / stack trace.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const status = typeof err === "object" && err && "status" in err ? Number((err as { status: unknown }).status) : 500;
  const type = typeof err === "object" && err && "type" in err ? String((err as { type: unknown }).type) : "";
  if (status === 413 || type === "entity.too.large") {
    res.status(413).json({ error: "These files are too large to process together. Try removing very large files, or split the assignment into two PDFs." });
    return;
  }
  if (type === "entity.parse.failed") {
    res.status(400).json({ error: "The upload could not be read. Please refresh the page and try again." });
    return;
  }
  req.log?.error({ err }, "Unhandled request error");
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
});

export default app;
