import os
from dotenv import load_dotenv

# Load .env file
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from routes.upload_routes import router as upload_router
from routes.chat_routes import router as chat_router

app = FastAPI(title="Retail Analytics Assistant API", version="1.0.0")

# Setup CORS
allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "")
if allowed_origins_env:
    origins = [orig.strip() for orig in allowed_origins_env.split(",") if orig.strip()]
    if "*" in origins:
        origins = ["*"]
else:
    origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins != ["*"] else ["*"],
    allow_credentials=True if origins != ["*"] else False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(upload_router)
app.include_router(chat_router)


@app.get("/")
def health_check():
    return {"status": "ok", "message": "Retail Analytics FastAPI Backend is running."}


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
