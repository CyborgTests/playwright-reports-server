import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { test } from "./fixtures/base";

test("/api/report/generate for single result should generate report", async ({
	api,
	uploadedResult,
}) => {
	const resultID = uploadedResult.body.data?.resultID;

	const { response, body: newReport } = await api.report.generate({
		project: "test-project",
		resultsIds: [resultID],
		title: "Smoke test",
	});

	expect(response.status()).toBe(200);
	expect(newReport.reportId).toBeTruthy();
	expect(newReport.reportUrl).toContain(
		`/api/serve/${newReport.reportId}/index.html`,
	);
	expect(newReport.metadata?.project).toBe("test-project");
});

test("/api/report/generate for multiple results should generate report", async ({
	api,
	uploadedResult,
}) => {
	const uploadedResult2 = await api.result.upload(
		"./tests/testdata/correct_blob.zip",
		{
			project: "test-project",
			tag: "api-smoke",
		},
	);

	const { response, body: newReport } = await api.report.generate({
		project: "test-project",
		resultsIds: [
			uploadedResult.body.data?.resultID,
			uploadedResult2.body.data?.resultID,
		],
		title: "Smoke test",
	});

	expect(response.status()).toBe(200);
	expect(newReport.reportId).toBeTruthy();
	expect(newReport.reportUrl).toContain(
		`/api/serve/${newReport.reportId}/index.html`,
	);
	expect(newReport.metadata?.project).toBe("test-project");
});

test("/api/report/generate for sharded results with triggerReportGeneration=true should generate report", async ({
	api,
}) => {
	const testRunName = randomUUID();

	const shard1 = await api.result.upload("./tests/testdata/correct_blob.zip", {
		testRun: testRunName,
		shardCurrent: 1,
		shardTotal: 2,
		triggerReportGeneration: true,
	});
	const shard2 = await api.result.upload("./tests/testdata/correct_blob.zip", {
		testRun: testRunName,
		shardCurrent: 2,
		shardTotal: 2,
		triggerReportGeneration: true,
	});

	expect(shard1.response.status()).toBe(200);
	expect(shard1.body.data.generatedReport).toBeNull();
	expect(shard1.body.data.testRun).toBe(testRunName);

	expect(shard2.body.data.generatedReport).toBeDefined();
	expect(shard2.body.data.testRun).toBe(testRunName);
	expect(shard2.body.data.generatedReport?.reportId).toBeDefined();
	expect(shard2.body.data.generatedReport?.metadata?.testRun).toBe(testRunName);
});

test("/api/report/generate with invalid result id should fail", async ({
	api,
}) => {
	const { response } = await api.report.generate({
		project: "test-project",
		resultsIds: ["435453434343"],
		title: "Smoke test",
	});

	expect(response.status()).toBe(404);
});
