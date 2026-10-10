import re
from typing import Any, Dict, List

import duckdb
import pandas as pd


def execute_plan(
    data: List[Dict[str, Any]], plan: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    Executes the generated SQL plan on the in-memory dataset using DuckDB.
    Supports SQL syntax matching Alasql / SQLite, including 'FROM ?' or 'FROM data'.
    """
    try:
        sql = plan.get("sql", "").strip()
        if not sql:
            return []

        # Convert rows into a pandas DataFrame for ultra-fast SQL querying
        df = pd.DataFrame(data)

        # 1. Replace square brackets [column name] with double quotes "column name" (standard SQL)
        clean_sql = re.sub(r"\[([^\]]+)\]", r'"\1"', sql)

        # 2. Replace 'FROM ?' with 'FROM df'
        clean_sql = re.sub(r"\bFROM\s+\?", "FROM df", clean_sql, flags=re.IGNORECASE)

        # Query DuckDB directly against the in-memory pandas DataFrame
        result_df = duckdb.query(clean_sql).df()

        # Fill NaNs with None so it serializes properly into JSON
        result_df = result_df.fillna("")
        records = result_df.to_dict(orient="records")
        import math
        from datetime import datetime, date

        cleaned_records = []
        for r in records:
            clean_r = {}
            for k, v in r.items():
                if isinstance(v, (datetime, date)):
                    clean_r[str(k)] = v.isoformat()
                elif (
                    isinstance(v, float)
                    and (math.isnan(v) or math.isinf(v))
                    or pd.isna(v)
                ):
                    clean_r[str(k)] = None
                else:
                    clean_r[str(k)] = v
            cleaned_records.append(clean_r)

        return cleaned_records
    except Exception as error:
        print("SQL Execution Error:", error)
        return []
