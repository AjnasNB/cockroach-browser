import {
  productLoopBrowserCapabilitySnapshot
} from "cockroach-browser/productloop";

const snapshot = productLoopBrowserCapabilitySnapshot();

console.log(JSON.stringify(snapshot, null, 2));
