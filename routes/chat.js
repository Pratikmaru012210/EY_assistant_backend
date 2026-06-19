const express = require("express");
const Groq = require("groq-sdk");
const dataStore = require("../store/dataStore");
const router = express.Router();
const executePlan = require("../analytics/executePlan");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Helper to download files from ImageKit (supports both global fetch and legacy node https fallback)
const fetchFileBuffer = async (url) => {
  if (typeof fetch === 'function') {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } else {
    return new Promise((resolve, reject) => {
      const https = require('https');
      https.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download file: ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', (err) => reject(err));
      }).on('error', (err) => reject(err));
    });
  }
};

router.post("/", async (req, res) => {
  try {
    const { question, fileUrl } = req.body;
    let data = dataStore.getData();

    // Self-healing: if memory was wiped (e.g., server restart/serverless scale down) but we have a fileUrl
    if ((!data || data.length === 0) && fileUrl) {
      console.log(`Memory is empty but fileUrl is provided. Re-fetching and parsing Excel from: ${fileUrl}...`);
      try {
        const fileBuffer = await fetchFileBuffer(fileUrl);
        const XLSX = require("xlsx");
        const workbook = XLSX.read(fileBuffer, { type: "buffer" });
        const sheetNames = workbook.SheetNames;
        const firstSheet = workbook.Sheets[sheetNames[0]];
        data = XLSX.utils.sheet_to_json(firstSheet);
        dataStore.setData(data);
        console.log(`Successfully restored memory from ImageKit. Row count: ${data.length}`);
      } catch (restoreErr) {
        console.error("Self-healing restoration failed:", restoreErr);
      }
    }

    const columns = (data && data.length > 0) ? Object.keys(data[0]) : [];

    // Quick local check for common greetings to respond instantly and save API resources
    const cleanedQuestion = (question || "").trim().toLowerCase().replace(/[^\w\s]/g, "");
    const quickGreetings = ["hi", "hello", "hey", "greetings", "good morning", "good afternoon", "good evening", "yo"];
    if (quickGreetings.includes(cleanedQuestion) || cleanedQuestion === "") {
      return res.json({
        plan: { type: "general" },
        result: null,
        summary: "Hello! I am your retail analytics assistant. How can I help you analyze your retail data today? Please ask a query related to sales, transactions, discounts, regions, or store managers."
      });
    }

    const prompt = `
You are a retail analytics assistant.
Analyze the user's question:
"${question}"

Available columns in our loaded database:
${columns.join("\n")}

If the question is a general query, greeting, or social talk (e.g., "Hi", "Hello", "How are you", "What is this?"), classify it as "general" and provide a helpful, friendly message asking the user to ask a query related to their loaded retail data (such as sales, transactions, discounts, regions, or store managers).

If the question is about analyzing the loaded retail data, classify it as "query" and generate a standard SQL query to answer it.

Return ONLY a JSON object:
For general queries:
{
  "type": "general",
  "message": "Your friendly response asking the user for a retail-related data query."
}

For data queries:
{
  "type": "query",
  "sql": "SELECT [column_name] AS [key], SUM([target_col]) AS [value] FROM ? GROUP BY [column_name] ORDER BY [value] DESC LIMIT 10",
  "summary": "A short, professional summary of what the user asked and what data is being retrieved to answer it (strictly 3 to 6 lines max)."
}
`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `
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

Never return code blocks (like \`\`\`json), explanations, or markdown. Only return the raw JSON object.

SQL Query Rules:
1. The table name in the query must always be "?" (which represents the in-memory array of objects).
2. If column names contain spaces or special characters (like % or date), they MUST be enclosed in square brackets (e.g., [Manual Discount Amount], [Approved By], [Txn Date]).
3. When summarizing, grouping, or aggregating data for charts and lists, alias the group column as [key] and the aggregated value as [value] (e.g., SELECT [Store Name] AS [key], SUM([Gross Sales]) AS [value] FROM ? GROUP BY [Store Name]).
4. For ranking/top/most questions (e.g., "highest", "top", "most"), use ORDER BY [value] DESC and LIMIT 10 (or the number requested by the user).
5. For percentage questions, return the percentage value directly.
`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      model: "openai/gpt-oss-120b",
    });

    const generatedCode = completion.choices[0].message.content;

    const cleanCode = generatedCode
      .replace(/```javascript/g, "")
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const jsonText = cleanCode.replace("json", "").trim();

    let plan;
    try {
      plan = JSON.parse(jsonText);
    } catch (parseErr) {
      console.error("JSON parse error on text:", jsonText);
      if (jsonText.includes("SELECT") || jsonText.includes("select")) {
        plan = { type: "query", sql: jsonText };
      } else {
        throw parseErr;
      }
    }

    if (!plan.type && plan.sql) {
      plan.type = "query";
    }

    if (plan.type === "general") {
      return res.json({
        plan,
        result: null,
        summary: plan.message || "Hello! I am your retail analytics assistant. How can I help you analyze your retail data today? Please ask a query related to sales, transactions, discounts, or regions."
      });
    }

    console.log("PLAN:");
    console.log(plan);

    const result = executePlan(data, plan);

    // Helper function to check if the query result has no useful data or only zero/null records
    const isResultEmpty = (resList) => {
      if (!resList || !Array.isArray(resList) || resList.length === 0) {
        return true;
      }
      return resList.every(row => {
        const values = Object.values(row);
        if (values.length === 0) return true;
        return values.every(val => {
          if (val === null || val === undefined || val === "") return true;
          if (typeof val === 'number' && val === 0) return true;
          if (typeof val === 'string' && (val === '0' || val.toLowerCase() === 'n/a' || val.trim() === '')) return true;
          return false;
        });
      });
    };

    if (isResultEmpty(result)) {
      return res.json({
        plan,
        result: null,
        summary: "No data found matching your query. Please check if the filter values are correct (e.g. spelling of regions, categories, or names) or try asking a different question."
      });
    }

    const summary = plan.summary || "Here is the data for your query:";

    return res.json({
      plan,
      result,
      summary,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      error: err.message,
    });
  }
});

router.post("/suggestions", async (req, res) => {
  try {
    const { columns, fileUrl } = req.body;
    if (!columns || !Array.isArray(columns) || columns.length === 0) {
      return res.status(400).json({ error: "Columns array is required and must not be empty." });
    }

    let data = dataStore.getData();

    // Self-healing: if memory was wiped but we have a fileUrl
    if ((!data || data.length === 0) && fileUrl) {
      console.log(`[Suggestions] Memory is empty but fileUrl is provided. Re-fetching and parsing Excel from: ${fileUrl}...`);
      try {
        const fileBuffer = await fetchFileBuffer(fileUrl);
        const XLSX = require("xlsx");
        const workbook = XLSX.read(fileBuffer, { type: "buffer" });
        const sheetNames = workbook.SheetNames;
        const firstSheet = workbook.Sheets[sheetNames[0]];
        data = XLSX.utils.sheet_to_json(firstSheet);
        dataStore.setData(data);
        console.log(`[Suggestions] Successfully restored memory from ImageKit. Row count: ${data.length}`);
      } catch (restoreErr) {
        console.error("[Suggestions] Self-healing restoration failed:", restoreErr);
      }
    }

    const dataSample = (data && data.length > 0) ? data.slice(0, 5) : [];

    const prompt = `
You are a retail database query assistant.
Given the following column names from a loaded database table:
${columns.map(c => `- ${c}`).join("\n")}

${dataSample.length > 0 ? `Here is a sample of the first 5 rows from the loaded database table to give you context on the data types and actual values:
${JSON.stringify(dataSample, null, 2)}` : ""}

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
`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a helpful retail database assistant. You always respond ONLY with a raw JSON array of strings containing simple, direct, single-table analytical questions based on the columns and sample data provided. Never output any markdown code blocks, HTML, or other text.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      model: "openai/gpt-oss-120b",
    });

    const generatedCode = completion.choices[0].message.content;
    const match = generatedCode.match(/\[\s*[\s\S]*?\s*\]/);
    let suggestions;

    if (match) {
      suggestions = JSON.parse(match[0]);
    } else {
      const cleanCode = generatedCode
        .replace(/```javascript/g, "")
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
      const jsonText = cleanCode.replace("json", "").trim();
      suggestions = JSON.parse(jsonText);
    }

    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      throw new Error("Invalid suggestions response from AI");
    }

    return res.json({ suggestions });
  } catch (err) {
    console.error("Suggestions Route Error:", err);
    // Return standard fallback suggestions if AI generation fails
    return res.json({
      suggestions: [
        "Which store manager has the highest average manual discount amount?",
        "What is the total gross sales by region?",
        "What percentage of transactions had a manual discount?",
        "List the top 5 product categories by gross sales.",
        "Which manual discount reasons are used most frequently?",
        "Average manual discount % for each store in West region",
        "Which stores have the highest manual discounts?",
        "Which regions have the highest manual discounts?",
        "Which store manager gave the lowest manual discount %?",
        "Which items are best selling?"
      ]
    });
  }
});

module.exports = router;
