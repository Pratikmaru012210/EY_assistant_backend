const express = require("express");
const Groq = require("groq-sdk");
const dataStore = require("../store/dataStore");
const router = express.Router();
const executePlan = require("../analytics/executePlan");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

router.post("/", async (req, res) => {
  try {
    const { question } = req.body;
    const data = dataStore.getData();
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
  "sql": "SELECT [column_name] AS [key], SUM([target_col]) AS [value] FROM ? GROUP BY [column_name] ORDER BY [value] DESC LIMIT 10"
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
  "sql": "your_sql_query"
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

    const summary = "Here is the data for your query:";

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

module.exports = router;
