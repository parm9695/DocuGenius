import { GoogleGenAI } from "@google/genai";
import { AnalysisResult } from "../types";
import * as XLSX from "xlsx";

const SYSTEM_INSTRUCTION = `
You are an expert Document Layout Analyst and Senior Frontend Engineer. 
Your goal is to analyze a "Target" (PDF, Excel, Image, or JSON Data) and generate specific JavaScript code libraries (pdfmake and ExcelJS) to recreate that document's structure and data.

You also have access to a "Reference Library" of files. 
1. Compare the "Target" against the "Reference Files".
2. If the Target looks significantly like a Reference (similar headers, column layout, form structure), use the Reference as a "Template".
3. If no match is found, analyze the Target from scratch.

**IF TARGET IS JSON DATA:**
- The provided JSON is the *source of truth* for the data structure.
- Create a report layout that best fits this data structure.
- Map the JSON keys to column headers intelligently (e.g., "empName" -> "Employee Name").
- Generate code that expects an array of objects matching this JSON structure.

**DETECTED STRUCTURES:**
- Look for **Forms**: Input fields, checkboxes, signature lines.
- Look for **Key-Value Pairs**: "Name: ...", "Date: ...".
- Look for **Tables**: Grids, headers, rows.
- Look for **Sections**: Headers grouping content.

OUTPUT REQUIREMENTS:
Return a JSON object strictly following this schema. Do not return Markdown code blocks, just the raw JSON string.

Schema:
{
  "summary": {
    "fileType": "pdf" | "excel" | "image" | "json",
    "detectedTables": {
      "count": number,
      "dimensions": ["string"] // e.g. "4 cols x 12 rows"
    },
    "detectedForms": [ // List identified form fields
       { "label": "string", "type": "text|checkbox|signature", "location": "string" }
    ], 
    "keyAttributes": [ // List detected key-value pairs found in headers or body
       { "key": "string", "value": "string" }
    ],
    "headers": {
      "title": "string",
      "subtitle": "string"
    },
    "matchedTemplate": {
      "isMatch": boolean,
      "templateName": "string", // Name of the reference file matched, or null
      "reasoning": "string" // Why it matched or why it didn't
    }
  },
  "pdfMakeCode": "string", // The full JavaScript function string. It must accept 'data' as a parameter.
  "excelJSCode": "string", // The full JavaScript function string. It must accept 'data' as a parameter.
  "extractedData": [] // Array of objects representing the main table data. LIMIT THIS TO 1 ROW MAX.
}

CODE GENERATION RULES:

1. **pdfmake**:
   - MUST import from '@/plugins/pdfmake-style'.
   - MUST return an async function named 'exportPDF'.
   - Use 'docDefination' (user's preferred spelling) variable.
   - If a form is detected, use 'columns' or 'table' with 'noBorders' to simulate form layouts.
   - If a template matched, reuse the layout (widths, margins) of that template.
   - Use 'layout: lightHorizontalLines' for standard tables.
   - **MINIFY CODE**: Remove comments and unnecessary whitespace to save tokens.

2. **ExcelJS**:
   - MUST import 'exceljs' and 'file-saver'.
   - MUST return an async function named 'exportToExcel(data)'.
   - Handle merged cells for Titles/Subtitles if detected.
   - Apply borders and alignment as specified in the prompt requirements.
   - **MINIFY CODE**: Remove comments and unnecessary whitespace to save tokens.

3. **Data**:
   - Extract a SAMPLE of the actual data from the Target to populate 'extractedData'.
   - **CRITICAL: RETURN AN EMPTY ARRAY [] OR MAX 1 ROW SAMPLE.** 
   - DO NOT extract the entire dataset. This causes the response to be truncated and creates invalid JSON.
   - If the file is an image, perform OCR to get the text.
`;

// Helper to clean JSON output from LLM
const cleanJson = (text: string): string => {
  let cleaned = text.trim();
  
  // 1. Strip Markdown Code Fences (Standard)
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  
  // 2. Aggressive Extract: Find first '{' and last '}'
  // This ignores any text before or after the JSON block
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  // 3. Common LLM Fixes
  // Fix double-quote escaping issues: ""key"" -> "key"
  cleaned = cleaned.replace(/""([^"]+)""/g, '"$1"');
  
  return cleaned.trim();
};

// Robust parser that tries to fix truncated JSON
const parseRobustJson = (text: string): AnalysisResult => {
  try {
    // Attempt 1: Clean and Parse
    const cleaned = cleanJson(text);
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn("Standard parse failed, attempting repair...", e);
    
    // Attempt 2: Truncation Repair
    // If the JSON ends unexpectedly, it might be truncated.
    // We'll try to close open structures.
    let repaired = cleanJson(text);
    
    // Count brackets to see if we need to close them
    const openBraces = (repaired.match(/\{/g) || []).length;
    const closeBraces = (repaired.match(/\}/g) || []).length;
    const openSquares = (repaired.match(/\[/g) || []).length;
    const closeSquares = (repaired.match(/\]/g) || []).length; // Fixed regex for closing square bracket

    if (openBraces > closeBraces) {
      repaired += '}'.repeat(openBraces - closeBraces);
    }
    if (openSquares > closeSquares) {
      repaired += ']'.repeat(openSquares - closeSquares);
    }

    try {
      return JSON.parse(repaired);
    } catch (e2) {
      console.error("Repair failed:", e2);
      throw new Error("Failed to parse AI response. The model output may have been truncated due to complexity. Try simplifying the document.");
    }
  }
};

const fileToPart = async (file: File): Promise<any> => {
  // 1. Handle Excel Files (Parse client-side)
  // Check extension first as MIME type can be unreliable in some browsers
  if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.type.includes('spreadsheet') || file.type.includes('excel')) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      
      let textContent = `File Name: ${file.name}\nType: Excel Spreadsheet\n\n`;
      
      // Convert first 2 sheets to CSV for context, but LIMIT rows to save tokens
      const sheetsToRead = workbook.SheetNames.slice(0, 2); 
      sheetsToRead.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        // Use sheet_to_json to easily limit rows
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }).slice(0, 50); // LIMIT TO 50 ROWS
        if (rows.length === 0) return;
        
        const csv = rows.map((row: any) => (Array.isArray(row) ? row.join(",") : "")).join("\n");
        textContent += `--- Sheet: ${sheetName} (First 50 rows) ---\n${csv}\n\n`;
      });

      return { text: textContent };
    } catch (e) {
      console.error("Error parsing Excel file:", e);
      return { text: `Error parsing Excel file ${file.name}` };
    }
  }

  // 2. Handle PDFs and Images (Send as binary)
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Remove data URL prefix (e.g. "data:image/jpeg;base64,")
      const base64Data = base64String.split(',')[1];
      
      resolve({
        inlineData: {
          data: base64Data,
          mimeType: file.type
        }
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const analyzeDocument = async (
  apiKey: string,
  target: { type: 'file'; file: File } | { type: 'json'; data: string },
  referenceFiles: File[],
  onLog: (msg: string) => void,
  additionalInstructions?: string
): Promise<AnalysisResult> => {
  
  const ai = new GoogleGenAI({ apiKey });
  
  // Use 'gemini-2.5-flash' for fast, multimodal analysis
  const modelId = 'gemini-2.5-flash'; 

  onLog(`Initializing Gemini (${modelId})...`);
  
  if (target.type === 'file') {
    onLog(`Processing target file: ${target.file.name} (${target.file.type})...`);
  } else {
    onLog(`Processing target JSON data (Size: ${target.data.length} chars)...`);
  }

  const parts: any[] = [];

  // 1. Add Reference Library context (LIMITED to prevent token overflow)
  if (referenceFiles.length > 0) {
    const MAX_REFS = 3; // Limit number of reference files sent
    const refsToSend = referenceFiles.slice(0, MAX_REFS);
    
    onLog(`Processing ${refsToSend.length} reference templates (limited to max ${MAX_REFS} to save tokens)...`);
    parts.push({ text: "REFERENCE LIBRARY FILES (Use these as templates if layout matches):" });
    
    for (const refFile of refsToSend) {
      try {
        const refPart = await fileToPart(refFile);
        // If it's text (parsed Excel), just add it
        if (refPart.text) {
           parts.push({ text: `[Reference File: ${refFile.name}]\n${refPart.text}` });
        } else {
           // For images/PDFs, add a label before the inline data
           parts.push({ text: `[Reference File: ${refFile.name}]` });
           parts.push(refPart);
        }
      } catch (e) {
        onLog(`Warning: Failed to process reference file ${refFile.name}`);
      }
    }
  }

  // 2. Add Target (File or JSON)
  if (target.type === 'file') {
    parts.push({ text: "TARGET FILE TO ANALYZE:" });
    try {
      const targetPart = await fileToPart(target.file);
      parts.push(targetPart);
    } catch (e) {
      throw new Error("Failed to process target file. Please ensure it is a valid PDF, Image, or Excel file.");
    }
  } else {
    // Target is JSON
    parts.push({ text: "TARGET DATA (JSON Source):" });
    // Truncate to 50k chars to be safe
    const truncatedJson = target.data.length > 50000 ? target.data.substring(0, 50000) + "\n...[TRUNCATED]" : target.data;
    parts.push({ text: truncatedJson });
  }

  // 3. Add Instructions
  let promptText = "Analyze the target above. Provide the output JSON.";
  if (additionalInstructions && additionalInstructions.trim().length > 0) {
    promptText += `\n\nUSER EXTRA INSTRUCTIONS (PRIORITY):\n${additionalInstructions}`;
  }
  parts.push({ text: promptText });

  onLog("Sending data to Gemini API...");

  try {
    const result = await ai.models.generateContent({
      model: modelId,
      contents: {
        role: "user",
        parts: parts
      },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2, 
        responseMimeType: "application/json" 
      }
    });

    onLog("Response received. Parsing JSON...");
    
    const responseText = result.text;
    
    if (!responseText) throw new Error("Empty response from AI");

    const parsed = parseRobustJson(responseText);
      
    // Basic validation
    if (!parsed.summary || !parsed.pdfMakeCode || !parsed.excelJSCode) {
      throw new Error("Incomplete JSON structure returned");
    }

    // --- Fix: Ensure types match interface to prevent UI crashes ---
    if (parsed.summary?.detectedTables) {
       // Ensure dimensions is an array. AI might return a string like "2x2".
       if (!Array.isArray(parsed.summary.detectedTables.dimensions)) {
          const val = parsed.summary.detectedTables.dimensions;
          parsed.summary.detectedTables.dimensions = val ? [String(val)] : [];
       }
       // Ensure count is a number
       if (typeof parsed.summary.detectedTables.count !== 'number') {
          parsed.summary.detectedTables.count = Number(parsed.summary.detectedTables.count) || 0;
       }
    } else if (parsed.summary) {
       parsed.summary.detectedTables = { count: 0, dimensions: [] };
    }

    onLog("Analysis successful!");
    return parsed;

  } catch (error: any) {
    console.error("Gemini API Error:", error);
    if (error.message?.includes("400") || error.message?.includes("INVALID_ARGUMENT")) {
       if (error.message?.includes("token count")) {
         throw new Error("Input too large: The Reference Library or Target File exceeds the token limit. Try removing some reference files.");
       }
       throw new Error("API Error 400: Bad Request. If uploading Excel, ensure it is not password protected.");
    }
    throw error;
  }
};