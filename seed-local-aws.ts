import "./test/env";
import { initDynamoDb, initS3, initSQS } from "./test/util";

async function main() {
  try {
    await initDynamoDb();
  } catch (e: any) {
    console.log(e);
  }

  try {
    await initSQS();
  } catch (e: any) {
    console.log(e);
  }

  try {
    await initS3();
  } catch (e: any) {
    console.log(e);
  }
}

main();
