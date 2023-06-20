import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs";
import { dynamodb, s3, sqs } from "../src/clients";

import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import {
  bucketName,
  clearBucket,
  clearTable,
  purgeQueue,
  randomString,
  sleep,
} from "./util";

const inputKey = "original.png";
const outputKey = "converted.png";
const jobId = "test-job-id";

describe("Integration test", () => {
  before(async () => {
    await purgeQueue();
    await clearTable();
    await clearBucket();

    // Put a test image in the bucket
    const params = {
      Bucket: bucketName,
      Key: "original.png",
      Body: fs.readFileSync("test/fixtures/original.png"),
    };

    await s3.send(new PutObjectCommand(params));
  });

  after(async () => {
    await purgeQueue();
    await clearTable();
    await clearBucket();
  });

  it("should convert an image to the specified format", async () => {
    // Submit a job to sqs, wait for it to be processed
    // and check that the output is correct
    const job = {
      input_key: inputKey,
      input_bucket: bucketName,
      output_key: outputKey,
      output_bucket: bucketName,
      process_id: "canny",
      job_id: jobId,
    };

    // Submit the job
    const params = {
      QueueUrl: process.env.QUEUE_URL!,
      MessageBody: JSON.stringify(job),
      MessageGroupId: randomString(10),
    };

    await sqs.send(new SendMessageCommand(params));

    await sleep(500);

    // Check job table for status
    const { Item } = await dynamodb.send(
      new GetItemCommand({
        TableName: process.env.JOB_TABLE!,
        Key: {
          job_id: { S: jobId },
        },
      })
    );

    if (!Item) {
      throw new Error("Item not found");
    }

    const { status } = Item;

    if (!status) {
      throw new Error("Status not found");
    }

    if (status.S !== "completed") {
      throw new Error("Status was not completed");
    }

    // Check that the output file exists
    const { Body } = (await s3.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: outputKey,
      })
    )) as { Body: NodeJS.ReadableStream };

    if (!Body) {
      throw new Error("Body not found");
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of Body) {
      chunks.push(chunk as Buffer);
    }

    const buffer = Buffer.concat(chunks);

    // Write the output to the fixtures dir
    fs.writeFileSync("test/fixtures/converted.png", buffer);
  });
});
