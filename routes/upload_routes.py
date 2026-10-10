import io
from typing import Annotated, Any

import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel
from store.data_store import data_store

router = APIRouter(prefix="/api/upload", tags=["Upload"])


class RehydrateRequest(BaseModel):
    jsonData: list[dict[str, Any]]


@router.post("")
@router.post("/")
async def upload_file(file: Annotated[UploadFile, File()]):
    try:
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        # Read excel from memory buffer using pandas / openpyxl
        df = pd.read_excel(io.BytesIO(contents))

        # Replace NaN / NaT / Inf with None or serializable values
        df = df.fillna("")
        raw_records = df.to_dict(orient="records")

        # Ensure all types (timestamps, nulls, float('nan')) are JSON-safe
        import math
        from datetime import date, datetime

        cleaned_data = []
        for row in raw_records:
            clean_row = {}
            for k, v in row.items():
                if isinstance(v, (datetime, date)):
                    clean_row[str(k)] = v.isoformat()
                elif (
                    isinstance(v, float)
                    and (math.isnan(v) or math.isinf(v))
                    or pd.isna(v)
                ):
                    clean_row[str(k)] = None
                else:
                    clean_row[str(k)] = v
            cleaned_data.append(clean_row)

        json_data = cleaned_data

        if not json_data or len(json_data) == 0:
            raise HTTPException(status_code=400, detail="The Excel sheet is empty.")

        data_store.set_data(json_data)

        return {
            "success": True,
            "rows": len(json_data),
            "columns": list(json_data[0].keys()),
            "sampleRow": json_data[0],
            "jsonData": json_data,
        }
    except HTTPException:
        raise
    except Exception as err:
        print("Upload Route Error:", err)
        raise HTTPException(status_code=500, detail=str(err))


@router.post("/rehydrate")
async def rehydrate_data(payload: RehydrateRequest):
    try:
        json_data = payload.jsonData
        if not json_data or not isinstance(json_data, list) or len(json_data) == 0:
            raise HTTPException(
                status_code=400, detail="Invalid jsonData provided for rehydration."
            )

        data_store.set_data(json_data)
        return {
            "success": True,
            "rows": len(json_data),
            "columns": list(json_data[0].keys()),
        }
    except HTTPException:
        raise
    except Exception as err:
        print("Rehydrate Route Error:", err)
        raise HTTPException(status_code=500, detail=str(err))


@router.delete("")
@router.delete("/")
async def delete_data():
    data_store.clear()
    return {
        "success": True,
        "message": "Database cleared successfully from server RAM.",
    }

