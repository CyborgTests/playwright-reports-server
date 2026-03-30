import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { execSync } from "child_process";
import db from "./src/db";
import dayjs from "dayjs";
import cors from "cors";
import { getOpenApiSpec, ROUTE_SPECS } from "./src/openapi";
import AdmZip from "adm-zip";

async function startServer() {
  const app = express();
  const rawPort = process.env.PORT;
  const PORT = rawPort ? Number.parseInt(rawPort, 10) : 3000;
  if (Number.isNaN(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error(`Invalid PORT: ${rawPort ?? "(unset)"}`);
  }

  app.use(cors());
  app.use(express.json());

  const DATA_DIR = path.join(process.cwd(), 'data');
  const RESULTS_DIR = path.join(DATA_DIR, 'results');
  const REPORTS_DIR = path.join(DATA_DIR, 'reports');
  const PUBLIC_DIR = path.join(DATA_DIR, 'public');
  const UPLOAD_TEMP_DIR = path.join(DATA_DIR, 'temp', 'upload');

  [DATA_DIR, RESULTS_DIR, REPORTS_DIR, PUBLIC_DIR, UPLOAD_TEMP_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, UPLOAD_TEMP_DIR);
    },
    filename: (req, file, cb) => {
      const id = uuidv4();
      cb(null, `${id}.zip`);
    }
  });

  const upload = multer({ storage });

  /** Extract base64 report data from Playwright HTML report. */
  function extractBase64FromReportHtml(html: string): string {
    const dataUriPattern = /data:application\/zip;base64,([A-Za-z0-9+/=\s]+)(?=<\/script>|["';]|$)/s;
    const dataUriMatch = html.match(dataUriPattern);
    if (dataUriMatch?.[1]) return dataUriMatch[1].replace(/\s/g, "").trim();
    const scriptPattern = /<script[^>]*id\s*=\s*["']?playwrightReportBase64["']?[^>]*>([\s\S]*?)<\/script>/i;
    const scriptMatch = html.match(scriptPattern);
    if (scriptMatch?.[1]) {
      const raw = scriptMatch[1].trim().replace(/^["']|["']$/g, "").replace(/\s/g, "").trim();
      if (raw.length > 0) return raw;
    }
    return "";
  }

  /** Parse index.html in report dir and return stats for DB. Returns null if parse fails. */
  function parseStatsFromReportDir(reportDir: string): { total: number; expected: number; unexpected: number; flaky: number; skipped: number } | null {
    const indexPath = path.join(reportDir, "index.html");
    if (!fs.existsSync(indexPath)) return null;
    const html = fs.readFileSync(indexPath, "utf-8");
    const base64 = extractBase64FromReportHtml(html);
    if (!base64) return null;
    try {
      const zipBuffer = Buffer.from(base64, "base64");
      const zip = new AdmZip(zipBuffer);
      const entry = zip.getEntry("report.json");
      if (!entry) return null;
      const reportJson = entry.getData().toString("utf-8");
      const info = JSON.parse(reportJson) as { stats?: { total?: number; expected?: number; unexpected?: number; flaky?: number; skipped?: number; passed?: number; failed?: number } };
      if (!info?.stats) return null;
      const raw = info.stats;
      const expected = raw.expected ?? raw.passed ?? 0;
      const unexpected = raw.unexpected ?? raw.failed ?? 0;
      const total = raw.total ?? (expected + unexpected + (raw.flaky ?? 0) + (raw.skipped ?? 0));
      return { total, expected, unexpected, flaky: raw.flaky ?? 0, skipped: raw.skipped ?? 0 };
    } catch {
      return null;
    }
  }

  /** Generate HTML report from a directory of zip files (e.g. report dir blobs/). Writes to reportOutputDir. */
  function generateReportFromBlobDir(project: string, reportId: string, blobDir: string): { reportUrl: string; size: number } {
    const reportOutputDir = path.join(REPORTS_DIR, project, reportId);
    if (!fs.existsSync(reportOutputDir)) fs.mkdirSync(reportOutputDir, { recursive: true });

    execSync(`npx playwright merge-reports ${blobDir} --reporter html`, {
      env: { ...process.env, PLAYWRIGHT_HTML_OUTPUT_DIR: reportOutputDir },
    });

    let size = 0;
    const calculateSize = (dir: string) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          calculateSize(fullPath);
        } else {
          size += fs.statSync(fullPath).size;
        }
      }
    };
    calculateSize(reportOutputDir);

    const reportUrl = `/api/serve/${project}/${reportId}/index.html`;
    return { reportUrl, size };
  }

  /** Generate HTML report from one or more result zip IDs (legacy: zips in RESULTS_DIR). Returns reportId, reportUrl, size. Does not write to DB. */
  function generateReportFromResultIds(project: string, resultsIds: string[]): { reportId: string; reportUrl: string; size: number } {
    const reportId = uuidv4();
    const tempDir = path.join(DATA_DIR, 'temp', reportId);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    for (const id of resultsIds) {
      const zipPath = path.join(RESULTS_DIR, `${id}.zip`);
      if (fs.existsSync(zipPath)) {
        fs.copyFileSync(zipPath, path.join(tempDir, `${id}.zip`));
      }
    }

    const { reportUrl, size } = generateReportFromBlobDir(project, reportId, tempDir);
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });

    return { reportId, reportUrl, size };
  }

  // Auth Middleware
  const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const apiToken = process.env.API_TOKEN;
    if (!apiToken) return next();

    const authHeader = req.headers.authorization;
    if (authHeader === apiToken) {
      next();
    } else {
      res.status(401).json({ error: "Unauthorized" });
    }
  };

  const setConfig = (key: string, value: string | number | object) => {
    const v = typeof value === "string" ? value : JSON.stringify(value);
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run(key, v);
  };

  // Handlers keyed by OpenAPI operationId (used with ROUTE_SPECS from openapi.ts)
  const handlers: Record<string, express.RequestHandler> = {
    ping: (req, res) => res.send("pong"),

    getInfo: (req, res) => {
      const getDirSizeMb = (dir: string, recursive = false): string => {
        let size = 0;
        if (!fs.existsSync(dir)) return "0.00";
        const scan = (d: string) => {
          const files = fs.readdirSync(d);
          for (const file of files) {
            const fullPath = path.join(d, file);
            const stats = fs.statSync(fullPath);
            if (stats.isDirectory()) {
              if (recursive) scan(fullPath);
            } else {
              size += stats.size;
            }
          }
        };
        scan(dir);
        return (size / (1024 * 1024)).toFixed(2);
      };

      const reports = db.prepare("SELECT COUNT(*) as count FROM reports").get() as { count: number };

      res.json({
        dataFolderSizeinMB: getDirSizeMb(DATA_DIR, true),
        numOfReports: reports.count,
        reportsFolderSizeinMB: getDirSizeMb(REPORTS_DIR, true)
      });
    },

    uploadResult: async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const project = (req.body.project as string) || "default";
    const blobFilename = req.file.filename;
    const reportId = uuidv4();
    const reportDir = path.join(REPORTS_DIR, project, reportId);
    const blobsDir = path.join(reportDir, 'blobs');

    try {
      fs.mkdirSync(blobsDir, { recursive: true });
      const tempPath = req.file.path;
      const destPath = path.join(blobsDir, blobFilename);
      fs.renameSync(tempPath, destPath);

      const { reportUrl, size: reportSize } = generateReportFromBlobDir(project, reportId, blobsDir);
      const reportCreatedAt = new Date().toISOString();
      const stats = parseStatsFromReportDir(reportDir);
      db.prepare(
        "INSERT INTO reports (id, project, size, createdAt, reportUrl, resultIds, statsTotal, statsExpected, statsUnexpected, statsFlaky, statsSkipped) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        reportId,
        project,
        reportSize,
        reportCreatedAt,
        reportUrl,
        JSON.stringify([blobFilename]),
        stats?.total ?? null,
        stats?.expected ?? null,
        stats?.unexpected ?? null,
        stats?.flaky ?? null,
        stats?.skipped ?? null
      );
    } catch (err) {
      console.error("Report generation after upload failed:", err);
      if (fs.existsSync(reportDir)) fs.rmSync(reportDir, { recursive: true, force: true });
      if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: "Report generation failed", details: (err as Error).message });
    }

    const createdAt = new Date().toISOString();
    res.status(201).json({
      message: "Success",
      data: {
        reportId,
        reportUrl: `/api/serve/${project}/${reportId}/index.html`,
        createdAt,
        project,
        size: (req.file.size / (1024 * 1024)).toFixed(2) + " MB"
      }
    });
    },

    listReports: (req, res) => {
    const { project, search, dateFrom, dateTo, limit = "20", offset = "0" } = req.query;
    let query = "SELECT * FROM reports WHERE 1=1";
    const params: (string | number)[] = [];

    if (project && typeof project === "string") {
      query += " AND project = ?";
      params.push(project);
    }
    if (search && typeof search === "string") {
      query += " AND (project LIKE ? OR id LIKE ?)";
      const term = `%${search}%`;
      params.push(term, term);
    }
    if (dateFrom && typeof dateFrom === "string") {
      query += " AND createdAt >= ?";
      params.push(dateFrom);
    }
    if (dateTo && typeof dateTo === "string") {
      query += " AND createdAt <= ?";
      params.push(dateTo);
    }

    const countRow = db.prepare(query.replace(/SELECT \*/, "SELECT COUNT(*) as c")).get(...params) as { c: number };
    const total = countRow?.c ?? 0;

    query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    params.push(parseInt(String(limit), 10) || 20, parseInt(String(offset), 10) || 0);
    const rows = db.prepare(query).all(...params) as Array<Record<string, unknown> & {
      resultIds?: string | null;
      statsTotal?: number | null;
      statsExpected?: number | null;
      statsUnexpected?: number | null;
      statsFlaky?: number | null;
      statsSkipped?: number | null;
    }>;
    const reports = rows.map((r) => {
      const { resultIds: raw, statsTotal, statsExpected, statsUnexpected, statsFlaky, statsSkipped, ...rest } = r;
      let resultIds: string[] = [];
      if (raw != null && typeof raw === "string") {
        try {
          resultIds = JSON.parse(raw) as string[];
        } catch {}
      }
      return {
        ...rest,
        resultIds,
        stats: {
          total: statsTotal ?? 0,
          expected: statsExpected ?? 0,
          unexpected: statsUnexpected ?? 0,
          flaky: statsFlaky ?? 0,
          skipped: statsSkipped ?? 0,
        },
      };
    });
    res.json({ reports, total });
    },

    getReport: (req, res) => {
    const { id } = req.params;
    const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as any;
    if (!report) return res.status(404).json({ error: "Report not found" });

    let resultIds: string[] = [];
    if (report.resultIds != null && typeof report.resultIds === "string") {
      try {
        resultIds = JSON.parse(report.resultIds) as string[];
      } catch {}
    }

    const stats = {
      total: report.statsTotal ?? 0,
      expected: report.statsExpected ?? 0,
      unexpected: report.statsUnexpected ?? 0,
      flaky: report.statsFlaky ?? 0,
      skipped: report.statsSkipped ?? 0,
    };

    let files: unknown[] = [];
    const metaPath = path.join(REPORTS_DIR, report.project, id, "report-server-metadata.json");
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        if (Array.isArray(meta.files)) files = meta.files;
      } catch (_) {}
    }

    res.json({
      ...report,
      reportID: report.id,
      resultIds,
      stats,
      files,
      projectNames: report.project ? [report.project] : []
    });
    },

    getReportProjects: (req, res) => {
    const rows = db.prepare("SELECT DISTINCT project FROM reports WHERE project != ''").all() as { project: string }[];
    res.json(rows.map((r) => r.project).filter(Boolean).sort());
    },

    generateReport: async (req, res) => {
    const { project, resultsIds } = req.body;
    if (!project || !Array.isArray(resultsIds) || resultsIds.length === 0) {
      return res.status(400).json({ error: "Invalid project or resultsIds" });
    }

    try {
      const { reportId, reportUrl, size } = generateReportFromResultIds(project, resultsIds);
      const reportDir = path.join(REPORTS_DIR, project, reportId);
      const stats = parseStatsFromReportDir(reportDir);
      const createdAt = new Date().toISOString();
      db.prepare(
        "INSERT INTO reports (id, project, size, createdAt, reportUrl, resultIds, statsTotal, statsExpected, statsUnexpected, statsFlaky, statsSkipped) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        reportId,
        project,
        size,
        createdAt,
        reportUrl,
        JSON.stringify(resultsIds),
        stats?.total ?? null,
        stats?.expected ?? null,
        stats?.unexpected ?? null,
        stats?.flaky ?? null,
        stats?.skipped ?? null
      );
      res.json({ project, reportId, reportUrl });
    } catch (error: any) {
      console.error("Report generation failed:", error);
      res.status(500).json({ error: "Report generation failed", details: error.message });
    }
    },

    deleteReports: (req, res) => {
    const { reportsIds } = req.body;
    if (!Array.isArray(reportsIds)) return res.status(400).json({ error: "Invalid reportsIds" });

    for (const id of reportsIds) {
      const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as { project?: string; resultIds?: string | null } | undefined;
      if (report?.project != null) {
        const reportPath = path.join(REPORTS_DIR, report.project, id);
        if (fs.existsSync(reportPath)) fs.rmSync(reportPath, { recursive: true, force: true });
      }
      // Cascade: remove legacy result blobs (results table + RESULTS_DIR) when they exist
      let resultIds: string[] = [];
      if (report?.resultIds != null && typeof report.resultIds === "string") {
        try {
          resultIds = JSON.parse(report.resultIds) as string[];
        } catch {}
      }
      for (const resultId of resultIds) {
        const exists = db.prepare("SELECT 1 FROM results WHERE id = ?").get(resultId);
        if (exists) {
          const zipPath = path.join(RESULTS_DIR, `${resultId}.zip`);
          const extractDir = path.join(RESULTS_DIR, resultId);
          if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
          if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
          db.prepare("DELETE FROM results WHERE id = ?").run(resultId);
        }
      }
      db.prepare("DELETE FROM reports WHERE id = ?").run(id);
    }

    res.json({ message: "Reports deleted successfully", reportsIds });
    },

    getConfig: (req, res) => {
      const configRows = db.prepare("SELECT * FROM config").all() as { key: string, value: string }[];
      const config: any = {
        title: "Playwright Reports",
        headerLinks: { "GitHub": "https://github.com/CyborgTests/playwright-reports-server" },
        authRequired: !!process.env.API_TOKEN,
        serverCache: process.env.USE_SERVER_CACHE === "true",
        dataStorage: process.env.DATA_STORAGE || "fs",
        s3Endpoint: process.env.S3_ENDPOINT || "",
        s3Bucket: process.env.S3_BUCKET || "playwright-reports-server",
        cron: {
          resultExpireDays: undefined as number | undefined,
          resultExpireCronSchedule: process.env.RESULT_EXPIRE_CRON_SCHEDULE || "33 3 * * *",
          reportExpireDays: undefined as number | undefined,
          reportExpireCronSchedule: process.env.REPORT_EXPIRE_CRON_SCHEDULE || "44 4 * * *"
        }
      };
      configRows.forEach(row => {
        try {
          config[row.key] = JSON.parse(row.value);
        } catch {
          config[row.key] = row.value;
        }
      });
      if (config.resultExpireDays != null) config.cron.resultExpireDays = Number(config.resultExpireDays);
      if (config.reportExpireDays != null) config.cron.reportExpireDays = Number(config.reportExpireDays);
      if (config.resultExpireCronSchedule != null) config.cron.resultExpireCronSchedule = config.resultExpireCronSchedule;
      if (config.reportExpireCronSchedule != null) config.cron.reportExpireCronSchedule = config.reportExpireCronSchedule;
      res.json(config);
    },

    updateConfig: (req, res) => {
      const { title, headerLinks, logoPath, faviconPath, reporterPaths, resultExpireDays, resultExpireCronSchedule, reportExpireDays, reportExpireCronSchedule } = req.body;
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };

      if (title !== undefined) setConfig("title", title);
      if (headerLinks !== undefined) {
        try {
          setConfig("headerLinks", typeof headerLinks === "string" ? JSON.parse(headerLinks) : headerLinks);
        } catch {
          setConfig("headerLinks", headerLinks);
        }
      }
      if (logoPath !== undefined) setConfig("logoPath", logoPath);
      if (faviconPath !== undefined) setConfig("faviconPath", faviconPath);
      if (reporterPaths !== undefined) {
        try {
          const paths = typeof reporterPaths === "string" ? (reporterPaths.startsWith("[") ? JSON.parse(reporterPaths) : [reporterPaths]) : reporterPaths;
          setConfig("reporterPaths", paths);
        } catch {
          setConfig("reporterPaths", [reporterPaths]);
        }
      }
      if (resultExpireDays !== undefined) setConfig("resultExpireDays", resultExpireDays);
      if (resultExpireCronSchedule !== undefined) setConfig("resultExpireCronSchedule", resultExpireCronSchedule);
      if (reportExpireDays !== undefined) setConfig("reportExpireDays", reportExpireDays);
      if (reportExpireCronSchedule !== undefined) setConfig("reportExpireCronSchedule", reportExpireCronSchedule);

      if (files?.logo?.[0]) {
        const p = path.join(PUBLIC_DIR, files.logo[0].filename);
        fs.renameSync(files.logo[0].path, p);
        setConfig("logoPath", `/public/${files.logo[0].filename}`);
      }
      if (files?.favicon?.[0]) {
        const p = path.join(PUBLIC_DIR, files.favicon[0].filename);
        fs.renameSync(files.favicon[0].path, p);
        setConfig("faviconPath", `/public/${files.favicon[0].filename}`);
      }

      res.json({ message: "config saved" });
    },
  };

  const middlewareByOperationId: Record<string, express.RequestHandler[]> = {
    getInfo: [authMiddleware],
    uploadResult: [authMiddleware, upload.single("file")],
    listReports: [authMiddleware],
    getReport: [authMiddleware],
    getReportProjects: [authMiddleware],
    generateReport: [authMiddleware],
    deleteReports: [authMiddleware],
    getConfig: [],
    updateConfig: [authMiddleware, upload.fields([{ name: "logo" }, { name: "favicon" }])],
  };

  for (const r of ROUTE_SPECS) {
    if (r.skipRegister) continue;
    const opId = r.openApi.operationId;
    if (!opId || !handlers[opId]) continue;
    const mw = middlewareByOperationId[opId] ?? [];
    (app[r.method] as (path: string, ...handlers: express.RequestHandler[]) => void)(r.path, ...mw, handlers[opId]);
  }

  // Serve reports (404 if report dir missing or asset not found so request never reaches Vite)
  app.use(
    "/api/serve/:project/:reportId",
    authMiddleware,
    (req, res, next) => {
      const { project, reportId } = req.params;
      const reportPath = path.join(REPORTS_DIR, project, reportId);
      if (!fs.existsSync(reportPath) || !fs.statSync(reportPath).isDirectory()) {
        return res.status(404).send("Report not found");
      }
      express.static(reportPath, { fallthrough: false })(req, res, next);
    },
    (req, res) => {
      if (!res.headersSent) res.status(404).send("Not found");
    }
  );

  app.get("/api/openapi.json", (req, res) => {
    res.type("application/json").json(getOpenApiSpec());
  });

  const swaggerUiHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Docs - Playwright Reports Server</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: "/api/openapi.json",
        dom_id: "#swagger-ui",
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ]
      });
    };
  </script>
</body>
</html>`;

  app.get("/api/docs", (req, res) => {
    res.type("text/html").send(swaggerUiHtml);
  });

  app.use("/public", express.static(PUBLIC_DIR));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
