import "dotenv/config";
import { bureauRecommend } from "../lib/bureau.js";

async function main() {
  const result = await bureauRecommend("maps");
  console.log(JSON.stringify(result, null, 2));
}

main().then(() => process.exit(0));
