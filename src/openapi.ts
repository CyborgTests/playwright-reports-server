/**
 * OpenAPI spec built from route registry. Paths are derived from ROUTE_SPECS
 * so the doc stays in sync with the API.
 */

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface RouteSpec {
  method: HttpMethod;
  path: string;
  openApi: {
    tags?: string[];
    summary?: string;
    description?: string;
    operationId?: string;
    security?: object[];
    parameters?: object[];
    requestBody?: object;
    responses?: object;
  };
  /** If true, do not register with Express (e.g. app.use() route). */
  skipRegister?: boolean;
}

/** Convert Express path to OpenAPI path: /api/report/:id -> /api/report/{id} */
export function pathToOpenApi(expressPath: string): string {
  return expressPath.replace(/:([^/]+)/g, "{$1}");
}

const OPENAPI_BASE = {
  openapi: "3.1.0",
  info: {
    title: "Playwright Reports Server API",
    description:
      "APIs for managing and generating reports based on Playwright test results. Store HTML reports, merge sharded runs, store raw results, and view report trends. Optional API token authorization.",
    version: "1.0.0",
    license: {
      name: "MIT",
      url: "https://github.com/CyborgTests/playwright-reports-server",
    },
  },
  servers: [
    { url: "http://localhost:3000", description: "Local development" },
    { url: "https://demo-playwright-reports-server.koyeb.app", description: "Demo" },
  ],
  security: [{ apiTokenHeader: [] }],
  tags: [
    { name: "Reports", description: "Generated HTML report management" },
    { name: "Server", description: "Health and server info" },
    { name: "Config", description: "UI white-label and server config" },
  ],
  components: {
    securitySchemes: {
      /** Matches server.ts: req.headers.authorization === process.env.API_TOKEN (raw value, not `Bearer <token>`). */
      apiTokenHeader: {
        type: "apiKey",
        in: "header",
        name: "Authorization",
        description:
          "Raw API token in the Authorization header. Set API_TOKEN in the server environment; when set, most API routes and /api/serve require auth. Send exactly: Authorization: <your-token> (no Bearer prefix unless the token itself contains that text). The SPA uses the same format (see src/context/AuthContext.tsx). For HTML report assets (images, traces), browsers cannot send this header; after login the SPA calls POST /api/session to set an HttpOnly cookie (prs_api_token) that /api/serve also accepts.",
      },
    },
    parameters: {
      limit: { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
      offset: { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
      project: { name: "project", in: "query", schema: { type: "string", default: "" } },
      search: { name: "search", in: "query", schema: { type: "string", default: "" } },
      dateFrom: { name: "dateFrom", in: "query", schema: { type: "string", format: "date-time" } },
      dateTo: { name: "dateTo", in: "query", schema: { type: "string", format: "date-time" } },
      tags: {
        name: "tags",
        in: "query",
        schema: { type: "string", description: "Comma-separated tag values (e.g. key:value)" },
      },
    },
    schemas: {
      Error: { type: "object", properties: { error: { type: "string" } } },
      ServerInfo: {
        type: "object",
        properties: {
          dataFolderSizeinMB: { type: "string", example: "0.00 MB" },
          numOfReports: { type: "integer" },
          reportsFolderSizeinMB: { type: "string" },
        },
      },
      ReportBase: {
        type: "object",
        properties: {
          reportID: { type: "string", format: "uuid" },
          createdAt: { type: "string", format: "date-time" },
          project: { type: "string" },
          size: { type: "string" },
          reportUrl: { type: "string" },
          title: { type: "string" },
        },
      },
      ReportStats: {
        type: "object",
        properties: {
          total: { type: "integer" },
          expected: { type: "integer" },
          unexpected: { type: "integer" },
          flaky: { type: "integer" },
          skipped: { type: "integer" },
          ok: { type: "boolean" },
        },
      },
      ReportHistory: {
        allOf: [
          { $ref: "#/components/schemas/ReportBase" },
          {
            type: "object",
            properties: {
              stats: { $ref: "#/components/schemas/ReportStats" },
              metadata: {
                type: "object",
                properties: {
                  actualWorkers: { type: "integer" },
                  playwrightVersion: { type: "string" },
                },
              },
              startTime: { type: "number" },
              duration: { type: "number" },
              files: { type: "array", items: { type: "object" } },
              projectNames: { type: "array", items: { type: "string" } },
            },
          },
        ],
      },
      ReportListResponse: {
        type: "object",
        properties: {
          reports: { type: "array", items: { $ref: "#/components/schemas/ReportHistory" } },
          total: { type: "integer" },
        },
      },
      DeleteReportsRequest: {
        type: "object",
        required: ["reportsIds"],
        properties: {
          reportsIds: { type: "array", items: { type: "string", format: "uuid" } },
        },
      },
      DeleteReportsResponse: {
        type: "object",
        properties: {
          message: { type: "string", example: "Reports deleted successfully" },
          reportsIds: { type: "array", items: { type: "string", format: "uuid" } },
        },
      },
      GenerateReportRequest: {
        type: "object",
        required: ["resultsIds", "project"],
        properties: {
          project: { type: "string" },
          resultsIds: { type: "array", items: { type: "string", format: "uuid" } },
          playwrightVersion: { type: "string" },
          title: { type: "string" },
        },
      },
      GenerateReportResponse: {
        type: "object",
        properties: {
          project: { type: "string" },
          reportId: { type: "string", format: "uuid" },
          reportUrl: { type: "string" },
        },
      },
      GeneratedReportInfo: {
        type: "object",
        properties: {
          reportId: { type: "string", format: "uuid" },
          reportUrl: { type: "string" },
          metadata: {
            type: "object",
            properties: { title: { type: "string" }, project: { type: "string" } },
          },
        },
      },
      UploadReportResponse: {
        type: "object",
        properties: {
          message: { type: "string", example: "Success" },
          data: {
            type: "object",
            properties: {
              reportId: { type: "string", format: "uuid" },
              reportUrl: { type: "string" },
              createdAt: { type: "string", format: "date-time" },
              project: { type: "string" },
              size: { type: "string" },
            },
          },
        },
      },
      ConfigResponse: {
        type: "object",
        properties: {
          title: { type: "string" },
          headerLinks: { type: "object", additionalProperties: { type: "string" } },
          logoPath: { type: "string" },
          faviconPath: { type: "string" },
          reporterPaths: { type: "array", items: { type: "string" } },
          authRequired: { type: "boolean" },
          serverCache: { type: "boolean" },
          dataStorage: { type: "string" },
          s3Endpoint: { type: "string" },
          s3Bucket: { type: "string" },
          cron: {
            type: "object",
            properties: {
              resultExpireDays: { type: "number" },
              resultExpireCronSchedule: { type: "string" },
              reportExpireDays: { type: "number" },
              reportExpireCronSchedule: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

/** Route specs: path (Express style :param), method, and OpenAPI operation. */
export const ROUTE_SPECS: RouteSpec[] = [
  {
    method: "get",
    path: "/api/ping",
    openApi: {
      tags: ["Server"],
      summary: "Health check",
      description: "Returns a simple health check response. Does not require authorization.",
      operationId: "ping",
      security: [],
      responses: {
        "200": {
          description: "Server is running",
          content: { "text/plain": { schema: { type: "string", example: "pong" } } },
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/info",
    openApi: {
      tags: ["Server"],
      summary: "Server stats",
      description: "Returns server storage and report/result counts.",
      operationId: "getInfo",
      responses: {
        "200": {
          description: "Server info",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ServerInfo" } },
          },
        },
        "500": {
          description: "Server error",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
    },
  },
  {
    method: "post",
    path: "/api/report/upload",
    openApi: {
      tags: ["Reports"],
      summary: "Upload report",
      description:
        "Accepts a .zip archive (Playwright blob reporter output), creates a report (HTML + blobs in one directory). Optional form fields: project.",
      operationId: "uploadResult",
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["file"],
              properties: {
                file: {
                  type: "string",
                  format: "binary",
                  description: "ZIP archive from Playwright blob reporter",
                },
                project: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Report created",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UploadReportResponse" },
            },
          },
        },
        "400": {
          description: "Upload failed or invalid request",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        "500": {
          description: "Server or report generation error",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/report/list",
    openApi: {
      tags: ["Reports"],
      summary: "List reports",
      description: "Returns a paginated list of generated reports with URLs.",
      operationId: "listReports",
      parameters: [
        { $ref: "#/components/parameters/limit" },
        { $ref: "#/components/parameters/offset" },
        { $ref: "#/components/parameters/project" },
        { $ref: "#/components/parameters/search" },
        { $ref: "#/components/parameters/dateFrom" },
        { $ref: "#/components/parameters/dateTo" },
      ],
      responses: {
        "200": {
          description: "List of reports",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ReportListResponse" },
            },
          },
        },
        "400": {
          description: "Bad request",
          content: { "text/plain": { schema: { type: "string" } } },
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/report/projects",
    openApi: {
      tags: ["Reports"],
      summary: "List report projects",
      description: "Returns list of project names that have reports.",
      operationId: "getReportProjects",
      responses: {
        "200": {
          description: "List of project names",
          content: {
            "application/json": {
              schema: { type: "array", items: { type: "string" } },
            },
          },
        },
        "400": {
          description: "Bad request",
          content: { "text/plain": { schema: { type: "string" } } },
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/report/:id",
    openApi: {
      tags: ["Reports"],
      summary: "Get report by ID",
      description: "Returns a single report by ID.",
      operationId: "getReport",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        "200": {
          description: "Report details",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ReportHistory" },
            },
          },
        },
        "400": {
          description: "Bad request or report not found",
          content: { "text/plain": { schema: { type: "string" } } },
        },
        "404": {
          description: "Report not found",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
    },
  },
  {
    method: "post",
    path: "/api/report/generate",
    openApi: {
      tags: ["Reports"],
      summary: "Generate report",
      description:
        "Generates a report from provided result IDs, merging sharded runs (Playwright merge-reports).",
      operationId: "generateReport",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/GenerateReportRequest" },
          },
        },
      },
      responses: {
        "200": {
          description: "Report generated",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/GenerateReportResponse" },
            },
          },
        },
        "400": {
          description: "Bad request or generation failed",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        "404": {
          description: "Result ID not found",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        "500": {
          description: "Server error",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
    },
  },
  {
    method: "delete",
    path: "/api/report/delete",
    openApi: {
      tags: ["Reports"],
      summary: "Delete reports",
      description: "Deletes report folders by IDs.",
      operationId: "deleteReports",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/DeleteReportsRequest" },
          },
        },
      },
      responses: {
        "200": {
          description: "Reports deleted",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeleteReportsResponse" },
            },
          },
        },
        "400": {
          description: "Bad request",
          content: { "text/plain": { schema: { type: "string" } } },
        },
        "404": {
          description: "Report(s) not found",
          content: { "text/plain": { schema: { type: "string" } } },
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/serve/:project/:reportId",
    skipRegister: true,
    openApi: {
      tags: ["Reports"],
      summary: "Serve report file",
      description:
        "Serves a file from a generated report. Path is project/reportId/file (e.g. myproject/uuid/index.html). When auth is enabled, requires Authorization header.",
      operationId: "serveReportFile",
      parameters: [
        {
          name: "project",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "Project name",
        },
        {
          name: "reportId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
          description: "Report ID",
        },
      ],
      responses: {
        "200": {
          description: "File content (HTML, JS, CSS, or binary)",
          content: {
            "text/html": {},
            "application/javascript": {},
            "text/css": {},
            "application/octet-stream": {},
          },
        },
        "404": {
          description: "File or report not found",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/config",
    openApi: {
      tags: ["Config"],
      summary: "Get config",
      description:
        "Returns UI white-label config and environment info (authRequired, serverCache, dataStorage, s3Endpoint, s3Bucket).",
      operationId: "getConfig",
      security: [],
      responses: {
        "200": {
          description: "Config and env info",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ConfigResponse" },
            },
          },
        },
        "404": {
          description: "Config not found",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
    },
  },
  {
    method: "patch",
    path: "/api/config",
    openApi: {
      tags: ["Config"],
      summary: "Update config",
      description:
        "Updates UI white-label and optional cron settings via form-data (title, logo, favicon, headerLinks, reporterPaths, resultExpireDays, resultExpireCronSchedule, reportExpireDays, reportExpireCronSchedule).",
      operationId: "updateConfig",
      requestBody: {
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                logo: { type: "string", format: "binary" },
                favicon: { type: "string", format: "binary" },
                logoPath: { type: "string" },
                faviconPath: { type: "string" },
                headerLinks: {
                  type: "string",
                  description: "JSON object: key = link name, value = URL",
                },
                reporterPaths: {
                  type: "string",
                  description: "JSON array or single path",
                },
                resultExpireDays: { type: "string" },
                resultExpireCronSchedule: { type: "string" },
                reportExpireDays: { type: "string" },
                reportExpireCronSchedule: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Config saved",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { message: { type: "string", example: "config saved" } },
              },
            },
          },
        },
        "400": {
          description: "Bad request (e.g. invalid headerLinks JSON)",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        "500": {
          description: "Failed to save config",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
    },
  },
];

/** Build full OpenAPI spec from ROUTE_SPECS. */
export function getOpenApiSpec(): Record<string, unknown> {
  const paths: Record<string, Record<string, object>> = {};
  for (const r of ROUTE_SPECS) {
    const openApiPath = pathToOpenApi(r.path);
    if (!paths[openApiPath]) paths[openApiPath] = {};
    (paths[openApiPath] as Record<string, object>)[r.method] = r.openApi as object;
  }
  return {
    ...OPENAPI_BASE,
    paths,
  } as Record<string, unknown>;
}
