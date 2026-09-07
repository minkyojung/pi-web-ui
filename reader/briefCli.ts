import { brief } from "./brief.ts";
import { readSettings } from "../settings.ts";

const arg = (name: string, fallback: number) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) || fallback : fallback;
};

// 설정에 적힌 것이 평소의 값이고, 플래그는 이번 한 번만 다르게 해보는 것이다.
// (400자에서는 모델이 짐작하다 틀렸다 — 광고 건너뛰기 유료화 기사를 "모바일 보안"
// 으로 읽었다. HN은 소개글을 주지 않아 본문 첫머리가 재료의 전부라, 한 문단으로는
// 무슨 글인지가 안 선다. 그래서 기본값이 1000자다.)
const settings = readSettings();
await brief(arg("hours", settings.briefHours), arg("chars", settings.briefChars));
