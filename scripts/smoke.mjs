#!/usr/bin/env node
/**
 * 店智 Copilot 冒烟测试（零依赖，Node 18+ 原生 fetch）
 *
 * 检查：
 *   API  : /health、/v1/workspace/summary、/v1/data/{orders,products,aftersales}、
 *          /v1/kb/docs、POST /v1/intent
 *   Pages: /workspace、/chat、/data、/kb（200 + text/html）
 *
 * 用法：
 *   node scripts/smoke.mjs
 *   API_BASE=http://127.0.0.1:59999 node scripts/smoke.mjs   # 验证失败路径
 *
 * 每项打印 `PASS/FAIL name (Nms)`，汇总 `PASS x/y`；
 * 任一失败退出码 1；同一份输出追加到 .omo/qa/smoke-<YYYYMMDD>.log。
 * 网络错误按检查项捕获，绝不向外抛异常。
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:8000").replace(/\/+$/, "");
const WEB_BASE = (process.env.WEB_BASE || "http://127.0.0.1:3000").replace(/\/+$/, "");
const TIMEOUT_MS = 5000;
const INTENT_QUESTION = "最近退款率怎么样";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 本地 YYYYMMDD（禁止写死历史日期） */
function localDateStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** 本地时间戳（日志易读，不依赖 locale） */
function localTimestamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

const LOG_DIR = resolve(ROOT, ".omo", "qa");
const LOG_FILE = resolve(LOG_DIR, `smoke-${localDateStamp()}.log`);
const logLines = [];

/** 同时写控制台与内存日志（结束时落盘，等价 tee） */
function log(line) {
  console.log(line);
  logLines.push(line);
}

function flushLog() {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, `${logLines.join("\n")}\n\n`, "utf8");
  } catch (err) {
    console.error(`WARN 日志写入失败 ${LOG_FILE}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 从 fetch 的嵌套错误里提取字符串错误码（ECONNREFUSED / ENOTFOUND 等） */
function findErrorCode(err) {
  const seen = new Set();
  const walk = (e) => {
    if (!e || typeof e !== "object" || seen.has(e)) return null;
    seen.add(e);
    if (typeof e.code === "string") return e.code;
    if (Array.isArray(e.errors)) {
      for (const sub of e.errors) {
        const code = walk(sub);
        if (code) return code;
      }
    }
    return walk(e.cause);
  };
  return walk(err);
}

/** 单行错误描述：不打印堆栈，保证失败路径可读 */
function describeError(err) {
  const name = err?.name || err?.cause?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return `TIMEOUT(${TIMEOUT_MS}ms)`;
  }
  const code = findErrorCode(err);
  if (code) return code;
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\s+/g, " ").trim() || "UNKNOWN_ERROR";
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertArray(value, label) {
  assert(Array.isArray(value), `${label} 应为数组，实际 ${Array.isArray(value) ? "array" : typeof value}`);
}

/** 带 5s 超时的原生 fetch */
function request(url, init = {}) {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      accept: "application/json, text/html;q=0.9, */*;q=0.8",
      ...(init.headers || {}),
    },
  });
}

async function getJson(path) {
  const res = await request(`${API_BASE}${path}`);
  assert(res.status === 200, `HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    return fail("响应不是合法 JSON");
  }
}

async function getHtml(path) {
  const res = await request(`${WEB_BASE}${path}`);
  assert(res.status === 200, `HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") || "";
  assert(contentType.toLowerCase().includes("text/html"), `content-type=${contentType || "missing"}`);
  await res.arrayBuffer(); // 读完 body，确保连接释放
}

async function postIntent() {
  const payload = JSON.stringify({ message: INTENT_QUESTION });
  let res = await request(`${API_BASE}/v1/intent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
  });

  // 后端 P5 契约字段为 q（backend/app/api_intent.py:28）。产品口径优先 message，
  // 若当前后端仅认 q，则按契约重试一次，并在日志里显式标注，不让 422 静默通过。
  let usedAlias = false;
  if (res.status === 422) {
    usedAlias = true;
    res = await request(`${API_BASE}/v1/intent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: INTENT_QUESTION }),
    });
  }

  assert(res.status === 200, `HTTP ${res.status}`);
  let data;
  try {
    data = await res.json();
  } catch {
    return fail("响应不是合法 JSON");
  }
  assert(isObject(data), `响应应为对象，实际 ${typeof data}`);
  assert(typeof data.intent === "string" && data.intent.length > 0, "缺少 intent 字段");
  return { intent: data.intent, usedAlias };
}

let passed = 0;
let total = 0;

async function check(name, fn) {
  total += 1;
  const started = performance.now();
  try {
    await fn();
    passed += 1;
    log(`PASS ${name} (${Math.round(performance.now() - started)}ms)`);
  } catch (err) {
    log(`FAIL ${name} ${describeError(err)} (${Math.round(performance.now() - started)}ms)`);
  }
}

log(
  `# smoke ${localTimestamp()} | API_BASE=${API_BASE} | WEB_BASE=${WEB_BASE} | timeout=${TIMEOUT_MS}ms`,
);

await check("GET /health", async () => {
  const data = await getJson("/health");
  assert(isObject(data), `响应应为对象，实际 ${typeof data}`);
  assert(data.status === "ok", `status=${String(data.status)}`);
});

await check("GET /v1/workspace/summary", async () => {
  const data = await getJson("/v1/workspace/summary");
  assert(isObject(data), `响应应为对象，实际 ${typeof data}`);
  assert(isObject(data.kpis), `kpis 应为对象，实际 ${typeof data.kpis}`);
  assertArray(data.pending, "pending");
  assertArray(data.recent_sessions, "recent_sessions");
});

await check("GET /v1/data/orders", async () => {
  assertArray(await getJson("/v1/data/orders"), "orders");
});

await check("GET /v1/data/products", async () => {
  assertArray(await getJson("/v1/data/products"), "products");
});

await check("GET /v1/data/aftersales", async () => {
  assertArray(await getJson("/v1/data/aftersales"), "aftersales");
});

await check("GET /v1/kb/docs", async () => {
  assertArray(await getJson("/v1/kb/docs"), "kb docs");
});

await check("POST /v1/intent", async () => {
  const { intent, usedAlias } = await postIntent();
  if (usedAlias) {
    log("NOTE POST /v1/intent: {message} 返回 422，已按后端契约字段 {q} 重试成功");
  }
  assert(intent.length > 0, "intent 为空");
});

for (const path of ["/workspace", "/chat", "/data", "/kb"]) {
  await check(`GET ${path}`, () => getHtml(path));
}

log(`PASS ${passed}/${total}`);
if (passed === total) {
  log("RESULT PASS exit=0");
} else {
  log(`RESULT FAIL ${total - passed} failed exit=1`);
  process.exitCode = 1;
}
log(`LOG ${LOG_FILE}`);
flushLog();
