import json
import os
import re
from typing import List

from analytics.execute_plan import execute_plan
from fastapi import APIRouter, HTTPException
from groq import Groq
from pydantic import BaseModel
from store.data_store import data_store

router = APIRouter(prefix="/api/chat", tags=["Chat"])


def get_groq_client():
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        print("Warning: GROQ_API_KEY is not set.")
    return Groq(api_key=api_key)


class ChatRequest(BaseModel):
    question: str


class SuggestionsRequest(BaseModel):
    columns: List[str]


def is_result_empty(res_list) -> bool:
    if not res_list or not isinstance(res_list, list) or len(res_list) == 0:
        return True
    for row in res_list:
        if not isinstance(row, dict):
            continue
        values = list(row.values())
        if len(values) == 0:
            continue
        for val in values:
            if val is None or val == "":
                continue
            if isinstance(val, (int, float)) and val == 0:
                continue
            if isinstance(val, str) and (
                val.strip() == "0" or val.lower() == "n/a" or val.strip() == ""
            ):
                continue
            return False
    return True


@router.post("")
@router.post("/")
async def chat(payload: ChatRequest):
    try:
        question = payload.question
        data = data_store.get_data()

        if not data or len(data) == 0:
            return {
                "success": False,
                "needsRehydrate": True,
                "error": "No dataset loaded in server memory. Please reload or re-upload your file.",
            }

        columns = list(data[0].keys())

        # Quick check for greetings
        cleaned_question = re.sub(r"[^\w\s]", "", (question or "").strip().lower())
        quick_greetings = [
            "hi",
            "hello",
            "hey",
            "greetings",
            "good morning",
            "good afternoon",
            "good evening",
            "yo",
        ]
        if cleaned_question in quick_greetings or cleaned_question == "":
            return {
                "plan": {"type": "general"},
                "result": None,
                "summary": "Hello! I am your retail analytics assistant. How can I help you analyze your retail data today? Please ask a query related to sales, transactions, discounts, regions, or store managers.",
            }

        prompt = f"""
You are a retail analytics assistant.
Analyze the user's question:
"{question}"

Available columns in our loaded database:
{chr(10).join(columns)}

If the question is a general query, greeting, or social talk (e.g., "Hi", "Hello", "How are you", "What is this?"), classify it as "general" and provide a helpful, friendly message asking the user to ask a query related to their loaded retail data (such as sales, transactions, discounts, regions, or store managers).

If the question is about analyzing the loaded retail data, classify it as "query" and generate a standard SQL query to answer it.

Return ONLY a JSON object:
For general queries:
{{
  "type": "general",
  "message": "Your friendly response asking the user for a retail-related data query."
}}

For data queries:
{{
  "type": "query",
  "sql": "SELECT [column_name] AS [key], SUM([target_col]) AS [value] FROM ? GROUP BY [column_name] ORDER BY [value] DESC LIMIT 10",
  "summary": "A short, professional summary of what the user asked and what data is being retrieved to answer it (strictly 3 to 6 lines max)."
}}
"""

        client = get_groq_client()
        completion = client.chat.completions.create(
            messages=[
                {
                    "role": "system",
                    "content": """
You are a retail analytics assistant.

Return ONLY a valid JSON object in the following format:
For general queries:
{
  "type": "general",
  "message": "Your friendly response asking the user for a retail-related data query."
}

For data queries:
{
  "type": "query",
  "sql": "your_sql_query",
  "summary": "A short, professional summary of what the user asked and what data is being retrieved to answer it (strictly 3 to 6 lines max)."
}

Never return code blocks (like ```json), explanations, or markdown. Only return the raw JSON object.

SQL Query Rules:
1. The table name in the query must always be "?" (which represents the in-memory array of objects).
2. If column names contain spaces or special characters (like % or date), they MUST be enclosed in square brackets (e.g., [Manual Discount Amount], [Approved By], [Txn Date]).
3. When summarizing, grouping, or aggregating data for charts and lists, alias the group column as [key] and the aggregated value as [value] (e.g., SELECT [Store Name] AS [key], SUM([Gross Sales]) AS [value] FROM ? GROUP BY [Store Name]).
4. For ranking/top/most questions (e.g., "highest", "top", "most"), use ORDER BY [value] DESC and LIMIT 10 (or the number requested by the user).
5. For percentage questions, return the percentage value directly.
""",
                },
                {"role": "user", "content": prompt},
            ],
            model="openai/gpt-oss-120b",
        )

        generated_code = completion.choices[0].message.content or ""
        clean_code = (
            generated_code.replace("```javascript", "")
            .replace("```json", "")
            .replace("```", "")
            .strip()
        )
        if clean_code.startswith("json"):
            clean_code = clean_code[4:].strip()

        try:
            plan = json.loads(clean_code)
        except Exception:
            if "select" in clean_code.lower():
                plan = {"type": "query", "sql": clean_code}
            else:
                raise

        if not plan.get("type") and plan.get("sql"):
            plan["type"] = "query"

        if plan.get("type") == "general":
            return {
                "plan": plan,
                "result": None,
                "summary": plan.get("message")
                or "Hello! I am your retail analytics assistant. How can I help you analyze your retail data today? Please ask a query related to sales, transactions, discounts, or regions.",
            }

        print("PLAN:", plan)
        result = execute_plan(data, plan)

        if is_result_empty(result):
            return {
                "plan": plan,
                "result": None,
                "summary": "No data found matching your query. Please check if the filter values are correct (e.g. spelling of regions, categories, or names) or try asking a different question.",
            }

        summary = plan.get("summary") or "Here is the data for your query:"
        return {"plan": plan, "result": result, "summary": summary}

    except Exception as err:
        print("Chat Route Error:", err)
        raise HTTPException(status_code=500, detail=str(err))


@router.post("/suggestions")
async def suggestions(payload: SuggestionsRequest):
    try:
        columns = payload.columns
        if not columns or len(columns) == 0:
            raise HTTPException(
                status_code=400,
                detail="Columns array is required and must not be empty.",
            )

        data = data_store.get_data()
        data_sample = data[:5] if data and len(data) > 0 else []

        prompt = f"""
You are a retail database query assistant.
Given the following column names from a loaded database table:
{chr(10).join([f"- {c}" for c in columns])}

{f"Here is a sample of the first 5 rows from the loaded database table to give you context on the data types and actual values:{chr(10)}{json.dumps(data_sample, indent=2)}" if data_sample else ""}

Generate exactly 10 simple, direct, and straightforward analytical questions that a user can ask to analyze this dataset.
Guidelines:
1. Every question must be simple and easy to answer with a single standard SQL query (aggregations, filters, groupings, limits).
2. The questions should return exactly one simple table, metric, or list of values (e.g. "What is the total gross sales by region?", "List top 5 categories by sales").
3. Do NOT suggest complex queries, trend analysis over multiple time frames, cohort analyses, or queries requiring multiple complex calculations.
4. Keep the questions clean, easy to understand, and business-focused.
5. Ensure every question can be answered using only the provided columns.
6. Use the actual sample row context (like specific names of regions, stores, categories) to make the questions realistic and specific.

Return ONLY a JSON array of strings containing exactly 10 questions.
Do NOT return markdown formatting, code blocks, or extra text. Return a raw JSON array, e.g.:
[
  "Question 1?",
  "Question 2?"
]
"""
        client = get_groq_client()
        completion = client.chat.completions.create(
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful retail database assistant. You always respond ONLY with a raw JSON array of strings containing simple, direct, single-table analytical questions based on the columns and sample data provided. Never output any markdown code blocks, HTML, or other text.",
                },
                {"role": "user", "content": prompt},
            ],
            model="openai/gpt-oss-120b",
        )

        generated_code = completion.choices[0].message.content or ""
        match = re.search(r"\[\s*[\s\S]*?\s*\]", generated_code)

        if match:
            sugg_list = json.loads(match.group(0))
        else:
            clean_code = (
                generated_code.replace("```javascript", "")
                .replace("```json", "")
                .replace("```", "")
                .strip()
            )
            if clean_code.startswith("json"):
                clean_code = clean_code[4:].strip()
            sugg_list = json.loads(clean_code)

        if not isinstance(sugg_list, list) or len(sugg_list) == 0:
            raise ValueError("Invalid suggestions response from AI")

        return {"suggestions": sugg_list}

    except Exception as err:
        print("Suggestions Route Error:", err)
        # Fallback suggestions
        return {
            "suggestions": [
                "Which store manager has the highest average manual discount amount?",
                "What is the total gross sales by region?",
                "What percentage of transactions had a manual discount?",
                "List the top 5 product categories by gross sales.",
                "Which manual discount reasons are used most frequently?",
                "Average manual discount % for each store in West region",
                "Which stores have the highest manual discounts?",
                "Which regions have the highest manual discounts?",
                "Which store manager gave the lowest manual discount %?",
                "Which items are best selling?",
            ]
        }
