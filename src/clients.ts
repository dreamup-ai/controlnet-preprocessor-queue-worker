import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import assert from "node:assert";

const {
  AWS_REGION,
  AWS_DEFAULT_REGION,

  DYNAMODB_ENDPOINT,
  S3_ENDPOINT,
  SQS_ENDPOINT,
} = process.env;

assert(
  AWS_REGION || AWS_DEFAULT_REGION,
  "AWS_REGION or AWS_DEFAULT_REGION must be set"
);

export const sqs = new SQSClient({
  region: AWS_REGION || AWS_DEFAULT_REGION,
  endpoint: SQS_ENDPOINT,
});

export const s3 = new S3Client({
  region: AWS_REGION || AWS_DEFAULT_REGION,
  endpoint: S3_ENDPOINT,
});

export const dynamodb = new DynamoDBClient({
  region: AWS_REGION || AWS_DEFAULT_REGION,
  endpoint: DYNAMODB_ENDPOINT,
});
