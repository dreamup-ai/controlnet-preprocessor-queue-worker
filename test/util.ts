import {
  BatchWriteItemCommand,
  CreateTableCommand,
  DeleteTableCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsCommand,
} from "@aws-sdk/client-s3";
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  PurgeQueueCommand,
} from "@aws-sdk/client-sqs";
import assert from "node:assert";
import { dynamodb, s3, sqs } from "../src/clients";

const { JOB_TABLE, QUEUE_URL } = process.env;

assert(JOB_TABLE, "JOB_TABLE must be set");

const queueName = QUEUE_URL?.split("/").pop();
const isFifo = queueName?.endsWith(".fifo");

export const initDynamoDb = async () => {
  const params = {
    TableName: JOB_TABLE,
    KeySchema: [
      {
        AttributeName: "job_id",
        KeyType: "HASH",
      },
    ],
    AttributeDefinitions: [
      {
        AttributeName: "job_id",
        AttributeType: "S",
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  };

  await dynamodb.send(new CreateTableCommand(params));
};

/**
 * This implementation only works for tables with 25 items or less.
 * @returns
 */
export const clearTable = async () => {
  const params = {
    TableName: JOB_TABLE,
    ProjectionExpression: "job_id",
  };

  const { Items } = await dynamodb.send(new ScanCommand(params));

  if (!Items) {
    return;
  }

  const params2 = {
    RequestItems: {
      [JOB_TABLE]: Items.map((item) => ({
        DeleteRequest: {
          Key: {
            job_id: item.job_id,
          },
        },
      })),
    },
  };

  await dynamodb.send(new BatchWriteItemCommand(params2));
};

export const deleteTable = async () => {
  const params = {
    TableName: JOB_TABLE,
  };

  await dynamodb.send(new DeleteTableCommand(params));
};

export const initSQS = async () => {
  const params = {
    QueueName: queueName,
    Attributes: {
      FifoQueue: isFifo ? "true" : "false",
    },
  };

  await sqs.send(new CreateQueueCommand(params));
};

export const deleteQueue = async () => {
  const params = {
    QueueUrl: QUEUE_URL,
  };

  await sqs.send(new DeleteQueueCommand(params));
};

export const purgeQueue = async () => {
  const params = {
    QueueUrl: QUEUE_URL,
  };

  await sqs.send(new PurgeQueueCommand(params));
};

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const initS3 = async () => {
  const params = {
    Bucket: "test-bucket",
  };

  await s3.send(new CreateBucketCommand(params));
};

export const bucketName = "test-bucket";

export const clearBucket = async () => {
  const params = {
    Bucket: bucketName,
  };

  const { Contents } = await s3.send(new ListObjectsCommand(params));

  if (!Contents) {
    return;
  }

  const params2 = {
    Bucket: bucketName,
    Delete: {
      Objects: Contents.map((item: any) => ({
        Key: item.Key,
      })),
    },
  };

  await s3.send(new DeleteObjectsCommand(params2));
};

export const deleteBucket = async () => {
  const params = {
    Bucket: bucketName,
  };

  await s3.send(new DeleteBucketCommand(params));
};

export const randomString = (numChars: number) => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let str = "";

  for (let i = 0; i < numChars; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }

  return str;
};

// before(async () => {
//   await initDynamoDb();
//   await initSQS();
//   await initS3();
// });

// after(async () => {
//   await deleteTable();
//   await deleteQueue();
//   await deleteBucket();

//   setStayAlive(false);
// });
