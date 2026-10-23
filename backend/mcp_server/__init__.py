"""店智 Copilot — MCP 独立服务进程（stdio 传输）。

定位（D4 决策）：
- 对外暴露 kb_search / data_query 两个 MCP tool，供 MCP Inspector 或其他 MCP client 调用
- 复用 backend/app/agent/tools 的注册表逻辑（同一份代码，单一事实源）
- 独立进程，不与 FastAPI 同端口，避免端口冲突

运行（项目根目录）：
  python -m backend.mcp_server          # 默认 stdio 传输

测试：
  npx @modelcontextprotocol/inspector python -m backend.mcp_server
"""

from __future__ import annotations

import json

from mcp.server.fastmcp import FastMCP

# 复用 backend/app/agent/tools 的工具注册（import 副作用会注册 4 个工具）
from backend.app.agent.tools import REGISTRY

mcp = FastMCP(
    "shop-copilot",
    instructions="店智 Copilot 电商运营 AI 助手的 MCP 工具集：知识库检索、店铺数据查询、文案生成、合规检查。",
)


@mcp.tool()
def kb_search(query: str) -> str:
    """知识库检索：查询平台规则、运营方法论等内部知识。返回带编号的文本片段。"""
    return REGISTRY["kb_search"].call({"query": query})


@mcp.tool()
def data_query(query: str) -> str:
    """查询店铺经营数据（GMV/订单/访客/转化率/退款率/热销品/流量来源）。"""
    return REGISTRY["data_query"].call({"query": query})


@mcp.tool()
def copywriting(product_name: str, selling_points: str) -> str:
    """生成商品标题、短描述、卖点列表。"""
    return REGISTRY["copywriting"].call({"product_name": product_name, "selling_points": selling_points})


@mcp.tool()
def policy_check(scenario: str) -> str:
    """检查某运营场景是否违规，返回风险等级与建议。"""
    return REGISTRY["policy_check"].call({"scenario": scenario})


if __name__ == "__main__":
    # stdio 传输：默认。启动后 MCP client 通过 stdin/stdout 通信。
    mcp.run()
