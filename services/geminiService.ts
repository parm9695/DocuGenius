import { GoogleGenAI } from "@google/genai";
import { AnalysisResult } from "../types";

const SYSTEM_INSTRUCTION = `
You are an expert Document Layout Analyst and Senior Frontend Engineer. 
Your goal is to analyze a "Target File" (PDF, Excel, or Image) and generate specific JavaScript code libraries (pdfmake and ExcelJS) to recreate that document's structure and data.

You also have access to a "Reference Library" of files. 
1. Compare the "Target File" against the "Reference Files".
2. If the Target looks significantly like a Reference (similar headers, column layout, form structure), use the Reference as a "Template".
3. If no match is found, analyze the Target from scratch.

OUTPUT REQUIREMENTS:
Return a JSON object strictly following this schema. Do not return Markdown code blocks, just the raw JSON string.

Schema:
{
  "summary": {
    "fileType": "pdf" | "excel" | "image",
    "detectedTables": {
      "count": number,
      "dimensions": ["string"] // e.g. "4 cols x 12 rows"
    },
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
  "extractedData": [] // Array of objects representing the main table data. LIMIT THIS TO 20 ROWS MAX.
}

CODE GENERATION RULES:

1. **pdfmake**:
   - MUST import from '@/plugins/pdfmake-style'.
   - MUST return an async function named 'exportPDF'.
   - Use 'docDefination' (user's preferred spelling) variable.
   - If a template matched, reuse the layout (widths, margins) of that template.
   - Use 'layout: lightHorizontalLines' for tables.

2. **ExcelJS**:
   - MUST import 'exceljs' and 'file-saver'.
   - MUST return an async function named 'exportToExcel(data)'.
   - Handle merged cells for Titles/Subtitles if detected.
   - Apply borders and alignment as specified in the prompt requirements.

3. **Data**:
   - Extract a SAMPLE of the actual data from the Target File to populate 'extractedData'.
   - **CRITICAL: LIMIT EXTRACTED DATA TO 20 ROWS MAX.** 
   - DO NOT extract the entire dataset if it is large (hundreds of rows). This causes the response to be truncated and creates invalid JSON.
   - If the file is an image, perform OCR to get the text.
`;

const fileToPart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve({
        inlineData: {
          data: base64String,
          mimeType: file.type,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const analyzeDocument = async (
  apiKey: string,
  targetFile: File,
  referenceFiles: File[],
  onLog: (message: string) => void
): Promise<AnalysisResult> => {
  if (!apiKey) throw new Error("API Key is missing. Please provide a valid Gemini API Key.");

  onLog("Initializing Gemini 2.5 Flash client...");
  const ai = new GoogleGenAI({ apiKey });

  // specific model choice for multimodal capabilities
  const model = "gemini-2.5-flash"; 

  onLog(`Reading target file: ${targetFile.name} (${(targetFile.size / 1024).toFixed(2)} KB)...`);
  const targetPart = await fileToPart(targetFile);
  
  onLog(`Processing ${referenceFiles.length} reference files from library...`);
  // Prepare reference files parts
  const referenceParts = await Promise.all(referenceFiles.map(async (file, i) => {
    onLog(`Encoding reference #${i+1}: ${file.name}...`);
    return fileToPart(file);
  }));

  onLog("Constructing multimodal context payload...");
  // Construct the prompt content
  // We clearly label which image/file corresponds to what
  const promptParts: any[] = [];
  
  promptParts.push({ text: "--- REFERENCE LIBRARY START ---" });
  referenceFiles.forEach((file, index) => {
    promptParts.push({ text: `Reference File #${index + 1}: Filename: "${file.name}"` });
    promptParts.push(referenceParts[index]);
  });
  promptParts.push({ text: "--- REFERENCE LIBRARY END ---" });
  
  promptParts.push({ text: "--- TARGET FILE TO ANALYZE START ---" });
  promptParts.push({ text: `Target Filename: "${targetFile.name}"` });
  promptParts.push(targetPart);
  promptParts.push({ text: "--- TARGET FILE END ---" });
  
  promptParts.push({ text: "Perform the analysis, extraction, and code generation based on the system instructions. IMPORTANT: Limit 'extractedData' to maximum 20 items." });

  onLog("Sending request to Gemini API... (This may take a few seconds)");
  const response = await ai.models.generateContent({
    model: model,
    contents: {
      role: 'user',
      parts: promptParts
    },
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
    }
  });

  onLog("Response received from Gemini.");
  const responseText = response.text;
  if (!responseText) throw new Error("No response from Gemini");

  onLog("Parsing generated code and analysis...");
  try {
    // Strip markdown fences if present
    const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanedText);
    onLog("Analysis complete!");
    return parsed as AnalysisResult;
  } catch (e) {
    console.error("Failed to parse JSON", responseText);
    if (responseText.length > 5000) {
        throw new Error("AI response was too large and got truncated. We've adjusted the settings to limit data extraction. Please try again.");
    }
    throw new Error("AI response was not valid JSON. Please try again.");
  }
};