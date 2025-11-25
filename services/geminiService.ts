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
  "extractedData": [] // Array of objects representing the main table data. LIMIT THIS TO 5 ROWS MAX.
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
   - Extract a SAMPLE of the actual data from the Target to populate 'extractedData'.
   - **CRITICAL: LIMIT EXTRACTED DATA TO 5 ROWS MAX.** 
   - DO NOT extract the entire dataset. This causes the response to be truncated and creates invalid JSON.
   - If the file is an image, perform OCR to get the text.
`;

// Helper to clean JSON output from LLM
const cleanJson = (text: string): string => {
  let cleaned = text.trim();
  // Remove markdown code blocks
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  
  // Fix common double-quote escaping issues sometimes produced by LLMs
  // e.g. ""key"" -> "key"
  cleaned = cleaned.replace(/""([^"]+)""/g, '"$1"');
  
  return cleaned.trim();
};

const fileToPart = async (file: File): Promise<any> => {
  // 1. Handle Excel Files (Parse client-side)
  // Check extension first as MIME type can be unreliable in some browsers
  if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.type.includes('spreadsheet') || file.type.includes('excel')) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      
      let textContent = `File Name: ${file.name}\nType: Excel Spreadsheet\n\n`;
      
      // Convert first 2 sheets to CSV for context
      const sheetsToRead = workbook.SheetNames.slice(0, 2); 
      sheetsToRead.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        textContent += `--- Sheet: ${sheetName} ---\n${csv}\n\n`;
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
  onLog: (msg: string) => void
): Promise<AnalysisResult> => {
  
  const ai = new GoogleGenAI({ apiKey });
  
  // Use 'gemini-2.5-flash' for fast, multimodal analysis
  // Switching to flash-thinking if complex logic is needed, but flash is usually good for layout
  const modelId = 'gemini-2.5-flash'; 

  onLog(`Initializing Gemini (${modelId})...`);
  
  if (target.type === 'file') {
    onLog(`Processing target file: ${target.file.name} (${target.file.type})...`);
  } else {
    onLog(`Processing target JSON data (Size: ${target.data.length} chars)...`);
  }

  const parts: any[] = [];

  // 1. Add Reference Library context
  if (referenceFiles.length > 0) {
    onLog(`Processing ${referenceFiles.length} reference templates...`);
    parts.push({ text: "REFERENCE LIBRARY FILES (Use these as templates if layout matches):" });
    
    for (const refFile of referenceFiles) {
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
    // Truncate if absolutely massive to avoid context limits, but 100k chars is usually fine for Gemini 2.5
    const truncatedJson = target.data.length > 100000 ? target.data.substring(0, 100000) + "\n...[TRUNCATED]" : target.data;
    parts.push({ text: truncatedJson });
  }

  // 3. Add System Instruction as text part (best practice for some SDK versions, 
  // though config.systemInstruction is also supported, putting it in prompt is robust)
  parts.push({ text: "Analyze the target above. Provide the output JSON." });

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
        temperature: 0.2, // Low temperature for consistent code generation
        responseMimeType: "application/json" 
      }
    });

    onLog("Response received. Parsing JSON...");
    
    // Correct way to access text with @google/genai SDK
    const responseText = result.text;
    
    if (!responseText) throw new Error("Empty response from AI");

    const cleanedText = cleanJson(responseText);
    
    try {
      const parsed = JSON.parse(cleanedText) as AnalysisResult;
      
      // Basic validation
      if (!parsed.summary || !parsed.pdfMakeCode || !parsed.excelJSCode) {
        throw new Error("Incomplete JSON structure returned");
      }

      onLog("Analysis successful!");
      return parsed;

    } catch (parseError) {
      console.error("JSON Parse Error:", parseError);
      console.log("Raw Output:", responseText);
      throw new Error("Failed to parse AI response. The model might have hallucinated invalid JSON.");
    }

  } catch (error: any) {
    console.error("Gemini API Error:", error);
    if (error.message.includes("400")) {
       throw new Error("API Error 400: Bad Request. If uploading Excel, ensure it is not password protected.");
    }
    throw error;
  }
};