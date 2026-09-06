// npm run fetch — the same pass the fetch_feed tool will make, from a terminal.
import { fetchFeed } from "./fetch.ts";

await fetchFeed((line) => console.log(line));
