import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { AnalysisResult } from "../types";
import * as XLSX from "xlsx";

const SYSTEM_INSTRUCTION = `
You are an expert Document Layout Analyst and Frontend Engineer. 
Analyze the "Target" (PDF, Excel, Image, or JSON) and generate specific JS code (pdfmake/ExcelJS) to recreate it.

**OCR PRECISION PROTOCOL (CRITICAL):**
1. **VERBATIM EXTRACTION**: Extract text exactly as it appears. Do not summarize or autocorrect.
2. **THAI LANGUAGE SUPPORT**: Pay extreme attention to Thai vowels (e.g., ะ, า, ิ, ี) and tone marks (e.g., ่, ้). Ensure they are attached to the correct consonants and not dropped.
3. **NUMERICAL ACCURACY**: Ensure IDs, prices, dates, and amounts are digit-perfect.
4. **TABLE STRUCTURE**: Identify merged cells (rowspan/colspan) accurately, even if borders are faint.

Reference Library Strategy:
1. **CHECK Reference Files first.**
2. If a Reference File contains **CODE** (JS/JSON), **ADAPT** that code structure for the Target.
3. If a Reference File is a visual document, use it as a layout template.

Output Schema (Strict JSON):
{
  "summary": {
    "fileType": "pdf|excel|image|json",
    "detectedTables": { "count": number, "dimensions": ["string"] },
    "headers": { "title": "string", "subtitle": "string" },
    "matchedTemplate": { "isMatch": boolean, "templateName": "string" }
  },
  "pdfMakeCode": "string", // ASYNC FUNCTION 'exportPDF(data)' returning docDefinition.
  "excelJSCode": "string", // ASYNC FUNCTION 'exportToExcel(data)'.
  "extractedData": [] | {} // The data passed to functions. Can be Array or Object.
}

RULES:
1. **pdfmake**:
   - Return async function 'exportPDF(data)'.
   - **CRITICAL DATA MAPPING**: 
     - The 'data' argument passed to exportPDF exactly matches 'extractedData'.
     - If 'extractedData' is an Array, 'data' is that Array.
     - If 'extractedData' is an Object, 'data' is that Object.
   - **SAFETY**: 
     - **NEVER** access properties of potentially undefined objects (e.g. \`data.header.docType\` -> \`data?.header?.docType\`).
     - **PREVENT CRASHES**: Guard against "Cannot read properties of undefined".
     - **EMPTY DATA HANDLING**: If 'data' is null, undefined, or empty, return a valid document definition with a "No Data Available" message instead of crashing.
   - **MODULARITY**: Break docDefinition into helper functions (e.g., \`createHeader\`, \`createTable\`). Call them in main function.
   - Use 'layout: lightHorizontalLines'.
   - **NO UNDEFINED VARS**: Define everything.
   - **Fill-in Lines**: Use \`'.'.repeat(N)\`. N MUST be integer literal (e.g. 120). Approx 2pt/dot. Page width ~515pt.

2. **ExcelJS**:
   - Return async function 'exportToExcel(data)'.
   - Use 'exceljs' and 'file-saver'.
   - **SAFETY**: Check if data exists before iterating.

3. **General**:
   - **JSON Format**: Standard JSON. Do NOT double-escape newlines. Use actual newlines in strings if needed, or single escape \\n.
   - **Conciseness**: Minimize comments.
`;

// --- CLEANUP & EXTRACTION UTILITIES ---

const cleanJson = (text: string): string => {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
};

const unescapeJsonString = (str: string): string => {
  if (!str) return "";
  return str
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
};

const fixEscapedNewlines = (code: string): string => {
    if (!code) return code;
    return code
        .replace(/\\n\s*\/\//g, '\n //') 
        .replace(/\/\/(.*?)\\n/g, '//$1\n')
        .replace(/;\s*\\n/g, ';\n')      
        .replace(/{\s*\\n/g, '{\n')      
        .replace(/}\s*\\n/g, '}\n')      
        .replace(/,\s*\\n/g, ',\n')      
        .replace(/\[\s*\\n/g, '[\n')     
        .replace(/\)\s*\\n/g, ')\n');    
};

const fuzzyExtractBetweenKeys = (fullText: string, keyStart: string, keyEnd: string | null): string | null => {
  const startRegex = new RegExp(`["']${keyStart}["']\\s*:\\s*["']`, 'i');
  const startMatch = fullText.match(startRegex);
  
  if (!startMatch || typeof startMatch.index === 'undefined') return null;
  
  const contentStartIndex = startMatch.index + startMatch[0].length;
  let contentEndIndex = -1;

  if (keyEnd) {
    const endRegex = new RegExp(`["'],\\s*[\\r\\n]*\\s*["']${keyEnd}["']`, 'i');
    const rest = fullText.slice(contentStartIndex);
    const endMatch = rest.match(endRegex);
    if (endMatch && typeof endMatch.index !== 'undefined') {
      contentEndIndex = contentStartIndex + endMatch.index;
    }
  }

  if (contentEndIndex === -1) {
      const lastQuote = fullText.lastIndexOf('"');
      if (lastQuote > contentStartIndex) {
          contentEndIndex = lastQuote;
      } else {
          contentEndIndex = fullText.length;
      }
  }

  const rawContent = fullText.substring(contentStartIndex, contentEndIndex);
  return unescapeJsonString(rawContent);
};

const extractJsonObject = (fullText: string, key: string): any => {
  const keyRegex = new RegExp(`(["']?)${key}\\1\\s*:\\s*({)`, 'i');
  const match = fullText.match(keyRegex);
  
  if (!match || typeof match.index === 'undefined') return null;
  
  const startIdx = match.index + match[0].length - 1; 
  let balance = 0;
  let i = startIdx;
  
  while (i < fullText.length) {
    const char = fullText[i];
    if (char === '{') balance++;
    else if (char === '}') balance--;
    
    if (balance === 0) {
      try {
        const jsonBlock = fullText.substring(startIdx, i + 1);
        return JSON.parse(jsonBlock);
      } catch (e) {
        return null;
      }
    }
    i++;
  }
  return null;
}

const extractFunctionFallback = (fullText: string, funcName: string): string | null => {
  const regex = new RegExp(`(async\\s+function\\s+${funcName}\\s*\\(|const\\s+${funcName}\\s*=\s*async)`, 'i');
  const match = fullText.match(regex);
  
  if (!match || typeof match.index === 'undefined') return null;
  
  const startSearch = match.index;
  let openBraces = 0;
  let funcStart = -1;
  let foundStart = false;
  
  for (let i = startSearch; i < fullText.length; i++) {
    const char = fullText[i];
    if (char === '{') {
      if (!foundStart) {
        funcStart = i;
        foundStart = true;
      }
      openBraces++;
    } else if (char === '}') {
      openBraces--;
    }

    if (foundStart && openBraces === 0) {
      return fullText.substring(match.index, i + 1);
    }
  }
  return null;
}

const parseRobustJson = (text: string): AnalysisResult => {
  const current = cleanJson(text);

  // 1. Try Standard Parse
  try {
    const result = JSON.parse(current);
    if (result.pdfMakeCode) {
        result.pdfMakeCode = fixEscapedNewlines(result.pdfMakeCode);
        result.excelJSCode = fixEscapedNewlines(result.excelJSCode);
        if (result.extractedData === undefined || result.extractedData === null) {
          result.extractedData = [];
        }
        return result;
    }
  } catch (e) {
    // Continue
  }

  // 2. Try Fixing Common JSON Issues
  let fixedChars = current.replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":');
  try {
    const result = JSON.parse(fixedChars);
    if (result.pdfMakeCode) {
        result.pdfMakeCode = fixEscapedNewlines(result.pdfMakeCode);
        result.excelJSCode = fixEscapedNewlines(result.excelJSCode);
        if (result.extractedData === undefined || result.extractedData === null) {
          result.extractedData = [];
        }
        return result;
    }
  } catch (e) {
    console.warn("Standard parsing failed. Attempting fuzzy extraction...");
  }

  // 3. Fuzzy Extraction
  try {
      let pdfMakeCode = fuzzyExtractBetweenKeys(current, "pdfMakeCode", "excelJSCode");
      let excelJSCode = fuzzyExtractBetweenKeys(current, "excelJSCode", "extractedData");
      
      if (!pdfMakeCode || pdfMakeCode.length < 50) {
         pdfMakeCode = extractFunctionFallback(text, "exportPDF");
      }
      if (!excelJSCode || excelJSCode.length < 50) {
         excelJSCode = extractFunctionFallback(text, "exportToExcel");
      }

      if (pdfMakeCode && !pdfMakeCode.includes("import")) {
          pdfMakeCode = "// Imports added by system\nimport { text } from '@/plugins/pdfmake-style';\n\n" + pdfMakeCode;
      }
      if (excelJSCode && !excelJSCode.includes("import")) {
          excelJSCode = "// Imports added by system\nimport ExcelJS from 'exceljs';\nimport { saveAs } from 'file-saver';\n\n" + excelJSCode;
      }
      
      if (pdfMakeCode) pdfMakeCode = fixEscapedNewlines(pdfMakeCode);
      if (excelJSCode) excelJSCode = fixEscapedNewlines(excelJSCode);

      let summary = extractJsonObject(current, "summary") || { 
          fileType: "unknown", 
          detectedTables: { count: 0, dimensions: [] },
          headers: { title: "Generated Document", subtitle: "" }
      };

      let extractedData: any = [];
      try {
        const keyMatch = current.match(/["']?extractedData["']?\s*:/);
        if (keyMatch && typeof keyMatch.index !== 'undefined') {
            const afterKeyIndex = keyMatch.index + keyMatch[0].length;
            const remaining = current.slice(afterKeyIndex);
            const startCharMatch = remaining.match(/(\[|\{)/);
            
            if (startCharMatch && typeof startCharMatch.index !== 'undefined') {
                const startChar = startCharMatch[0]; 
                const relativeStart = startCharMatch.index;
                const absoluteStart = afterKeyIndex + relativeStart;
                
                let balance = 0;
                let openChar = startChar;
                let closeChar = startChar === '[' ? ']' : '}';
                
                for(let i=absoluteStart; i<current.length; i++) {
                     if(current[i] === openChar) balance++;
                     if(current[i] === closeChar) balance--;
                     if(balance === 0) {
                         const jsonStr = current.substring(absoluteStart, i+1);
                         extractedData = JSON.parse(jsonStr);
                         break;
                     }
                }
            }
        }
      } catch (e) {
          console.warn("Failed to manually extract data, using empty array");
      }

      if (pdfMakeCode || excelJSCode) {
          return {
              summary,
              pdfMakeCode: pdfMakeCode || "// PDF generation code failed to generate.",
              excelJSCode: excelJSCode || "// Excel generation code failed to generate.",
              extractedData
          };
      }
      
      throw new Error("Could not extract any code blocks manually.");

  } catch (e2) {
      console.error("All Parsing Attempts Failed:", e2);
      throw new Error("Failed to parse AI response. The model output was likely truncated or malformed.");
  }
};

const fileToPart = async (file: File): Promise<any> => {
  const lowerName = file.name.toLowerCase();

  if (file.type.startsWith('text/') || 
      lowerName.endsWith('.js') || 
      lowerName.endsWith('.jsx') || 
      lowerName.endsWith('.ts') || 
      lowerName.endsWith('.tsx') || 
      lowerName.endsWith('.json') || 
      lowerName.endsWith('.txt') || 
      lowerName.endsWith('.md') ||
      lowerName.endsWith('.css') ||
      lowerName.endsWith('.html')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const content = text.length > 50000 ? text.substring(0, 50000) + "\n...[TRUNCATED]" : text;
        resolve({ text: `[Reference Code/Text File: ${file.name}]\n${content}` });
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || file.type.includes('spreadsheet') || file.type.includes('excel')) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      let textContent = `File Name: ${file.name}\nType: Excel Spreadsheet\n\n`;
      const sheetsToRead = workbook.SheetNames.slice(0, 2); 
      sheetsToRead.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }).slice(0, 50); 
        if (rows.length === 0) return;
        const csv = rows.map((row: any) => (Array.isArray(row) ? row.join(",") : "")).join("\n");
        textContent += `--- Sheet: ${sheetName} (First 50 rows) ---\n${csv}\n\n`;
      });
      return { text: textContent };
    } catch (e) {
      return { text: `Error parsing Excel file ${file.name}` };
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
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
  
  // PRIMARY MODEL: Gemini 3 Pro (Best for OCR/Layout)
  // FALLBACK MODEL: Gemini 2.5 Flash (Faster, higher limits)
  let modelId = 'gemini-3-pro-preview'; 

  onLog(`Initializing analysis with ${modelId}...`);
  
  const parts: any[] = [];

  if (referenceFiles.length > 0) {
    const MAX_REFS = 3; 
    const refsToSend = referenceFiles.slice(0, MAX_REFS);
    onLog(`Processing ${refsToSend.length} reference templates...`);
    parts.push({ text: "REFERENCE LIBRARY FILES (Use these as templates if layout matches):" });
    for (const refFile of refsToSend) {
      try {
        const refPart = await fileToPart(refFile);
        if (refPart.text) {
           parts.push({ text: `[Reference File: ${refFile.name}]\n${refPart.text}` });
        } else {
           parts.push({ text: `[Reference File: ${refFile.name}]` });
           parts.push(refPart);
        }
      } catch (e) {
        onLog(`Warning: Failed to process reference file ${refFile.name}`);
      }
    }
  }

  if (target.type === 'file') {
    onLog(`Processing target file: ${target.file.name}...`);
    parts.push({ text: "TARGET FILE TO ANALYZE:" });
    try {
      const targetPart = await fileToPart(target.file);
      parts.push(targetPart);
    } catch (e) {
      throw new Error("Failed to process target file.");
    }
  } else {
    onLog(`Processing target JSON data...`);
    parts.push({ text: "TARGET DATA (JSON Source):" });
    const truncatedJson = target.data.length > 30000 ? target.data.substring(0, 30000) + "\n...[TRUNCATED]" : target.data;
    parts.push({ text: truncatedJson });
  }

  let promptText = "Analyze the target above. Provide the output JSON.";
  if (additionalInstructions && additionalInstructions.trim().length > 0) {
    promptText += `\n\nUSER EXTRA INSTRUCTIONS:\n${additionalInstructions}`;
  }
  parts.push({ text: promptText });

  onLog("Sending data to Gemini API...");

  let result;
  let retryCount = 0;
  let attempt = 0;
  const MAX_TOTAL_ATTEMPTS = 6; 

  while (attempt < MAX_TOTAL_ATTEMPTS) {
    attempt++;
    try {
      result = await ai.models.generateContent({
        model: modelId,
        contents: {
          role: "user",
          parts: parts
        },
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.2, 
          responseMimeType: "application/json",
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          ]
        }
      });
      break; 
    } catch (error: any) {
      const isInternalError = error.message?.includes("500") || error.message?.includes("INTERNAL") || error.status === 500;
      // Handle 429 Quota Exceeded and 503 Service Unavailable
      const isQuotaError = error.message?.includes("429") || error.status === 429 || error.message?.includes("quota") || error.message?.includes("RESOURCE_EXHAUSTED");
      const isServiceUnavailable = error.message?.includes("503") || error.status === 503;
      
      console.warn(`Attempt ${attempt} failed with model ${modelId}. Error: ${error.message}`);

      // FALLBACK LOGIC: If Pro fails due to Quota (429), switch to Flash immediately
      if (isQuotaError && modelId === 'gemini-3-pro-preview') {
          onLog("⚠️ Quota limit reached for Gemini 3 Pro. Switching to Gemini 2.5 Flash (faster, higher limits)...");
          modelId = 'gemini-2.5-flash';
          retryCount = 0; // Reset retries for new model
          await new Promise(resolve => setTimeout(resolve, 1500)); // Brief cooling pause
          continue;
      }

      if (isInternalError || isQuotaError || isServiceUnavailable) {
         retryCount++;
         if (retryCount > 3) throw error; // Give up after 3 retries on the SAME model
         
         const delay = 2000 * Math.pow(2, retryCount); // 4s, 8s, 16s
         onLog(`API Error (${error.status || 'Network'}). Retrying attempt ${retryCount}/3 in ${delay/1000}s...`);
         await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error; 
      }
    }
  }

  try {
    onLog(`Response received from ${modelId}. Parsing JSON...`);
    
    let responseText = result?.text;
    
    if (!responseText && result?.candidates?.[0]?.content?.parts) {
       responseText = result.candidates[0].content.parts
         .map((p: any) => p.text || '')
         .join('');
    }
    
    if (!responseText) {
      const candidate = result?.candidates?.[0];
      if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
        throw new Error(`AI generation stopped. Reason: ${candidate.finishReason}.`);
      }
      throw new Error("Empty response from AI.");
    }

    const parsed = parseRobustJson(responseText);
      
    if (!parsed.pdfMakeCode.includes("function") && !parsed.excelJSCode.includes("function")) {
       if (parsed.pdfMakeCode.startsWith("//") && parsed.excelJSCode.startsWith("//")) {
           throw new Error("Incomplete JSON structure returned");
       }
    }

    if (parsed.summary?.detectedTables) {
       if (!Array.isArray(parsed.summary.detectedTables.dimensions)) {
          const val = parsed.summary.detectedTables.dimensions;
          parsed.summary.detectedTables.dimensions = val ? [String(val)] : [];
       }
       if (typeof parsed.summary.detectedTables.count !== 'number') {
          parsed.summary.detectedTables.count = Number(parsed.summary.detectedTables.count) || 0;
       }
    } else if (parsed.summary) {
       parsed.summary.detectedTables = { count: 0, dimensions: [] };
    }
    
    if (parsed.extractedData === undefined || parsed.extractedData === null) {
      parsed.extractedData = [];
    }

    onLog("Analysis successful!");
    return parsed;

  } catch (error: any) {
    console.error("Gemini API Error:", error);
    if (error.message?.includes("400") || error.message?.includes("INVALID_ARGUMENT")) {
       if (error.message?.includes("token count")) {
         throw new Error("Input too large: The Reference Library or Target File exceeds the token limit.");
       }
       throw new Error("API Error 400: Bad Request.");
    }
    throw error;
  }
};

export const generateCodeExplanation = async (
  apiKey: string,
  code: string,
  type: 'pdfmake' | 'exceljs'
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey });
  const modelId = 'gemini-2.5-flash';

  const prompt = `
  Explain this ${type} code to a developer. 
  Focus on: Structure, Data Mapping, and Styling.
  Use Markdown.
  
  CODE:
  ${code.substring(0, 15000)}
  `;

  try {
    const result = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        temperature: 0.4,
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ]
      }
    });

    if (!result.text) return "Could not generate explanation.";
    return result.text;
  } catch (e: any) {
    console.error("Explanation Error:", e);
    return `Failed to generate explanation: ${e.message}`;
  }
};