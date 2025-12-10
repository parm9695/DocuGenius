import React, { useMemo, useState, useEffect } from 'react';
import { Copy, Check, Maximize2, Minimize2, Edit2, Save } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  editable?: boolean;
  onCodeChange?: (newCode: string) => void;
}

// --- 1. Simple Auto-Formatter (Beautifier) ---
// Basic logic to handle indentation for JS/JSON if the AI returns minified code
const formatCode = (input: string, lang: string): string => {
  if (lang === 'json') {
    try {
        return JSON.stringify(JSON.parse(input), null, 2);
    } catch (e) { return input; }
  }

  // Basic JS Beautifier
  let indent = 0;
  const tab = '  ';
  
  // 1. Ensure basic line breaks around braces/semicolons if the code is one liner
  // Note: This regex is simple and might break inside strings, but works for generated code mostly.
  let cleaned = input
    .replace(/;\s*/g, ';\n')
    .replace(/\{\s*/g, '{\n')
    .replace(/\}\s*/g, '\n}')
    .replace(/\*\/\s*/g, '*/\n'); // Comments

  // 2. Re-indent based on structure
  return cleaned.split('\n').map(line => {
    line = line.trim();
    if (!line) return null;
    
    // Decrease indent for closing brackets
    if (line.match(/^\}/) || line.match(/^\]/) || line.match(/^\)/)) {
      indent = Math.max(0, indent - 1);
    }
    
    const currentIndent = tab.repeat(indent);
    
    // Increase indent for opening brackets
    if (line.match(/\{$/) || line.match(/\[$/) || line.match(/\($/)) {
      indent++;
    }
    
    return currentIndent + line;
  }).filter(l => l !== null).join('\n');
};

// --- 2. Syntax Highlighting Components ---
const SyntaxHighlight = ({ code }: { code: string }) => {
  // Simple regex-based tokenization for visual appeal
  // Colors based on VS Code Dark+
  
  const tokens = code.split(/(\/\/.*|\/\*[\s\S]*?\*\/|`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\b(?:const|let|var|function|return|if|else|for|while|await|async|import|export|from|try|catch|class|new|this|typeof|void)\b|\b(?:true|false|null|undefined)\b|\b\d+\b|[(){}[\].,:;])/g);

  return (
    <>
      {tokens.map((token, i) => {
        if (!token) return null;

        // Strings
        if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
          return <span key={i} className="text-[#ce9178]">{token}</span>;
        }
        // Comments
        if (token.startsWith('//') || token.startsWith('/*')) {
          return <span key={i} className="text-[#6a9955] italic">{token}</span>;
        }
        // Keywords (Control flow, declarations)
        if (/^(const|let|var|function|return|if|else|for|while|await|async|import|export|from|try|catch|class|new|this|typeof|void)$/.test(token)) {
          return <span key={i} className="text-[#569cd6] font-bold">{token}</span>;
        }
        // Booleans / Null
        if (/^(true|false|null|undefined)$/.test(token)) {
          return <span key={i} className="text-[#569cd6]">{token}</span>;
        }
        // Numbers
        if (/^\d+$/.test(token)) {
          return <span key={i} className="text-[#b5cea8]">{token}</span>;
        }
        // Function calls (heuristic: followed by '(' in next token usually, but here we approximate)
        // Punctuation
        if (/^[(){}[\].,:;]$/.test(token)) {
             return <span key={i} className="text-[#d4d4d4]">{token}</span>;
        }
        
        // Default (Variables, Properties) - Check if it looks like a function call
        // This is a rough approximation since we don't have lookahead in map
        return <span key={i} className="text-[#9cdcfe]">{token}</span>;
      })}
    </>
  );
};

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language = 'javascript', filename = 'untitled', editable = false, onCodeChange }) => {
  const [copied, setCopied] = useState(false);
  const [formattedCode, setFormattedCode] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    // Format the code whenever input changes from props
    const formatted = formatCode(code, language);
    setFormattedCode(formatted);
    setEditValue(formatted);
  }, [code, language]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(isEditing ? editValue : formattedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    if (onCodeChange) {
        onCodeChange(editValue);
    }
    setFormattedCode(editValue); // Update view
    setIsEditing(false);
  };

  const lines = (isEditing ? editValue : formattedCode).split('\n');

  return (
    <div className={`
      flex flex-col bg-[#1e1e1e] border border-[#333] shadow-2xl rounded-xl overflow-hidden font-mono text-sm transition-all duration-300
      ${isFullscreen ? 'fixed inset-4 z-50' : 'h-full'}
    `}>
      {/* Editor Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#252526] border-b border-[#333] select-none">
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-[#ff5f56] hover:bg-[#ff5f56]/80 transition-colors" />
            <div className="w-3 h-3 rounded-full bg-[#ffbd2e] hover:bg-[#ffbd2e]/80 transition-colors" />
            <div className="w-3 h-3 rounded-full bg-[#27c93f] hover:bg-[#27c93f]/80 transition-colors" />
          </div>
          <div className="flex items-center gap-2 text-slate-400 bg-[#1e1e1e] px-3 py-1 rounded-md text-xs border border-[#333]">
             {language === 'javascript' && <span className="text-[#f1e05a]">JS</span>}
             {language === 'json' && <span className="text-[#f1e05a]">{'{ }'}</span>}
             <span>{filename}</span>
             {editable && isEditing && <span className="text-orange-400 ml-1">• Editing</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {editable && (
              isEditing ? (
                  <button
                    onClick={handleSave}
                    className="p-1.5 bg-green-600/20 text-green-400 hover:bg-green-600/30 rounded transition-colors flex items-center gap-1 px-2"
                    title="Apply Changes"
                  >
                      <Save className="w-3.5 h-3.5" />
                      <span className="text-xs font-bold">Apply</span>
                  </button>
              ) : (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-[#333] rounded transition-colors flex items-center gap-1"
                    title="Edit Code"
                  >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span className="text-xs">Edit</span>
                  </button>
              )
          )}

           <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-[#333] rounded transition-colors"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button 
            onClick={copyToClipboard}
            className={`
              flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-all duration-200
              ${copied ? 'bg-green-500/20 text-green-400' : 'bg-[#333] text-slate-300 hover:bg-[#444] hover:text-white'}
            `}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy Code'}
          </button>
        </div>
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-auto custom-scrollbar relative bg-[#1e1e1e]">
        <div className="min-h-full flex">
          {/* Line Numbers */}
          <div className="flex-none w-12 py-4 text-right pr-4 select-none bg-[#1e1e1e] border-r border-[#333]">
            {lines.map((_, i) => (
              <div key={i} className="text-[#858585] text-xs leading-6 font-mono font-medium">
                {i + 1}
              </div>
            ))}
          </div>
          
          {/* Code Area */}
          <div className="flex-1 overflow-x-auto relative">
            {editable && isEditing ? (
                <textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="w-full h-full bg-[#1e1e1e] text-[#d4d4d4] font-mono text-[13px] leading-6 p-4 outline-none resize-none absolute inset-0"
                    spellCheck={false}
                />
            ) : (
                <pre className="font-mono text-[#d4d4d4] text-[13px] leading-6 whitespace-pre tab-4 py-4 px-4">
                  <SyntaxHighlight code={formattedCode} />
                </pre>
            )}
          </div>
        </div>
      </div>
      
      {/* Footer Info */}
      <div className="bg-[#007acc] text-white px-3 py-1 text-[10px] flex justify-between items-center select-none">
        <div className="flex gap-3">
          <span>UTF-8</span>
          <span>{language.toUpperCase()}</span>
          {editable && isEditing && <span className="font-bold text-orange-200">UNSAVED CHANGES</span>}
        </div>
        <div>
          Ln {lines.length}, Col 1
        </div>
      </div>
    </div>
  );
};