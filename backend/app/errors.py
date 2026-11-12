"""统一错误协议（RFC 9457 problem+json）与友好化文案。

设计依据：docs/plan-error-handling.md（传智杯评委反馈「错误处理可以再友好些」）。

核心原则（对齐 OpenHands error_classification / LibreChat / LobeChat 实践）：
- 不给用户看技术细节：不出现 DeepSeek、uvicorn、端口号、原始 body、堆栈、异常原文。
- 错误分三类话术：
    可重试   UPSTREAM_*   「AI 服务暂时繁忙，请稍后重试」
    需配置   CONFIG_*     「AI 服务未配置，请联系管理员」
    输入错误 VALIDATION_* / INVALID_INPUT
- REST 返回 application/problem+json；SSE 错误事件 data 里带同构字段（message 兼容前端旧解析）。
- 技术细节只进日志，不进响应。
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("shop-copilot.errors")

PROBLEM_MEDIA = "application/problem+json"

# 上游可重试状态码（网络/超时/限流/服务不可用）
_RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


class FieldError(BaseModel):
    pointer: str  # JSON Pointer，如 #/messages/0/content
    detail: str


class Problem(BaseModel):
    type: str = "about:blank"
    title: str
    status: int
    detail: str | None = None
    code: str
    retryable: bool = False
    retry_after_ms: int | None = None
    request_id: str | None = None
    errors: list[FieldError] | None = None

    def response(self) -> JSONResponse:
        headers: dict[str, str] = {}
        if self.request_id:
            headers["X-Request-ID"] = self.request_id
        if self.retry_after_ms:
            headers["Retry-After"] = str(max(1, self.retry_after_ms // 1000))
        return JSONResponse(
            status_code=self.status,
            content=self.model_dump(exclude_none=True),
            media_type=PROBLEM_MEDIA,
            headers=headers or None,
        )


class ProblemException(Exception):
    """业务代码里 raise 它，由 register_error_handlers 统一转成 problem+json。"""

    def __init__(self, problem: Problem):
        self.problem = problem
        super().__init__(problem.detail or problem.title)


# ── 分类工厂 ──────────────────────────────────────────────

def upstream_error(
    status: int,
    *,
    detail: str | None = None,
    retry_after_ms: int | None = None,
) -> ProblemException:
    """可重试：上游模型服务（网络/超时/429/5xx）。"""
    if status == 429:
        title, default_detail = "请求过于频繁", "请求过于频繁，请稍后重试"
    elif status in _RETRYABLE_STATUS:
        title, default_detail = "AI 服务暂时繁忙", "AI 服务暂时不可用，请稍后重试"
    else:
        title, default_detail = "AI 服务请求失败", "AI 服务暂时无法处理，请稍后重试"
    return ProblemException(Problem(
        title=title,
        status=status,
        detail=detail or default_detail,
        code=f"UPSTREAM_{status}",
        retryable=True,
        retry_after_ms=retry_after_ms,
    ))


def config_error(detail: str = "AI 服务未配置，请联系管理员完成配置") -> ProblemException:
    """需配置：缺 key 等，不可重试。"""
    return ProblemException(Problem(
        title="AI 服务未配置",
        status=500,
        detail=detail,
        code="CONFIG_MISSING",
        retryable=False,
    ))


def input_error(detail: str) -> ProblemException:
    """请求体/参数不合法。"""
    return ProblemException(Problem(
        title="请求格式有误",
        status=400,
        detail=detail,
        code="INVALID_INPUT",
        retryable=False,
    ))


def not_found(detail: str) -> ProblemException:
    return ProblemException(Problem(
        title="未找到",
        status=404,
        detail=detail,
        code="NOT_FOUND",
        retryable=False,
    ))


def _json_pointer(loc: tuple) -> str:
    """FastAPI loc（('body','messages',0,'content')）→ JSON Pointer（#/messages/0/content）。"""
    parts = [str(x) for x in loc]
    if parts and parts[0] in ("body", "query", "path", "header", "cookie"):
        parts = parts[1:]
    escaped = [p.replace("~", "~0").replace("/", "~1") for p in parts]
    return "#/" + "/".join(escaped) if escaped else "#"


def register_error_handlers(app: FastAPI) -> None:
    """在 app 创建后调用一次，注册统一异常处理器。"""

    @app.exception_handler(ProblemException)
    async def _problem_handler(_req: Request, exc: ProblemException) -> JSONResponse:
        return exc.problem.response()

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(_req: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            FieldError(pointer=_json_pointer(e["loc"]), detail=e["msg"])
            for e in exc.errors()
        ]
        return Problem(
            title="请求参数有误",
            status=422,
            detail="提交的数据不符合要求，请检查后重试",
            code="VALIDATION_ERROR",
            retryable=False,
            errors=errors,
        ).response()

    @app.exception_handler(StarletteHTTPException)
    async def _http_handler(_req: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else "请求失败"
        return Problem(
            title="请求失败",
            status=exc.status_code,
            detail=detail,
            code=f"HTTP_{exc.status_code}",
            retryable=exc.status_code in _RETRYABLE_STATUS,
        ).response()

    @app.exception_handler(Exception)
    async def _unhandled_handler(_req: Request, exc: Exception) -> JSONResponse:
        logger.exception("未处理异常: %s", exc)
        return Problem(
            title="服务出现异常",
            status=500,
            detail="服务出现异常，请稍后重试",
            code="INTERNAL_ERROR",
            retryable=True,
        ).response()
