"""Agent 工具注册表：Tool dataclass + 全局 REGISTRY。

设计（参考 ecom-service-agent / mini-agent 的手写注册表模式）：
- 每个工具 = name + description + JSON Schema parameters + 同步 fn
- fn 返回字符串（JSON 或自然语言），直接作为 tool message 回填给模型
- loop.py 通过 list_schemas() 生成 OpenAI function calling 的 tools 数组
"""

from __future__ import annotations

import inspect
import json
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema（type: object）
    fn: Callable[..., str]

    def schema(self) -> dict[str, Any]:
        """OpenAI tools 数组元素。"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def call(self, args: dict[str, Any]) -> str:
        """执行工具，参数不足/多余时给出可读错误而非抛异常。"""
        try:
            return self.fn(**args)
        except TypeError as exc:
            return json.dumps({"error": f"参数不匹配: {exc}"}, ensure_ascii=False)


REGISTRY: dict[str, Tool] = {}


def register(tool: Tool) -> Tool:
    if tool.name in REGISTRY:
        raise ValueError(f"工具重名: {tool.name}")
    REGISTRY[tool.name] = tool
    return tool


def list_schemas() -> list[dict[str, Any]]:
    return [t.schema() for t in REGISTRY.values()]


def param_schema(required: list[str] | None = None, **props: Any) -> dict[str, Any]:
    """快捷构造 JSON Schema。required 在前，其余为属性。

    required=None → 全部必传（默认）；required=[] → 全部可选（如 order_lookup）。
    """
    return {
        "type": "object",
        "properties": props,
        "required": list(props.keys()) if required is None else required,
    }


def doc_summary(obj: Any, limit: int = 120) -> str:
    """把工具返回截断成一句摘要（给前端步骤卡片显示）。"""
    text = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)
    text = text.replace("\n", " ")
    return text[:limit] + ("…" if len(text) > limit else "")
