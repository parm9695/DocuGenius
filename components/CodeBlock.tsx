import React from 'react';
import { Copy, Check } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language = 'javascript', filename = 'untitled' }) => {
  const [copied, setCopied] = React.useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Split code into lines for line numbering
  const lines = code.split('\n');

  return (
    <div className="rounded-lg overflow-hidden border border-slate-700 bg-[#1e1e1e] shadow-2xl flex flex-col h-full font-mono text-sm">
      {/* Editor Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-[#333]">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#ff5f56]"></div>
            <div className="w-3 h-3 rounded-full bg-[#ffbd2e]"></div>
            <div className="w-3 h-3 rounded-full bg-[#27c93f]"></div>
          </div>
          <span className="text-slate-400 text-xs ml-2">{filename}</span>
        </div>
        <button 
          onClick={copyToClipboard}
          className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        <div className="relative min-h-full flex">
          {/* Line Numbers */}
          <div className="flex-none w-10 md:w-12 py-4 text-right pr-3 select-none text-[#858585] bg-[#1e1e1e] text-xs border-r border-[#333]">
            {lines.map((_, i) => (
              <div key={i} className="leading-6">{i + 1}</div>
            ))}
          </div>
          
          {/* Code */}
          <div className="flex-1 py-4 px-4 overflow-x-auto">
            <pre className="font-mono text-[#d4d4d4] text-xs md:text-sm leading-6">
              {code}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
