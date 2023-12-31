import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
} from "@aws-sdk/client-sqs";
import assert from "node:assert";
import {
  dynamodb as dynamoClient,
  s3 as s3Client,
  sqs as sqsClient,
} from "./clients";

const { QUEUE_URL, PREPROCESSOR_SERVER_URL, SALAD_API_KEY, JOB_TABLE } =
  process.env;

assert(QUEUE_URL, "QUEUE_URL must be set");
assert(PREPROCESSOR_SERVER_URL, "PREPROCESSOR_SERVER_URL must be set");
assert(JOB_TABLE, "JOB_TABLE must be set");

const baseUrl = new URL(PREPROCESSOR_SERVER_URL);

export let stayAlive = true;
export const setStayAlive = (value: boolean) => {
  stayAlive = value;
};
process.on("SIGINT", () => {
  stayAlive = false;
});

const setJobStatus = async (
  jobId: string,
  status: string,
  receiptHandle: string | undefined = undefined,
  job_time: number | undefined = undefined,
  gpu_time: number | undefined = undefined
) => {
  console.log(`Setting job ${jobId} status to ${status}`);
  // We are going to add a timestamp to the job status
  // so we can see how long it took to process the job
  const statusToTimeField: {
    [key: string]: string;
  } = {
    running: "time_started",
    completed: "time_completed",
    failed: "time_failed",
  };

  if (!statusToTimeField[status]) {
    throw new Error(`Invalid status: ${status}`);
  }

  const params = {
    TableName: JOB_TABLE,
    Key: {
      job_id: { S: jobId },
    },
    UpdateExpression: `SET #status = :status, #timeField = :time`,
    ExpressionAttributeNames: {
      "#status": "status",
      "#timeField": statusToTimeField[status],
    } as any,
    ExpressionAttributeValues: {
      ":status": { S: status },
      ":time": { N: (Date.now() / 1000).toString() },
    } as any,
  };

  if (job_time) {
    params.UpdateExpression += ", #job_time = :job_time";
    params.ExpressionAttributeNames["#job_time"] = "job_time";
    params.ExpressionAttributeValues[":job_time"] = { N: job_time.toString() };
  }

  if (gpu_time) {
    params.UpdateExpression += ", #gpu_time = :gpu_time";
    params.ExpressionAttributeNames["#gpu_time"] = "gpu_time";
    params.ExpressionAttributeValues[":gpu_time"] = { N: gpu_time.toString() };
  }

  const promises = [dynamoClient.send(new UpdateItemCommand(params))];

  if (receiptHandle) {
    promises.push(
      sqsClient.send(
        new DeleteMessageCommand({
          QueueUrl: QUEUE_URL,
          ReceiptHandle: receiptHandle,
        })
      )
    );
  }

  await Promise.all(promises);
};

async function main() {
  while (stayAlive) {
    const { Messages } = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
      })
    );
    console.log("Received messages", Messages?.length || 0);
    if (Messages && Messages.length > 0) {
      const settled = await Promise.allSettled(
        Messages.map(async ({ Body, ReceiptHandle }) => {
          if (!Body || !ReceiptHandle) return;

          const timeStarted = Date.now();

          const {
            input_key,
            input_bucket,
            output_key,
            output_bucket,
            process_id,
            job_id,
          } = JSON.parse(Body);

          // All of the above fields are required
          if (
            !input_key ||
            !input_bucket ||
            !output_key ||
            !output_bucket ||
            !process_id ||
            !job_id
          ) {
            console.error("Invalid message", Body);

            return setJobStatus(job_id, "failed", ReceiptHandle);
          }

          // Output key must end in .webp
          if (!output_key.endsWith(".webp") && !output_key.endsWith(".png")) {
            console.error("Invalid output key", output_key);
            return setJobStatus(job_id, "failed", ReceiptHandle);
          }

          console.log(`Processing job ${job_id}`);
          setJobStatus(job_id, "running");

          // The preprocessor url is the base url + /image/<process_id>
          const url = new URL(`/image/${process_id}`, baseUrl);

          /**
           * Get the image from S3
           */
          let imageStream: NodeJS.ReadableStream | undefined;
          try {
            const getObjCmd = new GetObjectCommand({
              Bucket: input_bucket,
              Key: input_key,
            });
            const { Body } = (await s3Client.send(getObjCmd)) as {
              Body: NodeJS.ReadableStream;
            };
            imageStream = Body;
          } catch (e: any) {
            console.error(job_id, e);
            // Delete message from queue

            return setJobStatus(job_id, "failed", ReceiptHandle);
          }

          if (!imageStream) {
            console.error(job_id, "No image stream");
            return setJobStatus(job_id, "failed", ReceiptHandle);
          }

          const chunks: Uint8Array[] = [];
          for await (const chunk of imageStream) {
            chunks.push(chunk as Buffer);
          }
          const imageBuffer = Buffer.concat(chunks);

          /**
           * Send the image to the preprocessor
           */
          const reqInfo = {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
            } as any,
            body: imageBuffer,
          };
          if (SALAD_API_KEY) {
            reqInfo.headers["Salad-Api-Key"] = SALAD_API_KEY;
          }
          console.log("Sending request to", url.toString());
          const result = await fetch(url.toString(), reqInfo);
          if (!result.ok) {
            console.error(job_id, await result.text());
            return setJobStatus(job_id, "failed", ReceiptHandle);
          }

          if (!result.body) {
            console.error(job_id, "No result body");
            return setJobStatus(job_id, "failed", ReceiptHandle);
          }

          let gpuTime: number | undefined = undefined;
          try {
            gpuTime = parseFloat(result.headers.get("X-Inference-Time") || "");

            /**
             * Save the image to S3
             */
            console.log(`Saving result to s3://${output_bucket}/${output_key}`);
            const processedImg = (await result.arrayBuffer()) as Buffer;
            const putObjCmd = new PutObjectCommand({
              Bucket: output_bucket,
              Key: output_key,
              Body: processedImg,
              ContentType: output_key.endsWith(".webp")
                ? "image/webp"
                : "image/png",
            });

            await s3Client.send(putObjCmd);
          } catch (e: any) {
            console.error(job_id, e);

            return setJobStatus(job_id, "failed", ReceiptHandle);
          }

          const timeCompleted = Date.now();
          const jobTime = (timeCompleted - timeStarted) / 1000;

          await setJobStatus(
            job_id,
            "completed",
            ReceiptHandle,
            jobTime,
            gpuTime
          );
        })
      );

      const failed = settled.filter((s) => s.status === "rejected");
      if (failed.length > 0) {
        failed.forEach((f) => console.error(f));
      }
    }
  }
}

main();
