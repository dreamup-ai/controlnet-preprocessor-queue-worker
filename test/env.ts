Object.assign(process.env, {
  AWS_REGION: "us-east-1",
  AWS_DEFAULT_REGION: "us-east-1",
  DYNAMODB_ENDPOINT: "http://localhost:8000",
  S3_ENDPOINT: "http://localhost:4566",
  SQS_ENDPOINT: "http://localhost:4566",
  QUEUE_URL:
    "http://localhost:4566/000000000000/controlnet-preprocessor-jobs.fifo",
  JOB_TABLE: "test-table",
  PREPROCESSOR_SERVER_URL: "https://smoky-tamarind-garden.salad.cloud",
});
