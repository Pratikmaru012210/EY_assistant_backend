# Retail Analytics Assistant - Python FastAPI Backend

This is the Python (FastAPI) backend for the Retail Analytics Chatbot.

## Setup & Running

### 1. Activate Virtual Environment (PowerShell)
```powershell
.\venv\Scripts\Activate.ps1
```
*(Or in Command Prompt: `.\venv\Scripts\activate.bat`)*

### 2. Environment Variables (.env)
Make sure your `.env` contains:
```env
PORT=8000
GROQ_API_KEY=your_groq_api_key_here
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

### 3. Run the Server
Using Python:
```powershell
.\venv\Scripts\python main.py
```
Or directly with Uvicorn:
```powershell
.\venv\Scripts\uvicorn main:app --host 0.0.0.0 --port 5000 --reload
```

## API Endpoints
- `GET /` - Health check
- `POST /api/upload` - Upload `.xlsx` file and parse to memory
- `POST /api/upload/rehydrate` - Re-sync dataset from frontend IndexedDB
- `DELETE /api/upload` - Clear dataset from memory
- `POST /api/chat` - Chatbot analytics query (LLM + DuckDB SQL execution)
- `POST /api/chat/suggestions` - Auto-generate 10 analytical question suggestions
