import React, { useEffect, useState } from 'react';
import { RefreshCw, FileWarning } from 'lucide-react';

// Declare global pdfMake attached by the CDN script
declare global {
  interface Window {
    pdfMake: any;
  }
}

interface PdfPreviewProps {
  code: string;
  data: any; // Changed from any[] to any to support objects
}

export const PdfPreview: React.FC<PdfPreviewProps> = ({ code, data }) => {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // --- Helper: Robust Function Extractor ---
    // Extracts a code block balancing braces while ignoring strings and comments
    const extractBalancedBlock = (source: string, startIdx: number): string | null => {
        let openBraces = 0;
        let foundStart = false;
        let inString: null | '"' | "'" | '`' = null;
        let inComment: null | '//' | '/*' = null;
        
        for (let i = startIdx; i < source.length; i++) {
            const char = source[i];
            const nextChar = source[i+1] || '';
            
            // Handle Escapes inside strings
            if (inString && char === '\\') {
                i++; // skip next char
                continue;
            }

            // Handle Strings
            if (!inComment) {
                 if (inString) {
                     if (char === inString) inString = null;
                 } else {
                     if (char === '"' || char === "'" || char === '`') inString = char;
                 }
            }

            // Handle Comments
            if (!inString) {
                if (inComment === '//') {
                    if (char === '\n') inComment = null;
                } else if (inComment === '/*') {
                    if (char === '*' && nextChar === '/') {
                        inComment = null;
                        i++;
                    }
                } else {
                    if (char === '/' && nextChar === '/') {
                        inComment = '//';
                        i++;
                    } else if (char === '/' && nextChar === '*') {
                        inComment = '/*';
                        i++;
                    }
                }
            }

            // Handle Braces (only if not in string or comment)
            if (!inString && !inComment) {
                if (char === '{') {
                    foundStart = true;
                    openBraces++;
                } else if (char === '}') {
                    openBraces--;
                }
            }
            
            if (foundStart && openBraces === 0) {
                return source.substring(startIdx, i + 1);
            }
        }
        return null;
    };

    const generatePdf = async () => {
      setLoading(true);
      setError(null);

      try {
        if (!window.pdfMake) {
          throw new Error("pdfmake library not loaded. Please check your internet connection.");
        }
        
        // Ensure VFS fonts are assigned
        if (window.pdfMake.vfs && window.pdfMake.fonts) {
            // Standard assignment for CDN version
            window.pdfMake.vfs = window.pdfMake.vfs; 
        }

        // --- Helper: Clean Code Strategy ---
        const cleanAndRun = async (inputCode: string) => {
            // Sanitize: Remove invisible chars (Zero Width Space, BOM)
            let cleanCode = inputCode.replace(/[\u200B-\u200D\uFEFF]/g, '');
            // Sanitize: Replace smart quotes
            cleanCode = cleanCode.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
            
            // Remove artifacts from JSON extraction
            cleanCode = cleanCode.replace(/["']\s*,?\s*$/, '').replace(/^["']/, '');
            
            // Remove markdown code blocks
            cleanCode = cleanCode.replace(/```(javascript|js)?/gi, '').replace(/```/g, '');

            // Remove imports/exports for evaluation
            cleanCode = cleanCode.replace(/^\s*import\s+[\s\S]*?from\s+["'].*?["'];?/gm, '');
            cleanCode = cleanCode.replace(/^\s*import\s+["'].*?["'];?/gm, '');
            cleanCode = cleanCode.replace(/^\s*(?:const|let|var)\s+\w+\s*=\s*require\(.*?\);?/gm, '');
            cleanCode = cleanCode.replace(/^\s*export\s+default\s+/gm, '');
            cleanCode = cleanCode.replace(/^\s*export\s+(const|let|var|function|async|class|type|interface)\s/gm, '$1 ');
            cleanCode = cleanCode.replace(/^\s*export\s*\{[\s\S]*?\}\s*;?/gm, '');
            cleanCode = cleanCode.replace(/['"]use strict['"];?/g, '');

            // Execution Environment
            let capturedDocDef: any = null;

            const mockPdfMake = {
                createPdf: (docDef: any) => {
                    capturedDocDef = docDef;
                    return {
                        open: () => {},
                        download: () => {},
                        print: () => {},
                        getDataUrl: () => {}
                    };
                },
                vfs: window.pdfMake.vfs,
                fonts: window.pdfMake.fonts
            };

            const runnerPrefix = 
                "const pdfMake = args.pdfMake;\n" +
                "const data = args.data;\n" +
                "return (async () => {\n" +
                "  try {\n";

            const runnerSuffix = 
                "\n" +
                "    // Try to find the function. It might be named exportPDF\n" +
                "    if (typeof exportPDF === 'function') {\n" +
                "       const result = await exportPDF(data);\n" +
                "       if (result && (result.content || Array.isArray(result))) {\n" +
                "          return result;\n" +
                "       }\n" +
                "    }\n" +
                "    return null;\n" +
                "  } catch(e) {\n" +
                "    throw e;\n" +
                "  }\n" +
                "})();";

            // Inject semicolon and newline to prevent syntax issues with comments/unterminated lines
            const runnerBody = runnerPrefix + cleanCode + "\n;\n" + runnerSuffix;
            const runner = new Function('args', runnerBody);
            return await runner({ data, pdfMake: mockPdfMake }) || capturedDocDef;
        };

        let finalDocDef;

        // STRATEGY 1: Try running the cleaned code as is
        // We wrap this in a try/catch specifically for SyntaxErrors
        try {
            finalDocDef = await cleanAndRun(code);
        } catch (e1: any) {
            // If it's a syntax error (like Unexpected token), the Full Code strategy failed due to garbage.
            // Move to Strategy 2.
            
            // STRATEGY 2: Precise Function Extraction
            // We search for 'async function exportPDF...' or 'const exportPDF = ...'
            const funcMatch = code.match(/(async\s+function\s+exportPDF|const\s+exportPDF\s*=\s*async|function\s+exportPDF)/);
            
            if (funcMatch && funcMatch.index !== undefined) {
                try {
                    const extractedBody = extractBalancedBlock(code, funcMatch.index);
                    if (extractedBody) {
                        finalDocDef = await cleanAndRun(extractedBody);
                    } else {
                        // Fallback: If extraction failed, try just the match (unlikely to work but last resort)
                         throw e1;
                    }
                } catch (e2) {
                    console.warn("Strategy 2 (Function Extract) failed:", e2);
                    throw e1; // Throw original error to user
                }
            } else {
                // STRATEGY 3: Object Literal Extraction
                // Maybe the code is just "var docDefinition = { ... }" or "return { ... }"
                // Try to find the first top-level object "{" and extract it
                const firstBrace = code.indexOf('{');
                if (firstBrace !== -1) {
                    try {
                        const extractedObj = extractBalancedBlock(code, firstBrace);
                        if (extractedObj) {
                            // Try to evaluate just this object
                            // We wrap it: return [OBJ];
                            const objRunner = new Function('args', `return ${extractedObj};`);
                            finalDocDef = objRunner({});
                        }
                    } catch (e3) {
                         throw e1;
                    }
                } else {
                    throw e1;
                }
            }
        }

        if (!finalDocDef) {
          throw new Error("Could not detect a document definition. The code must return the 'docDefinition' object.");
        }

        // Validate basic structure
        if (typeof finalDocDef !== 'object') {
           throw new Error("Generated document definition is not an object.");
        }
        if (!finalDocDef.content) {
            finalDocDef.content = [];
        }

        // 4. Generate Real PDF
        if (mounted) {
           const pdfDocGenerator = window.pdfMake.createPdf(finalDocDef);
           pdfDocGenerator.getDataUrl((dataUrl: string) => {
             if (mounted) {
               setPdfUrl(dataUrl);
               setLoading(false);
             }
           });
        }

      } catch (e: any) {
        if (mounted) {
          console.error("PDF Generation Error Details:", e);
          let msg = e.message || "Failed to generate PDF preview.";
          if (msg.includes("Unexpected token")) {
             msg = `Syntax Error in generated code: ${msg}. The AI might have produced invalid JavaScript. Try regenerating.`;
          }
          if (msg.includes("Cannot read properties of undefined") || msg.includes("docType")) {
              msg = `Runtime Error: The generated code tried to access data that doesn't exist. Check the 'Extracted JSON' tab to see if the data matches what the code expects.`;
          }
          setError(msg);
          setLoading(false);
        }
      }
    };

    generatePdf();

    return () => {
      mounted = false;
    };
  }, [code, data]);

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[#1e293b] rounded-xl border border-slate-700 text-slate-400 gap-3">
         <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
         <span className="text-sm">Rendering PDF Preview...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[#1e293b] rounded-xl border border-slate-700 p-8 text-center">
         <div className="bg-red-500/10 p-4 rounded-full mb-4">
            <FileWarning className="w-10 h-10 text-red-400" />
         </div>
         <h3 className="text-lg font-bold text-white mb-2">Preview Failed</h3>
         <p className="text-red-300 text-sm max-w-md font-mono bg-red-950/30 p-4 rounded border border-red-900/50 break-words whitespace-pre-wrap">
           {error}
         </p>
         <p className="text-slate-500 text-xs mt-4">
           Check the "pdfmake Config" tab to see the generated code.
         </p>
      </div>
    );
  }

  return (
    <div className="h-full bg-[#525659] rounded-xl overflow-hidden shadow-2xl flex flex-col">
       <iframe 
         src={pdfUrl || ''} 
         className="w-full flex-grow border-none"
         title="PDF Preview" 
       />
    </div>
  );
};