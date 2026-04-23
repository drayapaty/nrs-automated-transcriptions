/**
 * One-time setup: create the two DynamoDB tables this service uses.
 *
 *   nrs-transcribe-jobs           PK: job_id            (TTL on `ttl`)
 *   nrs-lectures-auto-transcribe  PK: lecture_id, SK: lang
 *
 * Usage:
 *   npx tsx scripts/create-tables.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  UpdateTimeToLiveCommand,
} from "@aws-sdk/client-dynamodb";

const region = process.env.DYNAMODB_REGION || "eu-central-1";
const TABLE_JOBS = process.env.DYNAMODB_TABLE_JOBS || "nrs-transcribe-jobs";
const TABLE_LECTURES =
  process.env.DYNAMODB_TABLE_LECTURES || "nrs-lectures-auto-transcribe";

const client = new DynamoDBClient({
  region,
  credentials: {
    accessKeyId: process.env.DYNAMODB_ACCESS_KEY!,
    secretAccessKey: process.env.DYNAMODB_SECRET_KEY!,
  },
});

async function tableExists(name: string): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "ResourceNotFoundException") return false;
    throw err;
  }
}

async function createJobsTable() {
  if (await tableExists(TABLE_JOBS)) {
    console.log(`✓ Table ${TABLE_JOBS} already exists`);
    return;
  }
  console.log(`Creating ${TABLE_JOBS}...`);
  await client.send(
    new CreateTableCommand({
      TableName: TABLE_JOBS,
      AttributeDefinitions: [{ AttributeName: "job_id", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "job_id", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    })
  );
  // Wait briefly for table to become ACTIVE before enabling TTL
  for (let i = 0; i < 30; i++) {
    const desc = await client.send(new DescribeTableCommand({ TableName: TABLE_JOBS }));
    if (desc.Table?.TableStatus === "ACTIVE") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: TABLE_JOBS,
      TimeToLiveSpecification: { Enabled: true, AttributeName: "ttl" },
    })
  );
  console.log(`✓ ${TABLE_JOBS} created with TTL on attribute "ttl"`);
}

async function createLecturesTable() {
  if (await tableExists(TABLE_LECTURES)) {
    console.log(`✓ Table ${TABLE_LECTURES} already exists`);
    return;
  }
  console.log(`Creating ${TABLE_LECTURES}...`);
  await client.send(
    new CreateTableCommand({
      TableName: TABLE_LECTURES,
      AttributeDefinitions: [
        { AttributeName: "lecture_id", AttributeType: "S" },
        { AttributeName: "lang", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "lecture_id", KeyType: "HASH" },
        { AttributeName: "lang", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    })
  );
  console.log(`✓ ${TABLE_LECTURES} created`);
}

async function main() {
  console.log(`Region: ${region}\n`);
  await createJobsTable();
  await createLecturesTable();
  console.log(`\nDone.`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
